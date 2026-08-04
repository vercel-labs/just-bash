/**
 * python3 - Execute Python code via CPython Emscripten (Python in WebAssembly)
 *
 * Runs Python code in an isolated worker thread with access to the
 * virtual filesystem via SharedArrayBuffer bridge.
 *
 * Security: CPython Emscripten has zero JS bridge code. `import js` fails
 * with ModuleNotFoundError. No sandbox needed — isolation by construction.
 *
 * This command is Node.js only (uses worker_threads).
 */

import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { decodeBytesToUtf8 } from "../../encoding.js";
import type { IFileSystem } from "../../fs/interface.js";
import {
  sanitizeErrorMessage,
  sanitizeHostErrorMessage,
} from "../../fs/sanitize-error.js";
import { mapToRecord } from "../../helpers/env.js";
import { getErrorMessage } from "../../interpreter/helpers/errors.js";

import { bindDefenseContextCallback } from "../../security/defense-context.js";
import { DefenseInDepthBox } from "../../security/defense-in-depth-box.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { BridgeHandler } from "../worker-bridge/bridge-handler.js";
import { createSharedBuffer } from "../worker-bridge/protocol.js";
import { WorkerRequestController } from "../worker-request-controller.js";
import type { WorkerInput, WorkerOutput } from "./worker.js";

const python3Help = {
  name: "python3",
  summary: "Execute Python code via CPython Emscripten",
  usage: "python3 [OPTIONS] [-c CODE | -m MODULE | FILE] [ARGS...]",
  description: [
    "Execute Python code using CPython compiled to WebAssembly via Emscripten.",
    "",
    "This command runs Python in an isolated environment with access to",
    "the virtual filesystem. Standard library modules are available.",
  ],
  options: [
    "-c CODE     Execute CODE as Python script",
    "-m MODULE   Run library module as a script",
    "--version   Show Python version",
    "--help      Show this help",
  ],
  examples: [
    'python3 -c "print(1 + 2)"',
    'python3 -c "import sys; print(sys.version)"',
    "python3 script.py",
    "python3 script.py arg1 arg2",
    "echo 'print(\"hello\")' | python3",
  ],
  notes: [
    "CPython runs in WebAssembly, so execution may be slower than native Python.",
    "Standard library modules are available (no pip install).",
    "Maximum execution time is 30 seconds by default.",
  ],
};

interface ParsedArgs {
  code: string | null;
  module: string | null;
  scriptFile: string | null;
  showVersion: boolean;
  scriptArgs: string[];
}

function parseArgs(args: string[]): ParsedArgs | ExecResult {
  const result: ParsedArgs = {
    code: null,
    module: null,
    scriptFile: null,
    showVersion: false,
    scriptArgs: [],
  };

  if (args.length === 0) {
    return result;
  }

  const firstArgIndex = args.findIndex((arg) => {
    return !arg.startsWith("-") || arg === "-" || arg === "--";
  });

  for (
    let i = 0;
    i < (firstArgIndex === -1 ? args.length : firstArgIndex);
    i++
  ) {
    const arg = args[i];

    if (arg === "-c") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "python3: option requires an argument -- 'c'\n",
          exitCode: 2,
        };
      }
      result.code = args[i + 1];
      result.scriptArgs = args.slice(i + 2);
      return result;
    }

    if (arg === "-m") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "python3: option requires an argument -- 'm'\n",
          exitCode: 2,
        };
      }
      result.module = args[i + 1];
      result.scriptArgs = args.slice(i + 2);
      return result;
    }

    if (arg === "--version" || arg === "-V") {
      result.showVersion = true;
      return result;
    }

    if (arg.startsWith("-") && arg !== "-") {
      return {
        stdout: "",
        stderr: `python3: unrecognized option '${arg}'\n`,
        exitCode: 2,
      };
    }
  }

  if (firstArgIndex !== -1) {
    const arg = args[firstArgIndex];
    if (arg === "--") {
      if (firstArgIndex + 1 < args.length) {
        result.scriptFile = args[firstArgIndex + 1];
        result.scriptArgs = args.slice(firstArgIndex + 2);
      }
    } else {
      // `-` is the conventional CPython sentinel for "read program from
      // standard input" (see `man python3`). It must NOT be treated as a
      // file path. Carry it through as a sentinel so execute() can route
      // to the stdin branch while still preserving any trailing scriptArgs.
      result.scriptFile = arg;
      result.scriptArgs = args.slice(firstArgIndex + 1);
    }
  }

  return result;
}

// Queue for serializing Python executions (one at a time)
type QueuedExecution = {
  /** Unforgeable ownership marker for this queue slot. */
  executionId: symbol;
  input: WorkerInput;
  settle: (result: WorkerOutput) => void;
  requireDefenseContext?: boolean;
  state: "queued" | "running" | "terminating" | "settled";
  worker: Worker | null;
  controller: WorkerRequestController;
  stopBridge: () => void;
  cancel: (result: WorkerOutput) => void;
};
type QueueState = {
  executionQueue: QueuedExecution[];
  activeExecution: QueuedExecution | null;
  poisonedError: string | null;
};
let executionQueues = new WeakMap<IFileSystem, QueueState>();

function getQueueState(fs: IFileSystem): QueueState {
  let state = executionQueues.get(fs);
  if (!state) {
    state = {
      executionQueue: [],
      activeExecution: null,
      poisonedError: null,
    };
    executionQueues.set(fs, state);
  }
  return state;
}

/** @internal Reset queue state — for tests only */
export function _resetExecutionQueue(): void {
  executionQueues = new WeakMap();
}

const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));

function normalizeWorkerMessage(
  msg: unknown,
  expectedProtocolToken: string,
): WorkerOutput {
  if (!msg || typeof msg !== "object") {
    return {
      success: false,
      error: "Malformed worker response",
    };
  }

  const raw = msg as {
    protocolToken?: unknown;
    type?: unknown;
    violation?: { type?: unknown };
    success?: unknown;
    error?: unknown;
  };

  if (
    typeof raw.protocolToken !== "string" ||
    raw.protocolToken !== expectedProtocolToken
  ) {
    return {
      success: false,
      error: "Malformed worker response: invalid protocol token",
    };
  }

  if (raw.type === "security-violation") {
    return {
      success: false,
      error: `Security violation: ${
        typeof raw.violation?.type === "string" ? raw.violation.type : "unknown"
      }`,
    };
  }

  if (typeof raw.success !== "boolean") {
    return {
      success: false,
      error: "Malformed worker response: missing success flag",
    };
  }

  if (raw.success) {
    return { success: true };
  }

  return {
    success: false,
    error:
      typeof raw.error === "string" && raw.error.length > 0
        ? raw.error
        : "Worker execution failed",
  };
}

function processNextExecution(queueState: QueueState): void {
  if (queueState.poisonedError !== null) {
    for (const queued of queueState.executionQueue.splice(0)) {
      if (queued.state !== "queued") continue;
      queued.state = "settled";
      queued.stopBridge();
      queued.settle({ success: false, error: queueState.poisonedError });
    }
    return;
  }
  if (
    queueState.activeExecution !== null ||
    queueState.executionQueue.length === 0
  ) {
    return;
  }

  // Settled entries timed out while queued and must never be dispatched.
  while (
    queueState.executionQueue.length > 0 &&
    queueState.executionQueue[0]?.state !== "queued"
  ) {
    queueState.executionQueue.shift();
  }
  if (queueState.executionQueue.length === 0) {
    return;
  }

  const next = queueState.executionQueue.shift();
  if (!next) {
    return;
  }
  next.state = "running";
  queueState.activeExecution = next;

  // Create a fresh worker for each execution.
  // CPython Emscripten uses EXIT_RUNTIME, so the module can only run once.
  // The worker caches the stdlib zip at module scope (read from disk once
  // per worker lifetime, not per execution).
  let worker: Worker;
  try {
    worker = DefenseInDepthBox.runTrusted(
      // @banned-pattern-ignore: constructor is immediately owned by next.controller lifecycle
      () => new Worker(workerPath, { workerData: next.input }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    next.state = "settled";
    next.settle({
      success: false,
      error: sanitizeHostErrorMessage(message),
    });
    if (queueState.activeExecution === next) {
      queueState.activeExecution = null;
      processNextExecution(queueState);
    }
    return;
  }

  next.worker = worker;

  let listenersAttached = true;
  const cleanupListeners = (): void => {
    if (!listenersAttached) return;
    listenersAttached = false;
    worker.removeListener("message", dispatchMessage);
    worker.removeListener("error", dispatchError);
    worker.removeListener("exit", dispatchExit);
  };

  const settleActiveExecution = async (
    result: WorkerOutput,
    terminateWorker: boolean,
  ): Promise<void> => {
    // Every callback closes over its own entry. Checking both identity and state
    // prevents a stale event from releasing a newer queue owner.
    if (
      queueState.activeExecution?.executionId !== next.executionId ||
      next.state !== "running"
    ) {
      return;
    }

    next.state = "terminating";
    cleanupListeners();
    next.settle(result);

    if (terminateWorker) {
      const acknowledged = await next.controller.terminate(worker);
      if (!acknowledged) {
        const error = "Worker termination was not acknowledged";
        next.worker = null;
        next.state = "settled";
        queueState.poisonedError = error;
        if (queueState.activeExecution?.executionId === next.executionId) {
          queueState.activeExecution = null;
        }
        processNextExecution(queueState);
        return;
      }
    }

    next.worker = null;
    next.state = "settled";
    if (queueState.activeExecution?.executionId === next.executionId) {
      queueState.activeExecution = null;
      processNextExecution(queueState);
    }
  };

  next.cancel = (result) => {
    void settleActiveExecution(result, true);
  };

  const onMessage = bindDefenseContextCallback(
    next.requireDefenseContext,
    "python3",
    "worker message callback",
    (msg: unknown) => {
      try {
        next.controller.assertMessageSize(msg, "response");
      } catch (error) {
        void settleActiveExecution(
          {
            success: false,
            error: sanitizeHostErrorMessage(getErrorMessage(error)),
          },
          true,
        );
        return;
      }
      void settleActiveExecution(
        normalizeWorkerMessage(msg, next.input.protocolToken),
        true,
      );
    },
  );
  const onError = bindDefenseContextCallback(
    next.requireDefenseContext,
    "python3",
    "worker error callback",
    (err: Error) => {
      const workerError = sanitizeHostErrorMessage(getErrorMessage(err));
      void settleActiveExecution(
        {
          success: false,
          error: workerError,
        },
        true,
      );
    },
  );
  const onExit = bindDefenseContextCallback(
    next.requireDefenseContext,
    "python3",
    "worker exit callback",
    () => {
      void settleActiveExecution(
        { success: false, error: "Worker exited unexpectedly" },
        false,
      );
    },
  );

  const dispatchMessage = (msg: unknown): void => {
    try {
      onMessage(msg);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void settleActiveExecution(
        {
          success: false,
          error: sanitizeHostErrorMessage(message),
        },
        true,
      );
    }
  };

  const dispatchError = (err: Error): void => {
    try {
      onError(err);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void settleActiveExecution(
        {
          success: false,
          error: sanitizeHostErrorMessage(message),
        },
        true,
      );
    }
  };

  const dispatchExit = (): void => {
    try {
      onExit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void settleActiveExecution(
        {
          success: false,
          error: sanitizeHostErrorMessage(message),
        },
        true,
      );
    }
  };

  worker.on("message", dispatchMessage);
  worker.on("error", dispatchError);
  worker.on("exit", dispatchExit);
}

/**
 * Execute Python code in a worker with filesystem bridge.
 */
async function executePython(
  pythonCode: string,
  ctx: RuntimeCommandContext,
  scriptPath?: string,
  scriptArgs: string[] = [],
): Promise<ExecResult> {
  const sharedBuffer = createSharedBuffer();
  const bridgeHandler = new BridgeHandler(
    sharedBuffer,
    ctx.fs,
    ctx.cwd,
    "python3",
    ctx.fetch,
    ctx.limits.maxOutputSize,
  );

  const timeoutMs = ctx.limits.maxPythonTimeoutMs;
  const queueState = getQueueState(ctx.fs);
  if (queueState.poisonedError !== null) {
    return {
      stdout: "",
      stderr: `python3: ${queueState.poisonedError}\n`,
      exitCode: 1,
    };
  }

  const controller = new WorkerRequestController({
    commandName: "python3",
    timeoutMs,
    signal: ctx.signal,
    maxMessageBytes: ctx.limits.maxWorkerMessageBytes,
  });

  const workerInput: WorkerInput = {
    protocolToken: controller.protocolToken,
    sharedBuffer,
    pythonCode,
    cwd: ctx.cwd,
    // Convert Map to null-prototype object for worker transfer
    // (Maps can't be postMessage'd, and null-prototype prevents prototype pollution)
    env: mapToRecord(ctx.env),
    args: scriptArgs,
    scriptPath,
    timeoutMs,
    maxFileSize: ctx.limits.maxStringLength,
  };

  controller.assertMessageSize(
    { ...workerInput, sharedBuffer: undefined },
    "request",
  );

  const workerPromise = new Promise<WorkerOutput>((resolve) => {
    let settled = false;
    const queueEntry: QueuedExecution = {
      executionId: Symbol("python3 execution"),
      input: workerInput,
      settle: (result) => {
        if (settled) return;
        settled = true;
        controller.close();
        resolve(result);
      },
      requireDefenseContext: ctx.requireDefenseContext,
      state: "queued",
      worker: null,
      controller,
      stopBridge: () => bridgeHandler.stop?.(),
      cancel: () => {}, // Replaced if and when this entry owns a worker.
    };

    queueEntry.cancel = (result) => {
      if (queueEntry.state !== "queued") return;
      queueEntry.state = "settled";
      const queuedIndex = queueState.executionQueue.indexOf(queueEntry);
      if (queuedIndex !== -1) {
        queueState.executionQueue.splice(queuedIndex, 1);
      }
      queueEntry.settle(result);
      processNextExecution(queueState);
    };

    const onCancel = bindDefenseContextCallback(
      ctx.requireDefenseContext,
      "python3",
      "worker cancellation callback",
      (reason: "abort" | "timeout") => {
        bridgeHandler.stop?.();
        queueEntry.cancel({
          success: false,
          error:
            reason === "abort"
              ? controller.abortMessage()
              : controller.timeoutMessage(),
        });
      },
    );

    const dispatchCancel = (reason: "abort" | "timeout"): void => {
      try {
        onCancel(reason);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        queueEntry.cancel({
          success: false,
          error: sanitizeHostErrorMessage(message),
        });
      }
    };

    // Arm the parent signal and deadline before making this request visible.
    controller.arm(dispatchCancel);

    if (!controller.isCanceled) {
      // Queue the execution (serialized — one at a time per filesystem).
      queueState.executionQueue.push(queueEntry);
      processNextExecution(queueState);
    }
  });

  const [bridgeOutput, workerResult] = await Promise.all([
    bridgeHandler.run(timeoutMs).catch((e) => {
      const bridgeError = sanitizeHostErrorMessage(getErrorMessage(e));
      return {
        stdout: "",
        stderr: `python3: bridge error: ${bridgeError}\n`,
        exitCode: 1,
      };
    }),
    workerPromise.catch((e) => {
      const workerError = sanitizeHostErrorMessage(getErrorMessage(e));
      return {
        success: false,
        error: workerError,
      };
    }),
  ]);

  if (!workerResult.success && workerResult.error) {
    const workerError = sanitizeHostErrorMessage(workerResult.error);
    const canceled =
      workerResult.error === controller.timeoutMessage() ||
      workerResult.error === controller.abortMessage();
    return {
      stdout: bridgeOutput.stdout,
      stderr: `${bridgeOutput.stderr}python3: ${workerError}\n`,
      exitCode: bridgeOutput.exitCode || (canceled ? 124 : 1),
    };
  }

  // python3 emits text; the pipeline handles encoding.
  return {
    ...bridgeOutput,
  };
}

export const python3Command: RuntimeCommand = {
  name: "python3",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(python3Help);
    }

    const parsed = parseArgs(args);
    if ("exitCode" in parsed) return parsed;

    if (parsed.showVersion) {
      return {
        stdout: "Python 3.13.2 (Emscripten)\n",
        stderr: "",
        exitCode: 0,
      };
    }

    let pythonCode: string;
    let scriptPath: string | undefined;

    if (parsed.code !== null) {
      pythonCode = parsed.code;
      scriptPath = "-c";
    } else if (parsed.module !== null) {
      // Strict validation: only allow valid Python module names
      // (alphanumeric, underscores, dots for submodules)
      if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(parsed.module)) {
        return {
          stdout: "",
          stderr: `python3: No module named '${parsed.module.slice(0, 200)}'\n`,
          exitCode: 1,
        };
      }
      pythonCode = `import runpy; runpy.run_module('${parsed.module}', run_name='__main__')`;
      scriptPath = parsed.module;
    } else if (parsed.scriptFile === "-") {
      // CPython's `python3 -` reads the program from standard input.
      // Empty stdin runs an empty program (exit 0) — matching CPython's
      // behavior in non-interactive contexts where no program is provided.
      // Decode bytes — Python source can hold unicode string literals.
      pythonCode = decodeBytesToUtf8(ctx.stdin);
      scriptPath = "-";
    } else if (parsed.scriptFile !== null) {
      const filePath = ctx.fs.resolvePath(ctx.cwd, parsed.scriptFile);

      if (!(await ctx.fs.exists(filePath))) {
        return {
          stdout: "",
          stderr: `python3: can't open file '${parsed.scriptFile}': [Errno 2] No such file or directory\n`,
          exitCode: 2,
        };
      }

      try {
        pythonCode = await ctx.fs.readFile(filePath);
        scriptPath = parsed.scriptFile;
      } catch (e) {
        const message = sanitizeErrorMessage((e as Error).message);
        return {
          stdout: "",
          stderr: `python3: can't open file '${parsed.scriptFile}': ${message}\n`,
          exitCode: 2,
        };
      }
    } else if (decodeBytesToUtf8(ctx.stdin).trim()) {
      pythonCode = decodeBytesToUtf8(ctx.stdin);
      scriptPath = "<stdin>";
    } else {
      return {
        stdout: "",
        stderr:
          "python3: no input provided (use -c CODE, -m MODULE, or provide a script file)\n",
        exitCode: 2,
      };
    }

    return executePython(pythonCode, ctx, scriptPath, parsed.scriptArgs);
  },
};

export const pythonCommand: RuntimeCommand = {
  name: "python",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    return python3Command.execute(args, ctx);
  },
};

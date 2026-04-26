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

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { IFileSystem } from "../../fs/interface.js";
import {
  sanitizeErrorMessage,
  sanitizeHostErrorMessage,
} from "../../fs/sanitize-error.js";
import { mapToRecord } from "../../helpers/env.js";
import { getErrorMessage } from "../../interpreter/helpers/errors.js";

import { bindDefenseContextCallback } from "../../security/defense-context.js";
import { DefenseInDepthBox } from "../../security/defense-in-depth-box.js";
import { _clearTimeout, _setTimeout } from "../../timers.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { BridgeHandler } from "../worker-bridge/bridge-handler.js";
import { createSharedBuffer } from "../worker-bridge/protocol.js";
import type { WorkerInput, WorkerOutput } from "./worker.js";

/** Default Python execution timeout in milliseconds */
const DEFAULT_PYTHON_TIMEOUT_MS = 10000;
/** Default Python execution timeout when network is enabled */
const DEFAULT_PYTHON_NETWORK_TIMEOUT_MS = 60000;

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
      result.scriptFile = arg;
      result.scriptArgs = args.slice(firstArgIndex + 1);
    }
  }

  return result;
}

// Queue for serializing Python executions (one at a time)
type QueuedExecution = {
  input: WorkerInput;
  resolve: (result: WorkerOutput) => void;
  workerRef?: { current: Worker | null };
  requireDefenseContext?: boolean;
  /** Set to true when the request times out before execution starts */
  canceled?: boolean;
};
type QueueState = {
  executionQueue: QueuedExecution[];
  isExecuting: boolean;
};
let executionQueues = new WeakMap<IFileSystem, QueueState>();

function getQueueState(fs: IFileSystem): QueueState {
  let state = executionQueues.get(fs);
  if (!state) {
    state = {
      executionQueue: [],
      isExecuting: false,
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

function generateWorkerProtocolToken(): string {
  return randomBytes(16).toString("hex");
}

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
  if (queueState.isExecuting || queueState.executionQueue.length === 0) {
    return;
  }

  // Skip canceled entries (timed out before execution started)
  while (
    queueState.executionQueue.length > 0 &&
    queueState.executionQueue[0].canceled
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
  queueState.isExecuting = true;

  // Create a fresh worker for each execution.
  // CPython Emscripten uses EXIT_RUNTIME, so the module can only run once.
  // The worker caches the stdlib zip at module scope (read from disk once
  // per worker lifetime, not per execution).
  let worker: Worker;
  try {
    worker = DefenseInDepthBox.runTrusted(
      () => new Worker(workerPath, { workerData: next.input }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    next.resolve({
      success: false,
      error: sanitizeHostErrorMessage(message),
    });
    queueState.isExecuting = false;
    processNextExecution(queueState);
    return;
  }

  if (next.workerRef) next.workerRef.current = worker;

  const onMessage = bindDefenseContextCallback(
    next.requireDefenseContext,
    "python3",
    "worker message callback",
    (msg: unknown) => {
      next.resolve(normalizeWorkerMessage(msg, next.input.protocolToken));
      queueState.isExecuting = false;
      worker.terminate();
      processNextExecution(queueState);
    },
  );
  const onError = bindDefenseContextCallback(
    next.requireDefenseContext,
    "python3",
    "worker error callback",
    (err: Error) => {
      const workerError = sanitizeHostErrorMessage(getErrorMessage(err));
      next.resolve({
        success: false,
        error: workerError,
      });
      queueState.isExecuting = false;
      processNextExecution(queueState);
    },
  );
  const onExit = bindDefenseContextCallback(
    next.requireDefenseContext,
    "python3",
    "worker exit callback",
    () => {
      if (queueState.isExecuting) {
        next.resolve({ success: false, error: "Worker exited unexpectedly" });
        queueState.isExecuting = false;
        processNextExecution(queueState);
      }
    },
  );

  const dispatchMessage = (msg: unknown): void => {
    try {
      onMessage(msg);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      next.resolve({
        success: false,
        error: sanitizeHostErrorMessage(message),
      });
      queueState.isExecuting = false;
      worker.terminate();
      processNextExecution(queueState);
    }
  };

  const dispatchError = (err: Error): void => {
    try {
      onError(err);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      next.resolve({
        success: false,
        error: sanitizeHostErrorMessage(message),
      });
      queueState.isExecuting = false;
      processNextExecution(queueState);
    }
  };

  const dispatchExit = (): void => {
    try {
      onExit();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      next.resolve({
        success: false,
        error: sanitizeHostErrorMessage(message),
      });
      queueState.isExecuting = false;
      processNextExecution(queueState);
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
  ctx: CommandContext,
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
    ctx.limits?.maxOutputSize ?? 0,
  );

  // Network operations need a longer timeout. resolveLimits() always populates
  // maxPythonTimeoutMs (default 10s), so use the network default as a floor.
  const userTimeout =
    ctx.limits?.maxPythonTimeoutMs ?? DEFAULT_PYTHON_TIMEOUT_MS;
  const timeoutMs = ctx.fetch
    ? Math.max(userTimeout, DEFAULT_PYTHON_NETWORK_TIMEOUT_MS)
    : userTimeout;
  const queueState = getQueueState(ctx.fs);

  const workerInput: WorkerInput = {
    protocolToken: generateWorkerProtocolToken(),
    sharedBuffer,
    pythonCode,
    cwd: ctx.cwd,
    // Convert Map to null-prototype object for worker transfer
    // (Maps can't be postMessage'd, and null-prototype prevents prototype pollution)
    env: mapToRecord(ctx.env),
    args: scriptArgs,
    scriptPath,
    timeoutMs,
  };

  const workerRef: { current: Worker | null } = { current: null };

  const workerPromise = new Promise<WorkerOutput>((resolve) => {
    // The queue entry is created here so the timeout handler can mark it canceled
    const queueEntry: QueuedExecution = {
      input: workerInput,
      resolve: () => {}, // replaced below
      workerRef,
      requireDefenseContext: ctx.requireDefenseContext,
    };

    const onTimeout = bindDefenseContextCallback(
      ctx.requireDefenseContext,
      "python3",
      "worker timeout callback",
      () => {
        if (workerRef.current) {
          // Worker is running — terminate it
          workerRef.current.terminate();
        } else {
          // Worker hasn't started — mark canceled so processNextExecution skips it
          queueEntry.canceled = true;
        }
        resolve({
          success: false,
          error: `Execution timeout: exceeded ${timeoutMs}ms limit`,
        });
      },
    );

    const dispatchTimeout = (): void => {
      try {
        onTimeout();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolve({
          success: false,
          error: sanitizeHostErrorMessage(message),
        });
      }
    };

    const timeout = _setTimeout(dispatchTimeout, timeoutMs);

    queueEntry.resolve = (result: WorkerOutput) => {
      _clearTimeout(timeout);
      resolve(result);
    };

    // Queue the execution (serialized — one at a time per worker)
    queueState.executionQueue.push(queueEntry);
    processNextExecution(queueState);
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
    return {
      stdout: bridgeOutput.stdout,
      stderr: `${bridgeOutput.stderr}python3: ${workerError}\n`,
      exitCode: bridgeOutput.exitCode || 1,
    };
  }

  return bridgeOutput;
}

export const python3Command: Command = {
  name: "python3",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
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
    } else if (ctx.stdin.trim()) {
      pythonCode = ctx.stdin;
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

export const pythonCommand: Command = {
  name: "python",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    return python3Command.execute(args, ctx);
  },
};

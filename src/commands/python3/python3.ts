/**
 * python3 - Execute Python code via Pyodide (Python in WebAssembly)
 *
 * Runs Python code in an isolated worker thread with access to the
 * virtual filesystem via SharedArrayBuffer bridge.
 *
 * This command is Node.js only (uses worker_threads).
 */

import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { FsBridgeHandler } from "./fs-bridge-handler.js";
import { createSharedBuffer } from "./protocol.js";
import type { WorkerInput, WorkerOutput } from "./worker.js";

/** Default Python execution timeout in milliseconds (30 seconds for Pyodide load) */
const DEFAULT_PYTHON_TIMEOUT_MS = 30000;

const python3Help = {
  name: "python3",
  summary: "Execute Python code via Pyodide",
  usage: "python3 [OPTIONS] [-c CODE | -m MODULE | FILE] [ARGS...]",
  description: [
    "Execute Python code using Pyodide (Python compiled to WebAssembly).",
    "",
    "This command runs Python in a sandboxed environment with access to",
    "the virtual filesystem. Only Pyodide-bundled packages are available.",
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
    "Pyodide runs in WebAssembly, so execution may be slower than native Python.",
    "Only packages bundled with Pyodide are available (no pip install).",
    "First execution loads Pyodide (~30MB), subsequent calls are faster.",
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

// Singleton worker for reusing Pyodide instance
let sharedWorker: Worker | null = null;
let workerIdleTimeout: ReturnType<typeof setTimeout> | null = null;

// Queue for serializing Python executions (Pyodide is single-threaded)
type QueuedExecution = {
  input: WorkerInput;
  resolve: (result: WorkerOutput) => void;
};
const executionQueue: QueuedExecution[] = [];
let currentExecution: QueuedExecution | null = null;

const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));

function processNextExecution(): void {
  if (currentExecution || executionQueue.length === 0) {
    return;
  }

  const next = executionQueue.shift();
  if (!next) {
    return;
  }
  currentExecution = next;
  const worker = getOrCreateWorker();
  worker.postMessage(currentExecution.input);
}

function getOrCreateWorker(): Worker {
  // Clear any pending idle timeout
  if (workerIdleTimeout) {
    clearTimeout(workerIdleTimeout);
    workerIdleTimeout = null;
  }

  if (sharedWorker) {
    return sharedWorker;
  }

  sharedWorker = new Worker(workerPath);

  sharedWorker.on("message", (result: WorkerOutput) => {
    if (currentExecution) {
      currentExecution.resolve(result);
      currentExecution = null;
    }
    // Process next queued execution or schedule termination
    if (executionQueue.length > 0) {
      processNextExecution();
    } else {
      scheduleWorkerTermination();
    }
  });

  sharedWorker.on("error", (err: Error) => {
    if (currentExecution) {
      currentExecution.resolve({ success: false, error: err.message });
      currentExecution = null;
    }
    // Reject all queued executions
    for (const queued of executionQueue) {
      queued.resolve({ success: false, error: "Worker crashed" });
    }
    executionQueue.length = 0;
    sharedWorker = null;
  });

  sharedWorker.on("exit", () => {
    sharedWorker = null;
  });

  return sharedWorker;
}

function scheduleWorkerTermination(): void {
  // Terminate worker after 5 seconds of inactivity
  workerIdleTimeout = setTimeout(() => {
    if (sharedWorker && !currentExecution && executionQueue.length === 0) {
      sharedWorker.terminate();
      sharedWorker = null;
    }
  }, 5000);
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
  const bridgeHandler = new FsBridgeHandler(
    sharedBuffer,
    ctx.fs,
    ctx.cwd,
    ctx.fetch,
  );

  const timeoutMs = ctx.limits?.maxPythonTimeoutMs ?? DEFAULT_PYTHON_TIMEOUT_MS;

  const workerInput: WorkerInput = {
    sharedBuffer,
    pythonCode,
    cwd: ctx.cwd,
    env: ctx.env,
    args: scriptArgs,
    scriptPath,
  };

  const workerPromise = new Promise<WorkerOutput>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        success: false,
        error: `Execution timeout: exceeded ${timeoutMs}ms limit`,
      });
    }, timeoutMs);

    const wrappedResolve = (result: WorkerOutput) => {
      clearTimeout(timeout);
      resolve(result);
    };

    // Queue the execution (serialized since Pyodide is single-threaded)
    executionQueue.push({ input: workerInput, resolve: wrappedResolve });
    processNextExecution();
  });

  const [bridgeOutput, workerResult] = await Promise.all([
    bridgeHandler.run(timeoutMs),
    workerPromise.catch((e) => ({
      success: false,
      error: (e as Error).message,
    })),
  ]);

  if (!workerResult.success && workerResult.error) {
    return {
      stdout: bridgeOutput.stdout,
      stderr: `${bridgeOutput.stderr}python3: ${workerResult.error}\n`,
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
        stdout: "Python 3.12.1 (Pyodide)\n",
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
        return {
          stdout: "",
          stderr: `python3: can't open file '${parsed.scriptFile}': ${(e as Error).message}\n`,
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

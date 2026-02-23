/**
 * js-exec - Execute JavaScript code via QuickJS (WASM)
 *
 * Runs JavaScript code in an isolated worker thread with access to the
 * virtual filesystem, HTTP, and sub-shell execution via SharedArrayBuffer bridge.
 *
 * This command is Node.js only (uses worker_threads).
 */

import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { mapToRecord } from "../../helpers/env.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { BridgeHandler } from "../worker-bridge/bridge-handler.js";
import { createSharedBuffer } from "../worker-bridge/protocol.js";
import type { JsExecWorkerInput, JsExecWorkerOutput } from "./worker.js";

/** Default JavaScript execution timeout in milliseconds */
const DEFAULT_JS_TIMEOUT_MS = 30000;

const jsExecHelp = {
  name: "js-exec",
  summary: "Execute JavaScript code via QuickJS",
  usage: "js-exec [OPTIONS] [-c CODE | FILE] [ARGS...]",
  description: [
    "Execute JavaScript code using QuickJS (compiled to WebAssembly).",
    "",
    "This command runs JavaScript in a sandboxed environment with access to",
    "the virtual filesystem, HTTP requests, and sub-shell execution.",
  ],
  options: [
    "-c CODE          Execute CODE as JavaScript",
    "-m, --module     Enable ES module mode (import/export)",
    "--strip-types    Strip TypeScript type annotations before execution",
    "--version        Show QuickJS version",
    "--help           Show this help",
  ],
  examples: [
    'js-exec -c "console.log(1 + 2)"',
    "js-exec -c \"console.log(fs.readFile('/etc/hostname'))\"",
    "js-exec -c \"const r = exec('echo hello'); console.log(r.stdout)\"",
    "js-exec script.js",
    "js-exec script.ts",
    "js-exec -m -c \"import { readFile } from 'fs'; console.log(readFile('/etc/hostname'))\"",
    "echo 'console.log(\"hello\")' | js-exec",
  ],
  notes: [
    "QuickJS runs in WebAssembly for security isolation.",
    "Available globals: console, fs, fetch, exec, env, process.",
    "ES module mode auto-enabled for .mjs, .ts, .mts files.",
    "TypeScript type stripping auto-enabled for .ts, .mts files.",
    "Virtual modules: fs, exec, fetch, process, env, console.",
    "Maximum execution time is 30 seconds by default.",
  ],
};

interface ParsedArgs {
  code: string | null;
  scriptFile: string | null;
  showVersion: boolean;
  scriptArgs: string[];
  isModule: boolean;
  stripTypes: boolean;
}

function parseArgs(args: string[]): ParsedArgs | ExecResult {
  const result: ParsedArgs = {
    code: null,
    scriptFile: null,
    showVersion: false,
    scriptArgs: [],
    isModule: false,
    stripTypes: false,
  };

  if (args.length === 0) {
    return result;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-m" || arg === "--module") {
      result.isModule = true;
      continue;
    }

    if (arg === "--strip-types") {
      result.stripTypes = true;
      continue;
    }

    if (arg === "-c") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "js-exec: option requires an argument -- 'c'\n",
          exitCode: 2,
        };
      }
      result.code = args[i + 1];
      result.scriptArgs = args.slice(i + 2);
      return result;
    }

    if (arg === "--version" || arg === "-V") {
      result.showVersion = true;
      return result;
    }

    if (arg.startsWith("-") && arg !== "-" && arg !== "--") {
      return {
        stdout: "",
        stderr: `js-exec: unrecognized option '${arg}'\n`,
        exitCode: 2,
      };
    }

    if (arg === "--") {
      if (i + 1 < args.length) {
        result.scriptFile = args[i + 1];
        result.scriptArgs = args.slice(i + 2);
      }
      return result;
    }

    // First non-option is script file
    if (!arg.startsWith("-")) {
      result.scriptFile = arg;
      result.scriptArgs = args.slice(i + 1);
      return result;
    }
  }

  return result;
}

// Singleton worker for reusing QuickJS instance
let sharedWorker: Worker | null = null;
let workerIdleTimeout: ReturnType<typeof setTimeout> | null = null;

// Queue for serializing JS executions (QuickJS is single-threaded)
type QueuedExecution = {
  input: JsExecWorkerInput;
  resolve: (result: JsExecWorkerOutput) => void;
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

  sharedWorker.on("message", (result: JsExecWorkerOutput) => {
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
 * Execute JavaScript code in a worker with filesystem bridge.
 */
async function executeJS(
  jsCode: string,
  ctx: CommandContext,
  scriptPath?: string,
  scriptArgs: string[] = [],
  bootstrapCode?: string,
  isModule?: boolean,
  stripTypes?: boolean,
): Promise<ExecResult> {
  const sharedBuffer = createSharedBuffer();
  const bridgeHandler = new BridgeHandler(
    sharedBuffer,
    ctx.fs,
    ctx.cwd,
    "js-exec",
    ctx.fetch,
    ctx.exec,
  );

  const timeoutMs = ctx.limits?.maxJsTimeoutMs ?? DEFAULT_JS_TIMEOUT_MS;

  const workerInput: JsExecWorkerInput = {
    sharedBuffer,
    jsCode,
    cwd: ctx.cwd,
    env: mapToRecord(ctx.env),
    args: scriptArgs,
    scriptPath,
    bootstrapCode,
    isModule,
    stripTypes,
  };

  const workerPromise = new Promise<JsExecWorkerOutput>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        success: false,
        error: `Execution timeout: exceeded ${timeoutMs}ms limit`,
      });
    }, timeoutMs);

    const wrappedResolve = (result: JsExecWorkerOutput) => {
      clearTimeout(timeout);
      resolve(result);
    };

    // Queue the execution (serialized since QuickJS is single-threaded)
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
      stderr: `${bridgeOutput.stderr}js-exec: ${workerResult.error}\n`,
      exitCode: bridgeOutput.exitCode || 1,
    };
  }

  return bridgeOutput;
}

export const jsExecCommand: Command = {
  name: "js-exec",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(jsExecHelp);
    }

    const parsed = parseArgs(args);
    if ("exitCode" in parsed) return parsed;

    if (parsed.showVersion) {
      return {
        stdout: "QuickJS (quickjs-emscripten)\n",
        stderr: "",
        exitCode: 0,
      };
    }

    let jsCode: string;
    let scriptPath: string | undefined;

    if (parsed.code !== null) {
      jsCode = parsed.code;
      scriptPath = "-c";
    } else if (parsed.scriptFile !== null) {
      const filePath = ctx.fs.resolvePath(ctx.cwd, parsed.scriptFile);

      if (!(await ctx.fs.exists(filePath))) {
        return {
          stdout: "",
          stderr: `js-exec: can't open file '${parsed.scriptFile}': No such file or directory\n`,
          exitCode: 2,
        };
      }

      try {
        jsCode = await ctx.fs.readFile(filePath);
        scriptPath = filePath;
      } catch (e) {
        return {
          stdout: "",
          stderr: `js-exec: can't open file '${parsed.scriptFile}': ${(e as Error).message}\n`,
          exitCode: 2,
        };
      }
    } else if (ctx.stdin.trim()) {
      jsCode = ctx.stdin;
      scriptPath = "<stdin>";
    } else {
      return {
        stdout: "",
        stderr:
          "js-exec: no input provided (use -c CODE or provide a script file)\n",
        exitCode: 2,
      };
    }

    // Auto-detect module mode and type stripping from file extension
    let isModule = parsed.isModule;
    let stripTypes = parsed.stripTypes;
    if (scriptPath && scriptPath !== "-c" && scriptPath !== "<stdin>") {
      if (
        scriptPath.endsWith(".mjs") ||
        scriptPath.endsWith(".mts") ||
        scriptPath.endsWith(".ts")
      ) {
        isModule = true;
      }
      if (scriptPath.endsWith(".ts") || scriptPath.endsWith(".mts")) {
        stripTypes = true;
      }
    }

    // Get bootstrap code from context env if set
    const bootstrapCode = ctx.env.get("__JSEXEC_BOOTSTRAP__") || undefined;

    return executeJS(
      jsCode,
      ctx,
      scriptPath,
      parsed.scriptArgs,
      bootstrapCode,
      isModule,
      stripTypes,
    );
  },
};

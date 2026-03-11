/**
 * js-exec - Execute JavaScript code via QuickJS (WASM)
 *
 * Runs JavaScript code in an isolated worker thread with access to the
 * virtual filesystem, HTTP, and sub-shell execution via SharedArrayBuffer bridge.
 *
 * This command is Node.js only (uses worker_threads).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
import { mapToRecord } from "../../helpers/env.js";
import { DefenseInDepthBox } from "../../security/defense-in-depth-box.js";
import { _clearTimeout, _setTimeout } from "../../timers.js";
import type {
  Command,
  CommandContext,
  CommandExecOptions,
  ExecResult,
} from "../../types.js";
import { hasHelpFlag } from "../help.js";
import { BridgeHandler } from "../worker-bridge/bridge-handler.js";
import { createSharedBuffer } from "../worker-bridge/protocol.js";
import type { JsExecWorkerInput, JsExecWorkerOutput } from "./worker.js";

/** Default JavaScript execution timeout in milliseconds */
const DEFAULT_JS_TIMEOUT_MS = 10000;
/** Default JavaScript execution timeout when network is enabled */
const DEFAULT_JS_NETWORK_TIMEOUT_MS = 60000;

/**
 * Tracks js-exec execution context via AsyncLocalStorage.
 * When a js-exec bridge exec callback triggers another js-exec,
 * this detects the re-entrance without rejecting legitimate concurrent calls.
 */
const jsExecAsyncContext = new AsyncLocalStorage<boolean>();

const JS_EXEC_HELP = `js-exec - Sandboxed JavaScript/TypeScript runtime with Node.js-compatible APIs

Usage: js-exec [OPTIONS] [-c CODE | FILE] [ARGS...]

Options:
  -c CODE          Execute inline code
  -m, --module     Enable ES module mode (import/export)
  --strip-types    Strip TypeScript type annotations
  --version, -V    Show version
  --help           Show this help

Examples:
  js-exec -c "console.log(1 + 2)"
  js-exec script.js
  js-exec app.ts
  echo 'console.log("hello")' | js-exec

File Extension Auto-Detection:
  .js              script mode (module mode if top-level await detected)
  .mjs             ES module mode
  .ts, .mts        ES module mode + TypeScript stripping

Node.js Compatibility:
  Code written for Node.js largely works here. Both require and import
  are supported, the node: prefix works, and standard globals like process,
  console, and fetch are available. All I/O is synchronous.

  Available modules:
    fs, path, child_process, process, console,
    os, url, assert, util, events, buffer, stream,
    string_decoder, querystring

  fs (global, require('fs'), or import from 'node:fs'):
    readFileSync, writeFileSync, appendFileSync, copyFileSync, renameSync
    readdirSync, mkdirSync, rmSync, unlinkSync, rmdirSync
    statSync, lstatSync, existsSync, realpathSync, chmodSync
    symlinkSync, readlinkSync, readFileBuffer
    fs.promises.readFile, fs.promises.writeFile, fs.promises.access, ...

  path: join, resolve, dirname, basename, extname, normalize,
    relative, isAbsolute, parse, format, sep, delimiter

  child_process:
    execSync(cmd)       throws on non-zero exit, returns stdout
    spawnSync(cmd, args) returns { stdout, stderr, status }

  process (also global): argv, cwd(), exit(), env, platform, arch,
    version, versions

  os: platform(), arch(), homedir(), tmpdir(), type(), hostname(),
    EOL, cpus(), endianness()

  url: URL, URLSearchParams, parse(), format()

  assert: ok(), equal(), strictEqual(), deepEqual(), throws(),
    doesNotThrow(), fail()

  util: format(), inspect(), promisify(), types, inherits()

  events: EventEmitter (on, once, emit, off, removeListener, ...)

  buffer: Buffer.from(), Buffer.alloc(), Buffer.concat(),
    Buffer.isBuffer(), toString(), slice(), equals()

  stream: Readable, Writable, Duplex, Transform, PassThrough, pipeline

  string_decoder: StringDecoder (write, end)

  querystring: parse(), stringify(), escape(), unescape()

Other Globals:
  console            log (stdout), error/warn (stderr)
  fetch(url, opts)   HTTP; returns Promise<Response> (Web Fetch API)
  URL, URLSearchParams, Headers, Request, Response
  Buffer             Buffer.from(), Buffer.alloc(), etc.

Not Available:
  http, https, net, tls, crypto, zlib, dns, cluster, worker_threads,
  vm, v8, readline, and other Node.js built-in modules that require
  native bindings. Use fetch() for HTTP requests.

Limits:
  Memory: 64 MB per execution
  Timeout: 10 s (60 s with network; configurable via maxJsTimeoutMs)
  Engine: QuickJS (compiled to WebAssembly)
`;

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
  canceled?: boolean;
};
const executionQueue: QueuedExecution[] = [];
let currentExecution: QueuedExecution | null = null;

const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));

function processNextExecution(): void {
  // Skip canceled entries (timed out before execution started)
  while (executionQueue.length > 0 && executionQueue[0].canceled) {
    executionQueue.shift();
  }
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

/**
 * Validate and normalize a worker message, verifying the protocol token.
 * Rejects malformed or forged messages with a controlled error.
 */
function normalizeJsWorkerMessage(
  msg: unknown,
  expectedProtocolToken: string,
): JsExecWorkerOutput {
  if (!msg || typeof msg !== "object") {
    return { success: false, error: "Malformed worker response" };
  }

  const raw = msg as {
    protocolToken?: unknown;
    success?: unknown;
    error?: unknown;
    defenseStats?: unknown;
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

function getOrCreateWorker(): Worker {
  // Clear any pending idle timeout
  if (workerIdleTimeout) {
    _clearTimeout(workerIdleTimeout);
    workerIdleTimeout = null;
  }

  if (sharedWorker) {
    return sharedWorker;
  }

  const worker = DefenseInDepthBox.runTrusted(() => new Worker(workerPath));
  sharedWorker = worker;

  worker.on("message", (msg: unknown) => {
    // Ignore stale workers that were superseded after timeout/restart.
    if (sharedWorker !== worker) {
      return;
    }
    if (currentExecution) {
      const result = normalizeJsWorkerMessage(
        msg,
        currentExecution.input.protocolToken,
      );
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

  worker.on("error", (err: Error) => {
    if (sharedWorker !== worker) {
      return;
    }
    if (currentExecution) {
      currentExecution.resolve({
        success: false,
        error: sanitizeErrorMessage(err.message),
      });
      currentExecution = null;
    }
    // Reject all queued executions
    for (const queued of executionQueue) {
      queued.resolve({ success: false, error: "Worker crashed" });
    }
    executionQueue.length = 0;
    sharedWorker = null;
  });

  worker.on("exit", () => {
    if (sharedWorker !== worker) {
      return;
    }
    sharedWorker = null;
    if (currentExecution) {
      currentExecution.resolve({
        success: false,
        error: "Worker exited unexpectedly",
      });
      currentExecution = null;
    }
    if (executionQueue.length > 0) {
      processNextExecution();
    }
  });

  return worker;
}

function scheduleWorkerTermination(): void {
  // Terminate worker after 5 seconds of inactivity
  workerIdleTimeout = _setTimeout(() => {
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
  if (jsExecAsyncContext.getStore()) {
    return {
      stdout: "",
      stderr: "js-exec: recursive invocation is not supported\n",
      exitCode: 1,
    };
  }
  return executeJSInner(
    jsCode,
    ctx,
    scriptPath,
    scriptArgs,
    bootstrapCode,
    isModule,
    stripTypes,
  );
}

async function executeJSInner(
  jsCode: string,
  ctx: CommandContext,
  scriptPath?: string,
  scriptArgs: string[] = [],
  bootstrapCode?: string,
  isModule?: boolean,
  stripTypes?: boolean,
): Promise<ExecResult> {
  const sharedBuffer = createSharedBuffer();

  // Wrap ctx.exec to set AsyncLocalStorage context for re-entrant detection.
  // When js-exec's bridge calls exec (child_process.execSync), any nested
  // js-exec call will see the context and fail fast instead of deadlocking.
  const execFn = ctx.exec;
  const wrappedExec: typeof ctx.exec = execFn
    ? (command: string, options: CommandExecOptions) =>
        jsExecAsyncContext.run(true, () => execFn(command, options))
    : undefined;

  const bridgeHandler = new BridgeHandler(
    sharedBuffer,
    ctx.fs,
    ctx.cwd,
    "js-exec",
    ctx.fetch,
    ctx.limits?.maxOutputSize ?? 0,
    wrappedExec,
  );

  // Network operations need a longer timeout. resolveLimits() always populates
  // maxJsTimeoutMs (default 10s), so use the network default as a floor.
  const userTimeout = ctx.limits?.maxJsTimeoutMs ?? DEFAULT_JS_TIMEOUT_MS;
  const timeoutMs = ctx.fetch
    ? Math.max(userTimeout, DEFAULT_JS_NETWORK_TIMEOUT_MS)
    : userTimeout;

  const protocolToken = randomBytes(16).toString("hex");

  const workerInput: JsExecWorkerInput = {
    protocolToken,
    sharedBuffer,
    jsCode,
    cwd: ctx.cwd,
    env: mapToRecord(ctx.env),
    args: scriptArgs,
    scriptPath,
    bootstrapCode,
    isModule,
    stripTypes,
    timeoutMs,
  };

  // Use deferred pattern to keep queue management outside the Promise constructor
  let resolveWorker!: (result: JsExecWorkerOutput) => void;
  const workerPromise = new Promise<JsExecWorkerOutput>((resolve) => {
    resolveWorker = resolve;
  });

  const queueEntry: QueuedExecution = {
    input: workerInput,
    resolve: () => {}, // replaced below
  };

  const timeoutHandle = _setTimeout(() => {
    if (currentExecution === queueEntry) {
      // Worker is running — terminate it
      const workerToTerminate = sharedWorker;
      if (workerToTerminate) {
        // Clear global worker reference before starting the next queued task.
        sharedWorker = null;
        void workerToTerminate.terminate();
      }
      currentExecution = null;
      processNextExecution();
    } else {
      // Worker hasn't started — mark canceled so processNextExecution skips it
      queueEntry.canceled = true;
      if (!currentExecution) {
        processNextExecution();
      }
    }
    queueEntry.resolve({
      success: false,
      error: `Execution timeout: exceeded ${timeoutMs}ms limit`,
    });
  }, timeoutMs);

  queueEntry.resolve = (result: JsExecWorkerOutput) => {
    _clearTimeout(timeoutHandle);
    resolveWorker(result);
  };

  // Queue the execution (serialized since QuickJS is single-threaded)
  executionQueue.push(queueEntry);
  processNextExecution();

  const [bridgeOutput, workerResult] = await Promise.all([
    bridgeHandler.run(timeoutMs),
    workerPromise.catch((e) => ({
      success: false,
      error: sanitizeErrorMessage((e as Error).message),
    })),
  ]);

  if (!workerResult.success && workerResult.error) {
    return {
      stdout: bridgeOutput.stdout,
      stderr: `${bridgeOutput.stderr}js-exec: ${sanitizeErrorMessage(workerResult.error)}\n`,
      exitCode: bridgeOutput.exitCode || 1,
    };
  }

  return bridgeOutput;
}

export const jsExecCommand: Command = {
  name: "js-exec",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return { stdout: JS_EXEC_HELP, stderr: "", exitCode: 0 };
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
          stderr: `js-exec: can't open file '${parsed.scriptFile}': ${sanitizeErrorMessage((e as Error).message)}\n`,
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

    // Auto-detect top-level await → enable module mode
    // Require await followed by identifier/call/bracket to reduce false positives
    // from comments ("// await the result") and strings ("please await")
    if (!isModule && /\bawait\s+[\w([`]/.test(jsCode)) {
      isModule = true;
    }

    // Get bootstrap code from context (threaded via CommandContext, not env)
    const bootstrapCode = ctx.jsBootstrapCode;

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

export const nodeStubCommand: Command = {
  name: "node",
  async execute(): Promise<ExecResult> {
    return {
      stdout: "",
      stderr: `node: this sandbox uses js-exec instead of node\n\n${JS_EXEC_HELP}`,
      exitCode: 1,
    };
  },
};

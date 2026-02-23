/**
 * Worker thread for JavaScript execution via QuickJS.
 * Keeps QuickJS loaded and handles multiple execution requests.
 *
 * Defense-in-depth activates AFTER QuickJS loads (WASM init needs unrestricted JS).
 * User JavaScript code runs inside the QuickJS sandbox with no access to Node.js globals.
 */

import { stripTypeScriptTypes } from "node:module";
import { parentPort } from "node:worker_threads";
import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten";
import {
  WorkerDefenseInDepth,
  type WorkerDefenseStats,
} from "../../security/index.js";
import { SyncBackend } from "../worker-bridge/sync-backend.js";

export interface JsExecWorkerInput {
  sharedBuffer: SharedArrayBuffer;
  jsCode: string;
  cwd: string;
  env: Record<string, string>;
  args: string[];
  scriptPath?: string;
  bootstrapCode?: string;
  isModule?: boolean;
  stripTypes?: boolean;
}

export interface JsExecWorkerOutput {
  success: boolean;
  error?: string;
  defenseStats?: WorkerDefenseStats;
}

let quickjsModule: QuickJSWASMModule | null = null;
let quickjsLoading: Promise<QuickJSWASMModule> | null = null;

async function getQuickJSModule(): Promise<QuickJSWASMModule> {
  if (quickjsModule) {
    return quickjsModule;
  }
  if (quickjsLoading) {
    return quickjsLoading;
  }
  quickjsLoading = getQuickJS();
  quickjsModule = await quickjsLoading;
  return quickjsModule;
}

/** QuickJS memory limit: 64MB */
const MEMORY_LIMIT = 64 * 1024 * 1024;

/** Maximum execution cycles before interrupt check */
const INTERRUPT_CYCLES = 100000;

/**
 * Create an error result for returning from a host function.
 * Uses { error: handle } pattern per quickjs-emscripten VmCallResult.
 */
function throwError(
  context: QuickJSContext,
  message: string,
): { error: QuickJSHandle } {
  return { error: context.newError(message) };
}

/**
 * Convert a JS value to a QuickJS handle.
 */
function jsToHandle(context: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === null || value === undefined) {
    return context.undefined;
  }
  if (typeof value === "string") {
    return context.newString(value);
  }
  if (typeof value === "number") {
    return context.newNumber(value);
  }
  if (typeof value === "boolean") {
    return value ? context.true : context.false;
  }
  if (Array.isArray(value)) {
    const arr = context.newArray();
    for (let i = 0; i < value.length; i++) {
      const elemHandle = jsToHandle(context, value[i]);
      context.setProp(arr, i, elemHandle);
      elemHandle.dispose();
    }
    return arr;
  }
  if (typeof value === "object") {
    const obj = context.newObject();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const valHandle = jsToHandle(context, v);
      context.setProp(obj, k, valHandle);
      valHandle.dispose();
    }
    return obj;
  }
  return context.undefined;
}

/**
 * Resolve a relative or bare module path against a base file or directory.
 */
function resolveModulePath(
  name: string,
  fromFile: string | undefined,
  cwd: string,
): string {
  if (name.startsWith("/")) return name;
  const base = fromFile
    ? fromFile.substring(0, fromFile.lastIndexOf("/")) || "/"
    : cwd;
  const parts = `${base}/${name}`.split("/").filter(Boolean);
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== ".") resolved.push(p);
  }
  return `/${resolved.join("/")}`;
}

/**
 * Virtual built-in module sources.
 * These re-export globals set up by setupContext so they work with ESM imports.
 */
const VIRTUAL_MODULES: Record<string, string> = {
  fs: `
    const _fs = globalThis.fs;
    export const readFile = _fs.readFile;
    export const readFileBuffer = _fs.readFileBuffer;
    export const writeFile = _fs.writeFile;
    export const stat = _fs.stat;
    export const readdir = _fs.readdir;
    export const mkdir = _fs.mkdir;
    export const rm = _fs.rm;
    export const exists = _fs.exists;
    export const appendFile = _fs.appendFile;
    export default _fs;
  `,
  exec: `
    const _exec = globalThis.exec;
    export function exec(cmd, opts) { return _exec(cmd, opts); }
    export default _exec;
  `,
  fetch: `
    const _fetch = globalThis.fetch;
    export default _fetch;
    export { _fetch as fetch };
  `,
  process: `
    const _process = globalThis.process;
    export const argv = _process.argv;
    export const cwd = _process.cwd;
    export const exit = _process.exit;
    export default _process;
  `,
  env: `
    export default globalThis.env;
  `,
  console: `
    const _console = globalThis.console;
    export const log = _console.log;
    export const error = _console.error;
    export const warn = _console.warn;
    export default _console;
  `,
};

/**
 * Set up the QuickJS context with global APIs.
 */
function setupContext(
  context: QuickJSContext,
  backend: SyncBackend,
  input: JsExecWorkerInput,
): void {
  // --- console ---
  const consoleObj = context.newObject();

  const logFn = context.newFunction("log", (...args: QuickJSHandle[]) => {
    const parts = args.map((a) => {
      const val = context.dump(a);
      return typeof val === "string" ? val : JSON.stringify(val);
    });
    backend.writeStdout(`${parts.join(" ")}\n`);
    return context.undefined;
  });
  context.setProp(consoleObj, "log", logFn);
  logFn.dispose();

  const errorFn = context.newFunction("error", (...args: QuickJSHandle[]) => {
    const parts = args.map((a) => {
      const val = context.dump(a);
      return typeof val === "string" ? val : JSON.stringify(val);
    });
    backend.writeStderr(`${parts.join(" ")}\n`);
    return context.undefined;
  });
  context.setProp(consoleObj, "error", errorFn);
  errorFn.dispose();

  // console.warn -> stderr
  const warnFn = context.newFunction("warn", (...args: QuickJSHandle[]) => {
    const parts = args.map((a) => {
      const val = context.dump(a);
      return typeof val === "string" ? val : JSON.stringify(val);
    });
    backend.writeStderr(`${parts.join(" ")}\n`);
    return context.undefined;
  });
  context.setProp(consoleObj, "warn", warnFn);
  warnFn.dispose();

  context.setProp(context.global, "console", consoleObj);
  consoleObj.dispose();

  // --- fs ---
  const fsObj = context.newObject();

  const readFileFn = context.newFunction(
    "readFile",
    (pathHandle: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      try {
        const data = backend.readFile(path);
        return context.newString(new TextDecoder().decode(data));
      } catch (e) {
        return throwError(context, (e as Error).message || "readFile failed");
      }
    },
  );
  context.setProp(fsObj, "readFile", readFileFn);
  readFileFn.dispose();

  const readFileBufferFn = context.newFunction(
    "readFileBuffer",
    (pathHandle: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      try {
        const data = backend.readFile(path);
        // Return as array of numbers (ArrayBuffer not directly supported)
        const arr = context.newArray();
        for (let i = 0; i < data.length; i++) {
          const numHandle = context.newNumber(data[i]);
          context.setProp(arr, i, numHandle);
          numHandle.dispose();
        }
        return arr;
      } catch (e) {
        return throwError(
          context,
          (e as Error).message || "readFileBuffer failed",
        );
      }
    },
  );
  context.setProp(fsObj, "readFileBuffer", readFileBufferFn);
  readFileBufferFn.dispose();

  const writeFileFn = context.newFunction(
    "writeFile",
    (pathHandle: QuickJSHandle, dataHandle: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      const data = context.getString(dataHandle);
      try {
        backend.writeFile(path, new TextEncoder().encode(data));
        return context.undefined;
      } catch (e) {
        return throwError(context, (e as Error).message || "writeFile failed");
      }
    },
  );
  context.setProp(fsObj, "writeFile", writeFileFn);
  writeFileFn.dispose();

  const statFn = context.newFunction("stat", (pathHandle: QuickJSHandle) => {
    const path = context.getString(pathHandle);
    try {
      const stat = backend.stat(path);
      return jsToHandle(context, {
        isFile: stat.isFile,
        isDirectory: stat.isDirectory,
        isSymbolicLink: stat.isSymbolicLink,
        mode: stat.mode,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch (e) {
      return throwError(context, (e as Error).message || "stat failed");
    }
  });
  context.setProp(fsObj, "stat", statFn);
  statFn.dispose();

  const readdirFn = context.newFunction(
    "readdir",
    (pathHandle: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      try {
        const entries = backend.readdir(path);
        return jsToHandle(context, entries);
      } catch (e) {
        return throwError(context, (e as Error).message || "readdir failed");
      }
    },
  );
  context.setProp(fsObj, "readdir", readdirFn);
  readdirFn.dispose();

  const mkdirFn = context.newFunction(
    "mkdir",
    (pathHandle: QuickJSHandle, optsHandle?: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      let recursive = false;
      if (optsHandle) {
        const opts = context.dump(optsHandle);
        if (opts && typeof opts === "object" && "recursive" in opts) {
          recursive = Boolean(opts.recursive);
        }
      }
      try {
        backend.mkdir(path, recursive);
        return context.undefined;
      } catch (e) {
        return throwError(context, (e as Error).message || "mkdir failed");
      }
    },
  );
  context.setProp(fsObj, "mkdir", mkdirFn);
  mkdirFn.dispose();

  const rmFn = context.newFunction(
    "rm",
    (pathHandle: QuickJSHandle, optsHandle?: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      let recursive = false;
      let force = false;
      if (optsHandle) {
        const opts = context.dump(optsHandle);
        if (opts && typeof opts === "object") {
          if ("recursive" in opts) recursive = Boolean(opts.recursive);
          if ("force" in opts) force = Boolean(opts.force);
        }
      }
      try {
        backend.rm(path, recursive, force);
        return context.undefined;
      } catch (e) {
        return throwError(context, (e as Error).message || "rm failed");
      }
    },
  );
  context.setProp(fsObj, "rm", rmFn);
  rmFn.dispose();

  const existsFn = context.newFunction(
    "exists",
    (pathHandle: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      return backend.exists(path) ? context.true : context.false;
    },
  );
  context.setProp(fsObj, "exists", existsFn);
  existsFn.dispose();

  const appendFileFn = context.newFunction(
    "appendFile",
    (pathHandle: QuickJSHandle, dataHandle: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      const data = context.getString(dataHandle);
      try {
        backend.appendFile(path, new TextEncoder().encode(data));
        return context.undefined;
      } catch (e) {
        return throwError(context, (e as Error).message || "appendFile failed");
      }
    },
  );
  context.setProp(fsObj, "appendFile", appendFileFn);
  appendFileFn.dispose();

  context.setProp(context.global, "fs", fsObj);
  fsObj.dispose();

  // --- fetch ---
  const fetchFn = context.newFunction(
    "fetch",
    (urlHandle: QuickJSHandle, optsHandle?: QuickJSHandle) => {
      const url = context.getString(urlHandle);
      let options: Record<string, unknown> | undefined;
      if (optsHandle) {
        options = context.dump(optsHandle) as Record<string, unknown>;
      }
      try {
        const result = backend.httpRequest(url, {
          method: options?.method as string | undefined,
          headers: options?.headers as Record<string, string> | undefined,
          body: options?.body as string | undefined,
        });
        return jsToHandle(context, result);
      } catch (e) {
        return throwError(context, (e as Error).message || "fetch failed");
      }
    },
  );
  context.setProp(context.global, "fetch", fetchFn);
  fetchFn.dispose();

  // --- exec ---
  const execFn = context.newFunction(
    "exec",
    (cmdHandle: QuickJSHandle, optsHandle?: QuickJSHandle) => {
      const command = context.getString(cmdHandle);
      let stdin: string | undefined;
      if (optsHandle) {
        const opts = context.dump(optsHandle) as Record<string, unknown>;
        if (opts?.stdin) {
          stdin = String(opts.stdin);
        }
      }
      try {
        const result = backend.execCommand(command, stdin);
        return jsToHandle(context, result);
      } catch (e) {
        return throwError(context, (e as Error).message || "exec failed");
      }
    },
  );
  context.setProp(context.global, "exec", execFn);
  execFn.dispose();

  // --- env ---
  const envObj = jsToHandle(context, input.env);
  context.setProp(context.global, "env", envObj);
  envObj.dispose();

  // --- process ---
  const processObj = context.newObject();

  // process.argv
  const argv = [input.scriptPath || "js-exec", ...input.args];
  const argvHandle = jsToHandle(context, argv);
  context.setProp(processObj, "argv", argvHandle);
  argvHandle.dispose();

  // process.cwd()
  const cwdFn = context.newFunction("cwd", () => {
    return context.newString(input.cwd);
  });
  context.setProp(processObj, "cwd", cwdFn);
  cwdFn.dispose();

  // process.exit() - signals exit via backend
  const exitFn = context.newFunction("exit", (codeHandle?: QuickJSHandle) => {
    let code = 0;
    if (codeHandle) {
      const val = context.dump(codeHandle);
      code = typeof val === "number" ? val : 0;
    }
    backend.exit(code);
    // Throw to stop execution
    return throwError(context, "__EXIT__");
  });
  context.setProp(processObj, "exit", exitFn);
  exitFn.dispose();

  context.setProp(context.global, "process", processObj);
  processObj.dispose();
}

// Defense-in-depth instance - activated AFTER QuickJS loads
let defense: WorkerDefenseInDepth | null = null;

async function initializeWithDefense(): Promise<void> {
  await getQuickJSModule();

  // Pre-warm stripTypeScriptTypes before defense-in-depth activates.
  // The first call emits an ExperimentalWarning via console which
  // accesses process.env. This must happen before defense blocks
  // process.env access, otherwise the warning handler deadlocks the worker.
  try {
    stripTypeScriptTypes("const x = 1;");
  } catch {
    // Ignore errors during warm-up
  }
  // Yield to let the ExperimentalWarning flush through the event loop
  await new Promise<void>((r) => setTimeout(r, 0));

  // Activate defense after QuickJS is loaded.
  // QuickJS needs only SharedArrayBuffer + Atomics exclusions
  // (for the sync protocol between worker and main thread).
  defense = new WorkerDefenseInDepth({
    excludeViolationTypes: ["shared_array_buffer", "atomics"],
  });
}

async function executeCode(
  input: JsExecWorkerInput,
): Promise<JsExecWorkerOutput> {
  const qjs = await getQuickJSModule();
  const backend = new SyncBackend(input.sharedBuffer);

  let runtime: QuickJSRuntime | undefined;
  let context: QuickJSContext | undefined;
  try {
    runtime = qjs.newRuntime();
    runtime.setMemoryLimit(MEMORY_LIMIT);

    // Set up interrupt handler for infinite loop protection
    let interruptCount = 0;
    runtime.setInterruptHandler(() => {
      interruptCount++;
      // Check every INTERRUPT_CYCLES if we should abort
      return interruptCount > INTERRUPT_CYCLES;
    });

    context = runtime.newContext();
    setupContext(context, backend, input);

    // Set up module loader if module mode is enabled
    if (input.isModule) {
      runtime.setModuleLoader(
        (moduleName: string) => {
          // Check virtual built-in modules first
          const virtualSource = VIRTUAL_MODULES[moduleName];
          if (virtualSource) return virtualSource;

          // Resolve from VFS via sync backend
          try {
            const data = backend.readFile(moduleName);
            let source = new TextDecoder().decode(data);
            // Strip TypeScript types from .ts/.mts imports
            if (moduleName.endsWith(".ts") || moduleName.endsWith(".mts")) {
              source = stripTypeScriptTypes(source);
            }
            return source;
          } catch (e) {
            return {
              error: new Error(
                `Cannot find module '${moduleName}': ${(e as Error).message}`,
              ),
            };
          }
        },
        (baseModuleName: string, requestedName: string) => {
          // Bare specifiers (built-in names) pass through
          if (
            !requestedName.startsWith("./") &&
            !requestedName.startsWith("../") &&
            !requestedName.startsWith("/")
          ) {
            return requestedName;
          }
          // Normalize relative paths against the importing file's directory
          const baseDir =
            baseModuleName === "<eval>"
              ? input.cwd
              : baseModuleName.substring(0, baseModuleName.lastIndexOf("/")) ||
                "/";
          return resolveModulePath(requestedName, baseModuleName, baseDir);
        },
      );
    }

    // Run bootstrap code if provided
    if (input.bootstrapCode) {
      const bootstrapResult = context.evalCode(
        input.bootstrapCode,
        "bootstrap.js",
      );
      if (bootstrapResult.error) {
        const errorVal = context.dump(bootstrapResult.error);
        bootstrapResult.error.dispose();
        const errorMsg =
          typeof errorVal === "object" &&
          errorVal !== null &&
          "message" in errorVal
            ? (errorVal as { message: string }).message
            : String(errorVal);
        backend.writeStderr(`js-exec: bootstrap error: ${errorMsg}\n`);
        backend.exit(1);
        return { success: true };
      }
      bootstrapResult.value.dispose();
    }

    // Run user code
    const filename = input.scriptPath || "<eval>";
    let jsCode = input.jsCode;
    // Strip TypeScript type annotations using Node.js built-in
    if (input.stripTypes) {
      jsCode = stripTypeScriptTypes(jsCode);
    }
    const evalOptions: { type?: "global" | "module" } = {};
    if (input.isModule) evalOptions.type = "module";
    const result = context.evalCode(jsCode, filename, evalOptions);

    if (result.error) {
      const errorVal = context.dump(result.error);
      result.error.dispose();
      const errorMsg =
        typeof errorVal === "object" &&
        errorVal !== null &&
        "message" in errorVal
          ? (errorVal as { message: string }).message
          : String(errorVal);

      // Check if this is a process.exit() call
      if (errorMsg === "__EXIT__") {
        // Exit was already signaled via backend.exit()
        return { success: true };
      }

      backend.writeStderr(`${errorMsg}\n`);
      backend.exit(1);
      return { success: true };
    }

    // Execute pending jobs for module evaluation (module bodies may
    // be deferred). Must happen before exit so bridge is still alive.
    if (input.isModule) {
      const pendingResult = runtime.executePendingJobs();
      if ("error" in pendingResult && pendingResult.error) {
        const errorVal = context.dump(pendingResult.error);
        pendingResult.error.dispose();
        const errorMsg =
          typeof errorVal === "object" &&
          errorVal !== null &&
          "message" in errorVal
            ? (errorVal as { message: string }).message
            : String(errorVal);
        if (errorMsg !== "__EXIT__") {
          backend.writeStderr(`${errorMsg}\n`);
          backend.exit(1);
          return { success: true };
        }
        return { success: true };
      }
    }

    result.value.dispose();

    // Signal normal exit (exitCode 0) if not already exited
    backend.exit(0);

    return {
      success: true,
      defenseStats: defense?.getStats(),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Try to report error and exit
    try {
      backend.writeStderr(`js-exec: ${message}\n`);
      backend.exit(1);
    } catch {
      // Bridge might be broken, report via worker output
      return { success: false, error: message };
    }
    return { success: true };
  } finally {
    context?.dispose();
    runtime?.dispose();
  }
}

// Initial load: initialize with defense-in-depth
initializeWithDefense()
  .then(async () => {
    // If there's a queued message from workerData, process it
    // (workerData is not used - messages come via parentPort)
  })
  .catch((e) => {
    parentPort?.postMessage({
      success: false,
      error: (e as Error).message,
      defenseStats: defense?.getStats(),
    });
  });

// Handle messages from main thread
parentPort?.on("message", async (input: JsExecWorkerInput) => {
  try {
    // Defense should already be active from initial load
    if (!defense) {
      await initializeWithDefense();
    }
    const result = await executeCode(input);
    result.defenseStats = defense?.getStats();
    parentPort?.postMessage(result);
  } catch (e) {
    parentPort?.postMessage({
      success: false,
      error: (e as Error).message,
      defenseStats: defense?.getStats(),
    });
  }
});

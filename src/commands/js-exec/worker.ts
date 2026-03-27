/**
 * Worker thread for JavaScript execution via QuickJS.
 * Keeps QuickJS loaded and handles multiple execution requests.
 *
 * Defense-in-depth activates AFTER QuickJS loads (WASM init needs unrestricted JS).
 * User JavaScript code runs inside the QuickJS sandbox with no access to Node.js globals.
 *
 * Build: Bundled to worker.js via esbuild (see package.json "build:worker").
 * Run: npx esbuild src/commands/js-exec/worker.ts --bundle --platform=node --format=esm --outfile=src/commands/js-exec/worker.js --external:quickjs-emscripten
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
import { FETCH_POLYFILL_SOURCE } from "./fetch-polyfill.js";
import {
  ASSERT_MODULE_SOURCE,
  BUFFER_MODULE_SOURCE,
  EVENTS_MODULE_SOURCE,
  OS_MODULE_SOURCE,
  QUERYSTRING_MODULE_SOURCE,
  STREAM_MODULE_SOURCE,
  STRING_DECODER_MODULE_SOURCE,
  UNSUPPORTED_MODULES,
  URL_MODULE_SOURCE,
  UTIL_MODULE_SOURCE,
} from "./module-shims.js";
import { PATH_MODULE_SOURCE } from "./path-polyfill.js";

export interface JsExecWorkerInput {
  protocolToken: string;
  sharedBuffer: SharedArrayBuffer;
  jsCode: string;
  cwd: string;
  env: Record<string, string>;
  args: string[];
  scriptPath?: string;
  bootstrapCode?: string;
  isModule?: boolean;
  stripTypes?: boolean;
  timeoutMs?: number;
  /** When true, tools proxy is available (console still goes to stdout/stderr) */
  hasExecutorTools?: boolean;
  /** When true, runs in full executor mode: tools proxy, log capture, result capture */
  executorMode?: boolean;
}

export interface JsExecWorkerOutput {
  protocolToken?: string;
  success: boolean;
  error?: string;
  defenseStats?: WorkerDefenseStats;
  /** JSON-serialized return value (executor mode only) */
  executorResult?: string;
  /** Captured console logs (executor mode only) */
  executorLogs?: string[];
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
 * Format a dumped QuickJS error value into a readable error string
 * that includes the file name and line number from the stack trace.
 */
function formatError(errorVal: unknown): string {
  if (
    typeof errorVal === "object" &&
    errorVal !== null &&
    "message" in errorVal
  ) {
    const err = errorVal as { message: string; stack?: string };
    const msg = err.message;
    // Extract file:line from the stack trace
    if (err.stack) {
      const lines = err.stack.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("at ")) {
          // Stack line like "at /home/user/file.mjs:3" or "at func (/file.mjs:3)"
          // Strip "<eval>" wrapper for file-based scripts so the output matches
          // the cleaner syntax-error format: "at /path/file.js:2:1: message"
          const cleaned = trimmed.replace(/^at <eval> \((\/.+)\)$/, "at $1");
          return `${cleaned}: ${msg}`;
        }
      }
    }
    return msg;
  }
  return String(errorVal);
}

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
const VIRTUAL_MODULES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    fs: `
    const _fs = globalThis.fs;
    export const readFile = _fs.readFile;
    export const readFileSync = function(path, opts) { return _fs.readFileSync(path, opts); };
    export const readFileBuffer = _fs.readFileBuffer;
    export const writeFile = _fs.writeFile;
    export const writeFileSync = _fs.writeFileSync;
    export const stat = _fs.stat;
    export const statSync = _fs.statSync;
    export const lstat = _fs.lstat;
    export const lstatSync = _fs.lstatSync;
    export const readdir = _fs.readdir;
    export const readdirSync = _fs.readdirSync;
    export const mkdir = _fs.mkdir;
    export const mkdirSync = _fs.mkdirSync;
    export const rm = _fs.rm;
    export const rmSync = _fs.rmSync;
    export const exists = _fs.exists;
    export const existsSync = _fs.existsSync;
    export const appendFile = _fs.appendFile;
    export const appendFileSync = _fs.appendFileSync;
    export const symlink = _fs.symlink;
    export const symlinkSync = _fs.symlinkSync;
    export const readlink = _fs.readlink;
    export const readlinkSync = _fs.readlinkSync;
    export const chmod = _fs.chmod;
    export const chmodSync = _fs.chmodSync;
    export const realpath = _fs.realpath;
    export const realpathSync = _fs.realpathSync;
    export const rename = _fs.rename;
    export const renameSync = _fs.renameSync;
    export const copyFile = _fs.copyFile;
    export const copyFileSync = _fs.copyFileSync;
    export const unlinkSync = _fs.unlinkSync;
    export const unlink = _fs.unlink;
    export const rmdirSync = _fs.rmdirSync;
    export const rmdir = _fs.rmdir;
    export const promises = _fs.promises;
    export default _fs;
  `,
    path: `${PATH_MODULE_SOURCE}
    const _path = globalThis[Symbol.for('jb:path')];
    export const join = _path.join;
    export const resolve = _path.resolve;
    export const normalize = _path.normalize;
    export const isAbsolute = _path.isAbsolute;
    export const dirname = _path.dirname;
    export const basename = _path.basename;
    export const extname = _path.extname;
    export const relative = _path.relative;
    export const parse = _path.parse;
    export const format = _path.format;
    export const sep = _path.sep;
    export const delimiter = _path.delimiter;
    export const posix = _path.posix;
    export default _path;
  `,
    process: `
    const _process = globalThis.process;
    export const argv = _process.argv;
    export const cwd = _process.cwd;
    export const exit = _process.exit;
    export const env = _process.env;
    export const platform = _process.platform;
    export const arch = _process.arch;
    export const versions = _process.versions;
    export const version = _process.version;
    export default _process;
  `,
    child_process: `
    const _exec = globalThis[Symbol.for('jb:exec')];
    const _execArgs = globalThis[Symbol.for('jb:execArgs')];
    export function execSync(cmd, opts) {
      var r = _exec(cmd, opts);
      if (r.exitCode !== 0) {
        var e = new Error('Command failed: ' + cmd);
        e.status = r.exitCode;
        e.stderr = r.stderr;
        e.stdout = r.stdout;
        throw e;
      }
      return r.stdout;
    }
    export function exec(cmd, opts) { return _exec(cmd, opts); }
    export function spawnSync(cmd, args, opts) {
      var r = _execArgs(cmd, args || []);
      return { stdout: r.stdout, stderr: r.stderr, status: r.exitCode };
    }
    export default { exec: exec, execSync: execSync, spawnSync: spawnSync };
  `,
    os: `
    const _os = globalThis[Symbol.for('jb:os')];
    export const platform = _os.platform;
    export const arch = _os.arch;
    export const homedir = _os.homedir;
    export const tmpdir = _os.tmpdir;
    export const type = _os.type;
    export const hostname = _os.hostname;
    export const EOL = _os.EOL;
    export const cpus = _os.cpus;
    export const totalmem = _os.totalmem;
    export const freemem = _os.freemem;
    export const endianness = _os.endianness;
    export default _os;
  `,
    url: `
    const _url = globalThis[Symbol.for('jb:url')];
    export const URL = _url.URL;
    export const URLSearchParams = _url.URLSearchParams;
    export const parse = _url.parse;
    export const format = _url.format;
    export default _url;
  `,
    assert: `
    const _assert = globalThis[Symbol.for('jb:assert')];
    export const ok = _assert.ok;
    export const equal = _assert.equal;
    export const notEqual = _assert.notEqual;
    export const strictEqual = _assert.strictEqual;
    export const notStrictEqual = _assert.notStrictEqual;
    export const deepEqual = _assert.deepEqual;
    export const deepStrictEqual = _assert.deepStrictEqual;
    export const notDeepEqual = _assert.notDeepEqual;
    export const throws = _assert.throws;
    export const doesNotThrow = _assert.doesNotThrow;
    export const fail = _assert.fail;
    export default _assert;
  `,
    util: `
    const _util = globalThis[Symbol.for('jb:util')];
    export const format = _util.format;
    export const inspect = _util.inspect;
    export const promisify = _util.promisify;
    export const types = _util.types;
    export const inherits = _util.inherits;
    export default _util;
  `,
    events: `
    const _events = globalThis[Symbol.for('jb:events')];
    export const EventEmitter = _events.EventEmitter;
    export default _events;
  `,
    buffer: `
    const _buffer = globalThis[Symbol.for('jb:buffer')];
    export const Buffer = _buffer.Buffer;
    export default _buffer;
  `,
    stream: `
    const _stream = globalThis[Symbol.for('jb:stream')];
    export const Stream = _stream.Stream;
    export const Readable = _stream.Readable;
    export const Writable = _stream.Writable;
    export const Duplex = _stream.Duplex;
    export const Transform = _stream.Transform;
    export const PassThrough = _stream.PassThrough;
    export const pipeline = _stream.pipeline;
    export default _stream;
  `,
    string_decoder: `
    const _sd = globalThis[Symbol.for('jb:string_decoder')];
    export const StringDecoder = _sd.StringDecoder;
    export default _sd;
  `,
    querystring: `
    const _qs = globalThis[Symbol.for('jb:querystring')];
    export const parse = _qs.parse;
    export const stringify = _qs.stringify;
    export const escape = _qs.escape;
    export const unescape = _qs.unescape;
    export const decode = _qs.decode;
    export const encode = _qs.encode;
    export default _qs;
  `,
  },
);

// Add throw-at-import stubs for unsupported Node.js modules
for (const [name, hint] of Object.entries(UNSUPPORTED_MODULES)) {
  VIRTUAL_MODULES[name] =
    `throw new Error("Module '${name}' is not available in the js-exec sandbox. ${hint} Run 'js-exec --help' for available modules.");`;
}

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
    try {
      backend.writeStdout(`${parts.join(" ")}\n`);
    } catch (e) {
      return throwError(context, (e as Error).message || "write failed");
    }
    return context.undefined;
  });
  context.setProp(consoleObj, "log", logFn);
  logFn.dispose();

  const errorFn = context.newFunction("error", (...args: QuickJSHandle[]) => {
    const parts = args.map((a) => {
      const val = context.dump(a);
      return typeof val === "string" ? val : JSON.stringify(val);
    });
    try {
      backend.writeStderr(`${parts.join(" ")}\n`);
    } catch (e) {
      return throwError(context, (e as Error).message || "write failed");
    }
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
    try {
      backend.writeStderr(`${parts.join(" ")}\n`);
    } catch (e) {
      return throwError(context, (e as Error).message || "write failed");
    }
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
        // Return as ArrayBuffer (single handle instead of per-byte handles)
        return context.newArrayBuffer(
          data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        );
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

  const lstatFn = context.newFunction("lstat", (pathHandle: QuickJSHandle) => {
    const path = context.getString(pathHandle);
    try {
      const s = backend.lstat(path);
      return jsToHandle(context, {
        isFile: s.isFile,
        isDirectory: s.isDirectory,
        isSymbolicLink: s.isSymbolicLink,
        mode: s.mode,
        size: s.size,
        mtime: s.mtime.toISOString(),
      });
    } catch (e) {
      return throwError(context, (e as Error).message || "lstat failed");
    }
  });
  context.setProp(fsObj, "lstat", lstatFn);
  lstatFn.dispose();

  const symlinkFn = context.newFunction(
    "symlink",
    (targetHandle: QuickJSHandle, pathHandle: QuickJSHandle) => {
      const target = context.getString(targetHandle);
      const linkPath = context.getString(pathHandle);
      try {
        backend.symlink(target, linkPath);
        return context.undefined;
      } catch (e) {
        return throwError(context, (e as Error).message || "symlink failed");
      }
    },
  );
  context.setProp(fsObj, "symlink", symlinkFn);
  symlinkFn.dispose();

  const readlinkFn = context.newFunction(
    "readlink",
    (pathHandle: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      try {
        const target = backend.readlink(path);
        return context.newString(target);
      } catch (e) {
        return throwError(context, (e as Error).message || "readlink failed");
      }
    },
  );
  context.setProp(fsObj, "readlink", readlinkFn);
  readlinkFn.dispose();

  const chmodFn = context.newFunction(
    "chmod",
    (pathHandle: QuickJSHandle, modeHandle: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      const mode = context.dump(modeHandle);
      try {
        backend.chmod(path, typeof mode === "number" ? mode : 0);
        return context.undefined;
      } catch (e) {
        return throwError(context, (e as Error).message || "chmod failed");
      }
    },
  );
  context.setProp(fsObj, "chmod", chmodFn);
  chmodFn.dispose();

  const realpathFn = context.newFunction(
    "realpath",
    (pathHandle: QuickJSHandle) => {
      const path = context.getString(pathHandle);
      try {
        const resolved = backend.realpath(path);
        return context.newString(resolved);
      } catch (e) {
        return throwError(context, (e as Error).message || "realpath failed");
      }
    },
  );
  context.setProp(fsObj, "realpath", realpathFn);
  realpathFn.dispose();

  const renameFn = context.newFunction(
    "rename",
    (oldHandle: QuickJSHandle, newHandle: QuickJSHandle) => {
      const oldPath = context.getString(oldHandle);
      const newPath = context.getString(newHandle);
      try {
        backend.rename(oldPath, newPath);
        return context.undefined;
      } catch (e) {
        return throwError(context, (e as Error).message || "rename failed");
      }
    },
  );
  context.setProp(fsObj, "rename", renameFn);
  renameFn.dispose();

  const copyFileFn = context.newFunction(
    "copyFile",
    (srcHandle: QuickJSHandle, destHandle: QuickJSHandle) => {
      const src = context.getString(srcHandle);
      const dest = context.getString(destHandle);
      try {
        backend.copyFile(src, dest);
        return context.undefined;
      } catch (e) {
        return throwError(context, (e as Error).message || "copyFile failed");
      }
    },
  );
  context.setProp(fsObj, "copyFile", copyFileFn);
  copyFileFn.dispose();

  context.setProp(context.global, "fs", fsObj);
  fsObj.dispose();

  // --- fetch ---
  const fetchFn = context.newFunction(
    "fetch",
    (urlHandle: QuickJSHandle, optsHandle?: QuickJSHandle) => {
      const url = context.getString(urlHandle);
      // @banned-pattern-ignore: static keys only, never accessed with user input
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
  context.setProp(context.global, "__fetch", fetchFn);
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
  context.setProp(context.global, "__exec", execFn);
  execFn.dispose();

  // --- execArgs (structured args for spawnSync injection safety) ---
  const execArgsFn = context.newFunction(
    "execArgs",
    (cmdHandle: QuickJSHandle, argsHandle: QuickJSHandle) => {
      const command = context.getString(cmdHandle);
      const args: string[] = context.dump(argsHandle) as string[];
      try {
        const result = backend.execCommandArgs(command, args);
        return jsToHandle(context, result);
      } catch (e) {
        return throwError(context, (e as Error).message || "exec failed");
      }
    },
  );
  context.setProp(context.global, "__execArgs", execArgsFn);
  execArgsFn.dispose();

  // --- tool invocation (executor tools or executor mode) ---
  if (input.hasExecutorTools || input.executorMode) {
    const invokeToolFn = context.newFunction(
      "__invokeTool",
      (pathHandle: QuickJSHandle, argsHandle: QuickJSHandle) => {
        const path = context.getString(pathHandle);
        const argsJson = context.getString(argsHandle);
        try {
          const resultJson = backend.invokeTool(path, argsJson);
          return context.newString(resultJson);
        } catch (e) {
          return throwError(
            context,
            (e as Error).message || "tool invocation failed",
          );
        }
      },
    );
    context.setProp(context.global, "__invokeTool", invokeToolFn);
    invokeToolFn.dispose();
  }

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

  // Set up Node.js compatibility: sync aliases, promises, callback detection, process enhancements
  const compatResult = context.evalCode(
    `(function() {
  // Bridge native handles from string keys (set by QuickJS setProp) to symbol keys
  globalThis[Symbol.for('jb:fetch')] = globalThis.__fetch;
  globalThis[Symbol.for('jb:exec')] = globalThis.__exec;
  globalThis[Symbol.for('jb:execArgs')] = globalThis.__execArgs;
  delete globalThis.__fetch;
  delete globalThis.__exec;
  delete globalThis.__execArgs;

  var _fs = globalThis.fs;
  // Save original native functions
  var orig = Object.create(null);
  var allNames = [
    'readFile', 'readFileBuffer', 'writeFile', 'stat', 'lstat', 'readdir',
    'mkdir', 'rm', 'exists', 'appendFile', 'symlink', 'readlink',
    'chmod', 'realpath', 'rename', 'copyFile'
  ];
  for (var i = 0; i < allNames.length; i++) {
    orig[allNames[i]] = _fs[allNames[i]];
  }

  // Wrap async-style methods to always throw (matching Node.js which requires a callback).
  // In Node.js, calling fs.readFile() without a callback throws TypeError.
  // We don't support callbacks, so the async form always errors.
  function wrapCb(fn, name) {
    return function() {
      throw new Error(
        "fs." + name + "() with callbacks is not supported. " +
        "Use fs." + name + "Sync() or fs.promises." + name + "() instead."
      );
    };
  }
  var cbNames = [
    'readFile', 'writeFile', 'stat', 'lstat', 'readdir', 'mkdir',
    'rm', 'appendFile', 'symlink', 'readlink', 'chmod', 'realpath',
    'rename', 'copyFile'
  ];
  for (var i = 0; i < cbNames.length; i++) {
    if (orig[cbNames[i]]) _fs[cbNames[i]] = wrapCb(orig[cbNames[i]], cbNames[i]);
  }
  // exists: callback is especially common in legacy Node.js
  _fs.exists = wrapCb(orig.exists, 'exists');

  // readFileSync: match Node.js behavior
  // - No encoding: return Buffer
  // - With encoding (e.g. 'utf8'): return string
  _fs.readFileSync = function(path, opts) {
    var encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
    if (encoding) return orig.readFile(path);
    return Buffer.from(orig.readFileBuffer(path));
  };
  _fs.writeFileSync = orig.writeFile;
  _fs.statSync = orig.stat;
  _fs.lstatSync = orig.lstat;
  _fs.readdirSync = orig.readdir;
  _fs.mkdirSync = orig.mkdir;
  _fs.rmSync = orig.rm;
  _fs.existsSync = orig.exists;
  _fs.appendFileSync = orig.appendFile;
  _fs.symlinkSync = orig.symlink;
  _fs.readlinkSync = orig.readlink;
  _fs.chmodSync = orig.chmod;
  _fs.realpathSync = orig.realpath;
  _fs.renameSync = orig.rename;
  _fs.copyFileSync = orig.copyFile;
  _fs.unlinkSync = orig.rm;
  _fs.rmdirSync = orig.rm;
  _fs.unlink = wrapCb(orig.rm, 'unlink');
  _fs.rmdir = wrapCb(orig.rm, 'rmdir');

  // promises namespace
  _fs.promises = {};
  for (var i = 0; i < allNames.length; i++) {
    var m = allNames[i];
    (function(fn) {
      _fs.promises[m] = function() {
        try { return Promise.resolve(fn.apply(null, arguments)); }
        catch(e) { return Promise.reject(e); }
      };
    })(orig[m]);
  }
  // Override promises.readFile to match Node.js behavior (Buffer vs string)
  _fs.promises.readFile = function(path, opts) {
    var encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
    try {
      if (encoding) return Promise.resolve(orig.readFile(path));
      return Promise.resolve(Buffer.from(orig.readFileBuffer(path)));
    } catch(e) { return Promise.reject(e); }
  };
  _fs.promises.unlink = _fs.promises.rm;
  _fs.promises.rmdir = _fs.promises.rm;
  _fs.promises.access = function(p) {
    return orig.exists(p) ? Promise.resolve() : Promise.reject(new Error('ENOENT: no such file or directory: ' + p));
  };

  // process enhancements
  var _p = globalThis.process;
  _p.env = globalThis.env;
  _p.platform = 'linux';
  _p.arch = 'x64';
  _p.versions = { node: '22.0.0', quickjs: '2024' };
  _p.version = 'v22.0.0';

  // Initialize path module on globalThis so require('path') works
  ${PATH_MODULE_SOURCE}

  // Initialize fetch polyfill (URL, Headers, Request, Response, fetch)
  ${FETCH_POLYFILL_SOURCE}

  // Initialize additional module shims
  ${EVENTS_MODULE_SOURCE}
  ${OS_MODULE_SOURCE}
  ${URL_MODULE_SOURCE}
  ${ASSERT_MODULE_SOURCE}
  ${UTIL_MODULE_SOURCE}
  ${BUFFER_MODULE_SOURCE}
  ${STREAM_MODULE_SOURCE}
  ${STRING_DECODER_MODULE_SOURCE}
  ${QUERYSTRING_MODULE_SOURCE}

  // Wrap console methods to auto-stringify Buffer arguments.
  // In Node.js, console.log(buffer) calls util.inspect → toString().
  (function() {
    var _cl = console.log;
    var _ce = console.error;
    var _cw = console.warn;
    function fix(a) { return a instanceof Buffer ? a.toString() : a; }
    function wrap(fn) {
      return function() {
        var a = [];
        for (var i = 0; i < arguments.length; i++) a.push(fix(arguments[i]));
        return fn.apply(console, a);
      };
    }
    console.log = wrap(_cl);
    console.error = wrap(_ce);
    console.warn = wrap(_cw);
  })();

  // require() shim for CommonJS compatibility
  var _execFn = globalThis[Symbol.for('jb:exec')];
  var _execArgsFn = globalThis[Symbol.for('jb:execArgs')];
  var _childProcess = {
    exec: function(cmd, opts) { return _execFn(cmd, opts); },
    execSync: function(cmd, opts) {
      var r = _execFn(cmd, opts);
      if (r.exitCode !== 0) {
        var e = new Error('Command failed: ' + cmd);
        e.status = r.exitCode;
        e.stderr = r.stderr;
        e.stdout = r.stdout;
        throw e;
      }
      return r.stdout;
    },
    spawnSync: function(cmd, args, opts) {
      var r = _execArgsFn(cmd, args || []);
      return { stdout: r.stdout, stderr: r.stderr, status: r.exitCode };
    }
  };

  var _modules = Object.create(null);
  _modules.fs = _fs;
  _modules.path = globalThis[Symbol.for('jb:path')];
  _modules.child_process = _childProcess;
  _modules.process = _p;
  _modules.console = globalThis.console;
  _modules.os = globalThis[Symbol.for('jb:os')];
  _modules.url = globalThis[Symbol.for('jb:url')];
  _modules.assert = globalThis[Symbol.for('jb:assert')];
  _modules.util = globalThis[Symbol.for('jb:util')];
  _modules.events = globalThis[Symbol.for('jb:events')];
  _modules.buffer = globalThis[Symbol.for('jb:buffer')];
  _modules.stream = globalThis[Symbol.for('jb:stream')];
  _modules.string_decoder = globalThis[Symbol.for('jb:string_decoder')];
  _modules.querystring = globalThis[Symbol.for('jb:querystring')];

  var _unsupported = Object.create(null);
  var _unsupportedRaw = ${JSON.stringify(UNSUPPORTED_MODULES)};
  Object.keys(_unsupportedRaw).forEach(function(_key) {
    _unsupported[_key] = _unsupportedRaw[_key];
  });

  globalThis.require = function(name) {
    if (name.startsWith('node:')) name = name.slice(5);
    if (Object.prototype.hasOwnProperty.call(_modules, name)) {
      return _modules[name];
    }
    if (Object.prototype.hasOwnProperty.call(_unsupported, name)) {
      var hint = _unsupported[name];
      throw new Error("Module '" + name + "' is not available in the js-exec sandbox. " + hint + " Run 'js-exec --help' for available modules.");
    }
    throw new Error("Cannot find module '" + name + "'. Run 'js-exec --help' for available modules.");
  };
  globalThis.require.resolve = function(name) { return name; };
})();`,
    "<compat>",
  );
  if (compatResult.error) {
    compatResult.error.dispose();
  } else {
    compatResult.value.dispose();
  }
}

// Pre-capture process.exit before defense-in-depth blocks it.
// Used by uncaughtException handler to cleanly terminate the worker
// when a defense violation or other fatal error occurs.
const originalProcessExit = process.exit.bind(process);

// Catch uncaught exceptions (e.g., defense-in-depth violations that escape
// try/catch blocks). Without this, blocking process.exit causes the worker
// to hang since Node.js's _fatalException handler can't terminate it.
process.on("uncaughtException", () => {
  originalProcessExit(1);
});

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
  // Yield to let the ExperimentalWarning flush through the event loop.
  // Must use setTimeout (not Promise.resolve) because the warning is a macrotask.
  await new Promise<void>((r) => setTimeout(r, 0));

  // Activate defense after QuickJS is loaded.
  // QuickJS needs only SharedArrayBuffer + Atomics exclusions
  // (for the sync protocol between worker and main thread).
  defense = new WorkerDefenseInDepth({
    excludeViolationTypes: [
      // SharedArrayBuffer/Atomics: Used by sync-backend for synchronous
      // filesystem communication between the worker and main thread.
      "shared_array_buffer",
      "atomics",
      // process.stdout/stderr: Emscripten (quickjs-emscripten) routes WASM
      // stdout/stderr through Node.js console which uses process.stdout/stderr.
      // User code runs inside QuickJS with no access to Node.js process.
      "process_stdout",
      "process_stderr",
    ],
  });
}

/**
 * JavaScript source that sets up just the tools proxy (no console override).
 * Used when hasExecutorTools is true but executorMode is false.
 * Console output still goes to stdout/stderr normally.
 */
const TOOLS_ONLY_SETUP_SOURCE = `(function() {
  globalThis.tools = (function makeProxy(path) {
    return new Proxy(function(){}, {
      get: function(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return makeProxy(path.concat([String(prop)]));
      },
      apply: function(_t, _this, args) {
        var toolPath = path.join('.');
        if (!toolPath) throw new Error('Tool path missing in invocation');
        var argsJson = args[0] !== undefined ? JSON.stringify(args[0]) : '{}';
        var resultJson = globalThis.__invokeTool(toolPath, argsJson);
        return resultJson !== undefined && resultJson !== '' ? JSON.parse(resultJson) : undefined;
      }
    });
  })([]);
})();`;

/**
 * JavaScript source that sets up the full executor environment inside QuickJS.
 * - Overrides console to capture logs to an array
 * - Creates a tools proxy that calls __invokeTool via the SAB bridge
 * Runs after sandbox hardening so Proxy/object literals still work.
 */
const EXECUTOR_SETUP_SOURCE = `(function() {
  var __logs = [];
  globalThis[Symbol.for('jb:executorLogs')] = __logs;

  var _fmt = function(v) {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); }
    catch(e) { return String(v); }
  };

  globalThis.console = {
    log: function() { var a = []; for(var i=0;i<arguments.length;i++) a.push(_fmt(arguments[i])); __logs.push('[log] ' + a.join(' ')); },
    error: function() { var a = []; for(var i=0;i<arguments.length;i++) a.push(_fmt(arguments[i])); __logs.push('[error] ' + a.join(' ')); },
    warn: function() { var a = []; for(var i=0;i<arguments.length;i++) a.push(_fmt(arguments[i])); __logs.push('[warn] ' + a.join(' ')); },
    info: function() { var a = []; for(var i=0;i<arguments.length;i++) a.push(_fmt(arguments[i])); __logs.push('[info] ' + a.join(' ')); },
    debug: function() { var a = []; for(var i=0;i<arguments.length;i++) a.push(_fmt(arguments[i])); __logs.push('[debug] ' + a.join(' ')); },
  };

  globalThis.tools = (function makeProxy(path) {
    return new Proxy(function(){}, {
      get: function(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return makeProxy(path.concat([String(prop)]));
      },
      apply: function(_t, _this, args) {
        var toolPath = path.join('.');
        if (!toolPath) throw new Error('Tool path missing in invocation');
        var argsJson = args[0] !== undefined ? JSON.stringify(args[0]) : '{}';
        var resultJson = globalThis.__invokeTool(toolPath, argsJson);
        return resultJson !== undefined && resultJson !== '' ? JSON.parse(resultJson) : undefined;
      }
    });
  })([]);
})();`;

/**
 * Read executor logs from the QuickJS context.
 */
function readExecutorLogs(context: QuickJSContext): string[] {
  const logsResult = context.evalCode(
    `globalThis[Symbol.for('jb:executorLogs')]`,
    "<read-logs>",
  );
  if (logsResult.error) {
    logsResult.error.dispose();
    return [];
  }
  const logs = context.dump(logsResult.value) as string[];
  logsResult.value.dispose();
  return Array.isArray(logs) ? logs : [];
}

/**
 * Read a property from a QuickJS handle and dump its value.
 */
function readPropDump(
  context: QuickJSContext,
  handle: QuickJSHandle,
  key: string,
): unknown {
  const prop = context.getProp(handle, key);
  try {
    return context.dump(prop);
  } finally {
    prop.dispose();
  }
}

async function executeCode(
  input: JsExecWorkerInput,
): Promise<JsExecWorkerOutput> {
  const qjs = await getQuickJSModule();
  const backend = new SyncBackend(input.sharedBuffer, input.timeoutMs);

  let runtime: QuickJSRuntime | undefined;
  let context: QuickJSContext | undefined;
  try {
    runtime = qjs.newRuntime();
    runtime.setMemoryLimit(MEMORY_LIMIT);

    // Set up interrupt handler for infinite loop protection.
    // This is a loose backstop — timeouts (via worker termination) are the real
    // guard against runaway code. The interrupt handler just provides a faster
    // exit path for tight CPU-bound loops that don't yield to the event loop.
    let interruptCount = 0;
    runtime.setInterruptHandler(() => {
      interruptCount++;
      return interruptCount > INTERRUPT_CYCLES;
    });

    context = runtime.newContext();
    setupContext(context, backend, input);

    // Defense-in-depth: remove eval(), neuter Function constructors,
    // and freeze all intrinsic prototypes to prevent prototype pollution.
    {
      const initResult = context.evalCode(
        `{
          // --- Block dynamic code compilation ---
          // @banned-pattern-ignore: intentional sandbox hardening — removes eval/Function inside QuickJS guest, not the host
          Object.defineProperty(globalThis, 'eval', {
            value: undefined,
            writable: false,
            configurable: false,
          });
          const BlockedFunction = function () {
            throw new TypeError('Function constructor is not allowed');
          };
          const OrigFunction = Function;
          BlockedFunction.prototype = OrigFunction.prototype;

          // Capture function-type constructors before we patch them
          const AsyncFunction = (async function(){}).constructor;
          const GeneratorFunction = (function*(){}).constructor;
          const AsyncGeneratorFunction = (async function*(){}).constructor;

          // Patch .constructor on all function-type prototypes
          for (const proto of [
            OrigFunction.prototype,
            AsyncFunction.prototype,
            GeneratorFunction.prototype,
            AsyncGeneratorFunction.prototype,
          ]) {
            Object.defineProperty(proto, 'constructor', {
              value: BlockedFunction,
              writable: false,
              configurable: false,
            });
          }
          // @banned-pattern-ignore: intentional sandbox hardening — replaces Function constructor inside QuickJS guest
          Object.defineProperty(globalThis, 'Function', {
            value: BlockedFunction,
            writable: false,
            configurable: false,
          });

          // --- Freeze all intrinsic prototypes ---
          // Prevents prototype pollution (e.g. Array.prototype.x = ...).
          // Only language intrinsics — not sandbox-injected objects
          // (process, console, require) which need to stay mutable.
          // Error prototypes are excluded: freezing them makes the inherited
          // "message" property non-writable, which prevents new Error instances
          // from having their own "message" set (JS spec OrdinarySet step 4).
          const g = globalThis;
          const toFreeze = [
            Object, Object.prototype,
            OrigFunction, OrigFunction.prototype,
            AsyncFunction, AsyncFunction.prototype,
            GeneratorFunction, GeneratorFunction.prototype,
            AsyncGeneratorFunction, AsyncGeneratorFunction.prototype,
            Array, Array.prototype,
            String, String.prototype,
            Number, Number.prototype,
            Boolean, Boolean.prototype,
            g.Symbol, g.Symbol && g.Symbol.prototype,
            RegExp, RegExp.prototype,
            Date, Date.prototype,
            Map, Map.prototype,
            Set, Set.prototype,
            WeakMap, WeakMap.prototype,
            WeakSet, WeakSet.prototype,
            g.WeakRef, g.WeakRef && g.WeakRef.prototype,
            Promise, Promise.prototype,
            ArrayBuffer, ArrayBuffer.prototype,
            g.SharedArrayBuffer, g.SharedArrayBuffer && g.SharedArrayBuffer.prototype,
            g.DataView, g.DataView && g.DataView.prototype,
            JSON, Math, g.Reflect, g.Proxy, g.Atomics,
            g.BigInt, g.BigInt && g.BigInt.prototype,
            BlockedFunction,
          ];
          // TypedArrays (guard against missing globals in QuickJS)
          for (const name of [
            'Int8Array','Uint8Array','Uint8ClampedArray',
            'Int16Array','Uint16Array','Int32Array','Uint32Array',
            'Float32Array','Float64Array',
            'BigInt64Array','BigUint64Array',
          ]) {
            if (g[name]) {
              toFreeze.push(g[name], g[name].prototype);
            }
          }
          // %TypedArray% intrinsic (shared base)
          if (g.Uint8Array) {
            const taProto = Object.getPrototypeOf(g.Uint8Array.prototype);
            if (taProto && taProto !== Object.prototype) toFreeze.push(taProto);
            const taCtor = Object.getPrototypeOf(g.Uint8Array);
            if (taCtor && taCtor !== OrigFunction.prototype) toFreeze.push(taCtor);
          }
          // Iterator prototypes
          try {
            const arrIterProto = Object.getPrototypeOf(
              Object.getPrototypeOf([][Symbol.iterator]())
            );
            if (arrIterProto) {
              toFreeze.push(arrIterProto);
              const iterProto = Object.getPrototypeOf(arrIterProto);
              if (iterProto) toFreeze.push(iterProto);
            }
          } catch {}
          try {
            toFreeze.push(Object.getPrototypeOf(new Map()[Symbol.iterator]()));
          } catch {}
          try {
            toFreeze.push(Object.getPrototypeOf(new Set()[Symbol.iterator]()));
          } catch {}
          try {
            toFreeze.push(Object.getPrototypeOf(''[Symbol.iterator]()));
          } catch {}
          try {
            const genObj = (function*(){})();
            toFreeze.push(Object.getPrototypeOf(genObj));
            toFreeze.push(Object.getPrototypeOf(Object.getPrototypeOf(genObj)));
          } catch {}
          try {
            const asyncGenObj = (async function*(){})();
            toFreeze.push(Object.getPrototypeOf(asyncGenObj));
            toFreeze.push(Object.getPrototypeOf(Object.getPrototypeOf(asyncGenObj)));
          } catch {}

          for (const obj of toFreeze) {
            if (obj != null) {
              try { Object.freeze(obj); } catch {}
            }
          }
        }`,
        "<sandbox-init>",
      );
      if (initResult.error) {
        const errVal = context.dump(initResult.error);
        initResult.error.dispose();
        const msg =
          typeof errVal === "object" && errVal !== null && "message" in errVal
            ? (errVal as { message: string }).message
            : String(errVal);
        backend.writeStderr(`js-exec: sandbox hardening failed: ${msg}\n`);
        backend.exit(1);
        return { success: true };
      }
      initResult.value.dispose();
    }

    // Set up module loader if module mode is enabled
    if (input.isModule) {
      runtime.setModuleLoader(
        (moduleName: string) => {
          // Check virtual built-in modules first
          if (Object.hasOwn(VIRTUAL_MODULES, moduleName)) {
            return VIRTUAL_MODULES[moduleName];
          }

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
          // Strip node: prefix for Node.js compatibility
          if (requestedName.startsWith("node:")) {
            requestedName = requestedName.slice(5);
          }
          // Bare specifiers (built-in names) pass through
          if (
            !requestedName.startsWith("./") &&
            !requestedName.startsWith("../") &&
            !requestedName.startsWith("/")
          ) {
            return requestedName;
          }
          // Normalize relative paths against the importing file's directory.
          // For <eval> (inline code), pass undefined as fromFile so
          // resolveModulePath uses input.cwd as the base directory.
          const fromFile =
            baseModuleName === "<eval>" ? undefined : baseModuleName;
          return resolveModulePath(requestedName, fromFile, input.cwd);
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
        const errorMsg = formatError(errorVal);
        backend.writeStderr(`js-exec: bootstrap error: ${errorMsg}\n`);
        backend.exit(1);
        return { success: true };
      }
      bootstrapResult.value.dispose();
    }

    // --- Tools-only setup: tools proxy without console/result capture ---
    if (input.hasExecutorTools && !input.executorMode) {
      const toolsSetupResult = context.evalCode(
        TOOLS_ONLY_SETUP_SOURCE,
        "<tools-setup>",
      );
      if (toolsSetupResult.error) {
        toolsSetupResult.error.dispose();
      } else {
        toolsSetupResult.value.dispose();
      }
    }

    // --- Executor mode: tools proxy, log capture, result capture ---
    if (input.executorMode) {
      const executorSetupResult = context.evalCode(
        EXECUTOR_SETUP_SOURCE,
        "<executor-setup>",
      );
      if (executorSetupResult.error) {
        const errVal = context.dump(executorSetupResult.error);
        executorSetupResult.error.dispose();
        backend.exit(1);
        return {
          success: true,
          error: formatError(errVal),
          executorLogs: [],
        };
      }
      executorSetupResult.value.dispose();

      // Wrap user code in async IIFE to support await and return values
      const wrappedCode = `(async () => {\n${input.jsCode}\n})()`;
      const evalResult = context.evalCode(wrappedCode, "<executor>");

      if (evalResult.error) {
        const errorVal = context.dump(evalResult.error);
        evalResult.error.dispose();
        const errorMsg = formatError(errorVal);
        backend.exit(1);
        return {
          success: true,
          executorLogs: readExecutorLogs(context),
          error: errorMsg,
        };
      }

      // Track promise resolution via state object
      context.setProp(context.global, "__executorPromise", evalResult.value);
      evalResult.value.dispose();

      const stateResult = context.evalCode(
        [
          "(function(p){",
          "  var s = { v: void 0, e: void 0, settled: false };",
          "  var fmtErr = function(e) {",
          "    if (e && typeof e === 'object') {",
          "      var m = typeof e.message === 'string' ? e.message : '';",
          "      var st = typeof e.stack === 'string' ? e.stack : '';",
          "      if (m && st) return st.indexOf(m) === -1 ? m + '\\n' + st : st;",
          "      if (m) return m; if (st) return st;",
          "    }",
          "    return String(e);",
          "  };",
          "  p.then(",
          "    function(v){ s.v = v; s.settled = true; },",
          "    function(e){ s.e = fmtErr(e); s.settled = true; }",
          "  );",
          "  return s;",
          "})(__executorPromise)",
        ].join("\n"),
        "<state-tracker>",
      );

      if (stateResult.error) {
        const errorVal = context.dump(stateResult.error);
        stateResult.error.dispose();
        backend.exit(1);
        return {
          success: true,
          executorLogs: readExecutorLogs(context),
          error: formatError(errorVal),
        };
      }

      const stateHandle = stateResult.value;

      // Drain pending jobs (may block on tool calls via SAB bridge)
      const pendingResult = runtime.executePendingJobs();
      if ("error" in pendingResult && pendingResult.error) {
        const errorVal = context.dump(pendingResult.error);
        pendingResult.error.dispose();
        const rawMsg =
          typeof errorVal === "object" &&
          errorVal !== null &&
          "message" in errorVal
            ? (errorVal as { message: string }).message
            : String(errorVal);
        if (rawMsg !== "__EXIT__") {
          stateHandle.dispose();
          backend.exit(1);
          return {
            success: true,
            executorLogs: readExecutorLogs(context),
            error: formatError(errorVal),
          };
        }
      }

      // Read resolved state
      const settled = readPropDump(context, stateHandle, "settled");
      const value = readPropDump(context, stateHandle, "v");
      const stateError = readPropDump(context, stateHandle, "e");
      stateHandle.dispose();

      const logs = readExecutorLogs(context);

      if (!settled) {
        backend.exit(0);
        return {
          success: true,
          executorLogs: logs,
          error: "Execution did not settle",
        };
      }

      if (typeof stateError !== "undefined") {
        backend.exit(0);
        return {
          success: true,
          executorLogs: logs,
          error: String(stateError),
        };
      }

      // Serialize result
      let resultJson: string | undefined;
      try {
        resultJson = value !== undefined ? JSON.stringify(value) : undefined;
      } catch {
        resultJson = undefined;
      }

      backend.exit(0);
      return {
        success: true,
        executorResult: resultJson,
        executorLogs: logs,
      };
    }

    // Run user code
    const filename = input.scriptPath || "<eval>";
    let jsCode = input.jsCode;
    // Strip TypeScript type annotations using Node.js built-in
    if (input.stripTypes) {
      jsCode = stripTypeScriptTypes(jsCode);
    }
    const result = input.isModule
      ? context.evalCode(jsCode, filename, { type: "module" })
      : context.evalCode(jsCode, filename);

    if (result.error) {
      const errorVal = context.dump(result.error);
      result.error.dispose();

      // Check if this is a process.exit() call (check raw message before formatting)
      const rawMsg =
        typeof errorVal === "object" &&
        errorVal !== null &&
        "message" in errorVal
          ? (errorVal as { message: string }).message
          : String(errorVal);
      if (rawMsg === "__EXIT__") {
        // Exit was already signaled via backend.exit()
        return { success: true };
      }

      const errorMsg = formatError(errorVal);
      try {
        backend.writeStderr(`${errorMsg}\n`);
      } catch {
        // Output limit exceeded — ignore writeStderr failure
      }
      backend.exit(1);
      return { success: true };
    }

    // Execute pending jobs (promise callbacks, module bodies).
    // Must always run so .then() chains work in both script and module mode.
    // Must happen before exit so bridge is still alive.
    {
      const pendingResult = runtime.executePendingJobs();
      if ("error" in pendingResult && pendingResult.error) {
        const errorVal = context.dump(pendingResult.error);
        pendingResult.error.dispose();
        const rawPendingMsg =
          typeof errorVal === "object" &&
          errorVal !== null &&
          "message" in errorVal
            ? (errorVal as { message: string }).message
            : String(errorVal);
        if (rawPendingMsg !== "__EXIT__") {
          const errorMsg = formatError(errorVal);
          try {
            backend.writeStderr(`${errorMsg}\n`);
          } catch {
            // Output limit exceeded — ignore writeStderr failure
          }
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
    } catch {
      // Output limit exceeded — ignore writeStderr failure
    }
    try {
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
// Store the promise so the message handler can await the same initialization
const initPromise = initializeWithDefense().catch((e) => {
  // Intentionally omits protocolToken — init errors happen before we receive
  // any input, so there is no token to echo back. js-exec.ts handles this by
  // accepting init-error messages without a token check.
  parentPort?.postMessage({
    success: false,
    // @banned-pattern-ignore: worker-internal init error; message stays within worker protocol, sanitized by js-exec.ts before user output
    error: (e as Error).message,
    defenseStats: defense?.getStats(),
  });
});

// Handle messages from main thread
parentPort?.on("message", async (input: JsExecWorkerInput) => {
  try {
    // Wait for the initial defense setup to complete (avoids race condition)
    await initPromise;
    const result = await executeCode(input);
    result.defenseStats = defense?.getStats();
    result.protocolToken = input.protocolToken;
    parentPort?.postMessage(result);
  } catch (e) {
    parentPort?.postMessage({
      protocolToken: input.protocolToken,
      success: false,
      // @banned-pattern-ignore: worker-internal error; message stays within worker protocol, sanitized by js-exec.ts before user output
      error: (e as Error).message,
      defenseStats: defense?.getStats(),
    });
  }
});

import { AsyncLocalStorage } from "node:async_hooks";
import { Buffer } from "node:buffer";
import {
  createRunner,
  getHostFunctionContext,
  RunAbortedError,
  RunBridgeLimitError,
  RunError,
  type RunModuleLoader,
  RunTimeoutError,
} from "run";
import { combineAbortSignals } from "../../abort-signals.js";
import { fromBuffer } from "../../fs/encoding.js";
import {
  sanitizeErrorMessage,
  sanitizeHostErrorMessage,
} from "../../fs/sanitize-error.js";
import { mapToRecord } from "../../helpers/env.js";
import { shellJoinArgs } from "../../helpers/shell-quote.js";
import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import { DefenseInDepthBox } from "../../security/defense-in-depth-box.js";
import { _clearFiniteTimeout, _setTimeoutIfFinite } from "../../timers.js";
import type {
  CommandExecOptions,
  ExecResult,
  RuntimeCommandContext,
} from "../../types.js";
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

interface RunJsOptions {
  source: string;
  scriptPath: string;
  scriptArgs: string[];
  bootstrapCode?: string;
  isModule: boolean;
}

type HostResult<T> = { ok: true; value: T } | { ok: false; error: string };

interface OutputState {
  stdout: string;
  stderr: string;
  exitCode: number;
  limitExceeded: boolean;
}

interface GuestSourceLocation {
  column: number;
  file: string;
  functionName?: string;
  line: number;
}

const jsExecContext = new AsyncLocalStorage<boolean>();
interface QueuedExecution {
  canceled: boolean;
  start(): void;
}

const executionQueue: QueuedExecution[] = [];
let executionActive = false;
const RUN_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const RUN_SYNC_BRIDGE_PAYLOAD_BYTES = RUN_MEMORY_LIMIT_BYTES - 64 * 1024;
const RUN_MAX_LIMIT_VALUE = 2_147_483_647;

class JsExecQueueCanceledError extends Error {}

const RUN_BUFFER_MODULE_SOURCE = BUFFER_MODULE_SOURCE.replace(
  "Buffer.prototype.toString = function(encoding, start, end) {",
  "Object.defineProperty(Buffer.prototype, 'toString', { configurable: true, writable: true, value: function(encoding, start, end) {",
).replace(
  "};\nBuffer.prototype.toJSON = function() {",
  "}});\nBuffer.prototype.toJSON = function() {",
);
const RUN_FETCH_POLYFILL_SOURCE = FETCH_POLYFILL_SOURCE.replace(
  "URLSearchParams.prototype.toString = function() {",
  "Object.defineProperty(URLSearchParams.prototype, 'toString', { configurable: true, writable: true, value: function() {",
)
  .replace(
    "  };\n\n  URLSearchParams.prototype.forEach",
    "  }});\n\n  URLSearchParams.prototype.forEach",
  )
  .replace(
    "URL.prototype.toString = function() { return this.href; };",
    "Object.defineProperty(URL.prototype, 'toString', { configurable: true, writable: true, value: function() { return this.href; } });",
  );

const BUILTIN_EXPORTS: Record<string, string[]> = Object.assign(
  Object.create(null) as Record<string, string[]>,
  {
    assert: [
      "ok",
      "equal",
      "notEqual",
      "strictEqual",
      "notStrictEqual",
      "deepEqual",
      "deepStrictEqual",
      "notDeepEqual",
      "throws",
      "doesNotThrow",
      "fail",
    ],
    buffer: ["Buffer"],
    child_process: ["exec", "execSync", "spawnSync"],
    console: ["log", "error", "warn"],
    events: ["EventEmitter"],
    fs: [
      "readFile",
      "readFileSync",
      "readFileBuffer",
      "writeFile",
      "writeFileSync",
      "stat",
      "statSync",
      "lstat",
      "lstatSync",
      "readdir",
      "readdirSync",
      "mkdir",
      "mkdirSync",
      "rm",
      "rmSync",
      "exists",
      "existsSync",
      "appendFile",
      "appendFileSync",
      "symlink",
      "symlinkSync",
      "readlink",
      "readlinkSync",
      "chmod",
      "chmodSync",
      "realpath",
      "realpathSync",
      "rename",
      "renameSync",
      "copyFile",
      "copyFileSync",
      "unlink",
      "unlinkSync",
      "rmdir",
      "rmdirSync",
      "promises",
    ],
    os: [
      "platform",
      "arch",
      "homedir",
      "tmpdir",
      "type",
      "hostname",
      "EOL",
      "cpus",
      "totalmem",
      "freemem",
      "endianness",
    ],
    path: [
      "join",
      "resolve",
      "normalize",
      "isAbsolute",
      "dirname",
      "basename",
      "extname",
      "relative",
      "parse",
      "format",
      "sep",
      "delimiter",
      "posix",
    ],
    process: [
      "argv",
      "cwd",
      "exit",
      "env",
      "platform",
      "arch",
      "versions",
      "version",
    ],
    querystring: [
      "parse",
      "stringify",
      "escape",
      "unescape",
      "decode",
      "encode",
    ],
    stream: [
      "Stream",
      "Readable",
      "Writable",
      "Duplex",
      "Transform",
      "PassThrough",
      "pipeline",
    ],
    string_decoder: ["StringDecoder"],
    url: ["URL", "URLSearchParams", "parse", "format"],
    util: ["format", "inspect", "promisify", "types", "inherits"],
  },
);

const builtInGlobalExpression = (name: string): string => {
  if (name === "fs" || name === "process" || name === "console") {
    return `globalThis.${name}`;
  }
  if (name === "child_process") {
    return "globalThis[Symbol.for('jb:child_process')]";
  }
  return `globalThis[Symbol.for('jb:${name}')]`;
};

const createBuiltInModuleSource = (name: string): string => {
  const exports = BUILTIN_EXPORTS[name];
  if (exports === undefined) {
    const hint = UNSUPPORTED_MODULES[name];
    if (hint !== undefined) {
      return `throw new Error(${JSON.stringify(
        `Module '${name}' is not available in the js-exec sandbox. ${hint} Run 'js-exec --help' for available modules.`,
      )});`;
    }
    throw new Error(`Cannot find module '${name}'.`);
  }
  const object = builtInGlobalExpression(name);
  return [
    `const value = ${object};`,
    ...exports.map((exportName) =>
      exportName === "default"
        ? ""
        : `export const ${exportName} = value.${exportName};`,
    ),
    "export default value;",
  ].join("\n");
};

const normalizePath = (cwd: string, path: string): string => {
  const parts = (path.startsWith("/") ? path : `${cwd}/${path}`).split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return `/${result.join("/")}`;
};

const parseGuestSourceLocation = (
  stack: string,
): GuestSourceLocation | undefined => {
  for (const line of stack.split("\n")) {
    const functionFrame = /^\s+at (.+) \((.+):(\d+):(\d+)\)$/u.exec(line);
    if (functionFrame) {
      return {
        column: Number(functionFrame[4]),
        file: functionFrame[2],
        functionName: functionFrame[1],
        line: Number(functionFrame[3]),
      };
    }
    const frame = /^\s+at (.+):(\d+):(\d+)$/u.exec(line);
    if (frame) {
      return {
        column: Number(frame[3]),
        file: frame[1],
        line: Number(frame[2]),
      };
    }
  }
  return undefined;
};

const formatGuestError = (
  error: unknown,
  options: RunJsOptions,
  sourceLineOffset: number,
): string => {
  let message = sanitizeErrorMessage(getErrorMessage(error));
  if (/^[A-Za-z_$][\w$]* is not defined$/u.test(message)) {
    message = `'${message.slice(0, message.indexOf(" "))}'${message.slice(message.indexOf(" "))}`;
  }
  if (
    error instanceof Error &&
    error.name === "SyntaxError" &&
    message === "Unexpected token '}'"
  ) {
    message = "expecting ')'";
  }
  if (!(error instanceof Error) || error.stack === undefined) return message;

  const location = parseGuestSourceLocation(error.stack);
  if (location === undefined) return message;

  let { column, file, functionName, line } = location;
  if (file === "run.js" || file === "<entry>") {
    file = options.scriptPath;
    line = Math.max(1, line - sourceLineOffset);
    if (!options.isModule) {
      functionName = options.scriptPath === "-c" ? "<eval>" : undefined;
    }
  }
  if (error.name === "Error") column += 5;
  else if (error.name === "TypeError") column += 1;
  const prefix =
    functionName === undefined
      ? `at ${file}:${line}:${column}`
      : `at ${functionName} (${file}:${line}:${column})`;
  return `${prefix}: ${message}`;
};

const guestSetupSource = (
  options: RunJsOptions,
  env: Record<string, string>,
  cwd: string,
  hasInvokeTool: boolean,
): string => `
(function() {
  function unwrap(result) {
    if (!result || result.ok !== true) throw new Error(result && result.error || 'Host operation failed');
    return result.value;
  }
  function bytes(value) {
    if (value && Array.isArray(value._data)) return value._data.slice();
    if (Array.isArray(value)) return value.slice();
    if (value instanceof Uint8Array) return Array.from(value);
    return String(value);
  }
  function format(value) {
    if (typeof Buffer === 'function' && value instanceof Buffer) return value.toString();
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  globalThis.env = ${JSON.stringify(env)};
  globalThis.process = {
    argv: ${JSON.stringify([options.scriptPath, ...options.scriptArgs])},
    cwd: function() { return ${JSON.stringify(cwd)}; },
    env: globalThis.env,
    platform: 'linux',
    arch: 'x64',
    versions: { node: '22.0.0', quickjs: '2025' },
    version: 'v22.0.0',
    exit: function(code) { return __host.exit(Number(code) || 0); }
  };

  ${RUN_BUFFER_MODULE_SOURCE}
  var fs = {
    readFileBuffer: function(path) { return Uint8Array.from(unwrap(__host.fsRead(path))); },
    readFileSync: function(path, opts) {
      var buffer = Buffer.from(unwrap(__host.fsRead(path)));
      var encoding = typeof opts === 'string' ? opts : opts && opts.encoding;
      return encoding ? buffer.toString(encoding) : buffer;
    },
    writeFileSync: function(path, data) { unwrap(__host.fsWrite(path, bytes(data))); },
    appendFileSync: function(path, data) { unwrap(__host.fsAppend(path, bytes(data))); },
    statSync: function(path) { return unwrap(__host.fsStat(path, false)); },
    lstatSync: function(path) { return unwrap(__host.fsStat(path, true)); },
    readdirSync: function(path) { return unwrap(__host.fsReaddir(path)); },
    mkdirSync: function(path, opts) { unwrap(__host.fsMkdir(path, Boolean(opts && opts.recursive))); },
    rmSync: function(path, opts) { unwrap(__host.fsRm(path, Boolean(opts && opts.recursive), Boolean(opts && opts.force))); },
    existsSync: function(path) { return unwrap(__host.fsExists(path)); },
    symlinkSync: function(target, path) { unwrap(__host.fsSymlink(target, path)); },
    readlinkSync: function(path) { return unwrap(__host.fsReadlink(path)); },
    chmodSync: function(path, mode) { unwrap(__host.fsChmod(path, Number(mode))); },
    realpathSync: function(path) { return unwrap(__host.fsRealpath(path)); },
    renameSync: function(from, to) { unwrap(__host.fsRename(from, to)); },
    copyFileSync: function(from, to) { unwrap(__host.fsCopy(from, to)); }
  };
  fs.unlinkSync = fs.rmSync;
  fs.rmdirSync = fs.rmSync;
  function callbackUnsupported(name) {
    return function() { throw new Error('fs.' + name + '() with callbacks is not supported. Use fs.' + name + 'Sync() or fs.promises.' + name + '() instead.'); };
  }
  var names = ['readFile','writeFile','appendFile','stat','lstat','readdir','mkdir','rm','symlink','readlink','chmod','realpath','rename','copyFile'];
  for (var i = 0; i < names.length; i++) fs[names[i]] = callbackUnsupported(names[i]);
  fs.exists = callbackUnsupported('exists');
  fs.unlink = callbackUnsupported('unlink');
  fs.rmdir = callbackUnsupported('rmdir');
  fs.promises = {};
  for (var i = 0; i < names.length; i++) (function(name) {
    var sync = fs[name + 'Sync'];
    fs.promises[name] = function() {
      try { return Promise.resolve(sync.apply(fs, arguments)); }
      catch (error) { return Promise.reject(error); }
    };
  })(names[i]);
  fs.promises.unlink = fs.promises.rm;
  fs.promises.rmdir = fs.promises.rm;
  fs.promises.access = function(path) { return fs.existsSync(path) ? Promise.resolve() : Promise.reject(new Error('ENOENT: no such file or directory: ' + path)); };
  globalThis.fs = fs;

  ${PATH_MODULE_SOURCE}
  ${EVENTS_MODULE_SOURCE}
  ${OS_MODULE_SOURCE}
  ${ASSERT_MODULE_SOURCE}
  ${UTIL_MODULE_SOURCE}
  ${STREAM_MODULE_SOURCE}
  ${STRING_DECODER_MODULE_SOURCE}
  ${QUERYSTRING_MODULE_SOURCE}

  var nativeFetch = function(url, opts) { return unwrap(__host.fetch(String(url), opts)); };
  globalThis[Symbol.for('jb:fetch')] = nativeFetch;
  ${RUN_FETCH_POLYFILL_SOURCE}
  ${URL_MODULE_SOURCE}

  var childProcess = {
    exec: function(command, opts) { return unwrap(__host.exec(String(command), opts && opts.stdin)); },
    execSync: function(command, opts) {
      var result = unwrap(__host.exec(String(command), opts && opts.stdin));
      if (result.exitCode !== 0) {
        var error = new Error('Command failed: ' + command);
        error.status = result.exitCode; error.stdout = result.stdout; error.stderr = result.stderr;
        throw error;
      }
      return result.stdout;
    },
    spawnSync: function(command, args) {
      var result = unwrap(__host.execArgs(String(command), args || []));
      return { stdout: result.stdout, stderr: result.stderr, status: result.exitCode };
    }
  };
  globalThis[Symbol.for('jb:child_process')] = childProcess;

  var modules = Object.create(null);
  modules.fs = fs;
  modules.path = globalThis[Symbol.for('jb:path')];
  modules.child_process = childProcess;
  modules.process = globalThis.process;
  modules.console = globalThis.console;
  modules.os = globalThis[Symbol.for('jb:os')];
  modules.url = globalThis[Symbol.for('jb:url')];
  modules.assert = globalThis[Symbol.for('jb:assert')];
  modules.util = globalThis[Symbol.for('jb:util')];
  modules.events = globalThis[Symbol.for('jb:events')];
  modules.buffer = globalThis[Symbol.for('jb:buffer')];
  modules.stream = globalThis[Symbol.for('jb:stream')];
  modules.string_decoder = globalThis[Symbol.for('jb:string_decoder')];
  modules.querystring = globalThis[Symbol.for('jb:querystring')];
  var unsupported = ${JSON.stringify(UNSUPPORTED_MODULES)};
  globalThis.require = function(name) {
    name = String(name); if (name.startsWith('node:')) name = name.slice(5);
    if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name];
    if (Object.prototype.hasOwnProperty.call(unsupported, name)) throw new Error("Module '" + name + "' is not available in the js-exec sandbox. " + unsupported[name] + " Run 'js-exec --help' for available modules.");
    throw new Error("Cannot find module '" + name + "'. Run 'js-exec --help' for available modules.");
  };
  globalThis.require.resolve = function(name) { return name; };

  console.log = function() { unwrap(__host.stdout(Array.prototype.map.call(arguments, format).join(' ') + '\\n')); };
  console.info = console.log;
  console.debug = console.log;
  console.error = function() { unwrap(__host.stderr(Array.prototype.map.call(arguments, format).join(' ') + '\\n')); };
  console.warn = console.error;

  ${
    hasInvokeTool
      ? `globalThis.tools = (function makeProxy(path) {
    return new Proxy(function(){}, {
      get: function(_target, property) {
        if (property === 'then' || typeof property === 'symbol') return undefined;
        return makeProxy(path.concat([String(property)]));
      },
      apply: function(_target, _this, args) {
        var argsJson = args.length ? JSON.stringify(args[0]) : '';
        var value = unwrap(__host.invokeTool(path.join('.'), argsJson || ''));
        return value ? JSON.parse(value) : undefined;
      }
    });
  })([]);`
      : ""
  }
})();
`;

const processNextExecution = (): void => {
  if (executionActive) return;
  const next = executionQueue.shift();
  if (next === undefined) return;
  if (next.canceled) {
    processNextExecution();
    return;
  }
  executionActive = true;
  next.start();
};

const enqueue = <T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> => {
  const boundOperation = DefenseInDepthBox.bindCurrentContext(operation);
  return new Promise<T>((resolve, reject) => {
    const queued: QueuedExecution = {
      canceled: false,
      start() {
        signal?.removeEventListener("abort", cancel);
        void (async () => {
          try {
            resolve(await boundOperation());
          } catch (error) {
            reject(error);
          } finally {
            executionActive = false;
            processNextExecution();
          }
        })();
      },
    };
    const cancel = () => {
      const index = executionQueue.indexOf(queued);
      if (index === -1) return;
      executionQueue.splice(index, 1);
      queued.canceled = true;
      signal?.removeEventListener("abort", cancel);
      reject(new JsExecQueueCanceledError());
    };
    signal?.addEventListener("abort", cancel, { once: true });
    executionQueue.push(queued);
    if (signal?.aborted) cancel();
    else processNextExecution();
  });
};

const serializeStat = (
  stat: Awaited<ReturnType<RuntimeCommandContext["fs"]["stat"]>>,
) => ({
  isDirectory: stat.isDirectory,
  isFile: stat.isFile,
  isSymbolicLink: stat.isSymbolicLink,
  mode: stat.mode,
  mtime: stat.mtime.toISOString(),
  size: stat.size,
});

async function executeWithRunInner(
  options: RunJsOptions,
  ctx: RuntimeCommandContext,
  abortSignal: AbortSignal | undefined,
  deadline: number,
  deadlineSignal: AbortSignal,
): Promise<ExecResult> {
  // run accounts for the SharedArrayBuffer inside the invocation budget and
  // adds framing space to host-function arguments. Leave bounded headroom
  // while preserving the existing 64 MiB QuickJS heap limit.
  const maxBridgePayloadBytes = Math.min(
    ctx.limits.maxWorkerMessageBytes,
    RUN_SYNC_BRIDGE_PAYLOAD_BYTES,
  );
  const output: OutputState = {
    exitCode: 0,
    limitExceeded: false,
    stderr: "",
    stdout: "",
  };
  let requestedExitCode: number | undefined;
  const maxOutputSize = ctx.limits.maxOutputSize;
  const appendOutput = (
    stream: "stdout" | "stderr",
    value: string,
  ): HostResult<void> => {
    const nextBytes =
      Buffer.byteLength(output.stdout) +
      Buffer.byteLength(output.stderr) +
      Buffer.byteLength(value);
    if (maxOutputSize > 0 && nextBytes > maxOutputSize) {
      output.limitExceeded = true;
      output.exitCode = 1;
      return { error: "Output size limit exceeded", ok: false };
    }
    output[stream] += value;
    return { ok: true, value: undefined };
  };
  const resolve = (path: string) => ctx.fs.resolvePath(ctx.cwd, path);
  const attempt = async <T>(
    operation: () => Promise<T>,
  ): Promise<HostResult<T>> => {
    try {
      return {
        ok: true,
        value: await DefenseInDepthBox.runUntrustedAsync(operation),
      };
    } catch (error) {
      return { ok: false, error: sanitizeErrorMessage(getErrorMessage(error)) };
    }
  };
  const env = mapToRecord(ctx.env);
  const runner = DefenseInDepthBox.runTrusted(() =>
    createRunner({
      syncHostFunctions: {
        __host: {
          exit(code: number) {
            requestedExitCode = Number.isFinite(code) ? Math.trunc(code) : 0;
            output.exitCode = requestedExitCode;
            throw new Error("Guest requested process exit.");
          },
          fsRead: (path: string) =>
            attempt(async () =>
              Array.from(await ctx.fs.readFileBuffer(resolve(path))),
            ),
          fsWrite: (path: string, data: string | number[]) =>
            attempt(
              async () =>
                await ctx.fs.writeFile(
                  resolve(path),
                  typeof data === "string" ? data : Uint8Array.from(data),
                ),
            ),
          fsAppend: (path: string, data: string | number[]) =>
            attempt(
              async () =>
                await ctx.fs.appendFile(
                  resolve(path),
                  typeof data === "string" ? data : Uint8Array.from(data),
                ),
            ),
          fsStat: (path: string, lstat: boolean) =>
            attempt(async () =>
              serializeStat(
                await (lstat
                  ? ctx.fs.lstat(resolve(path))
                  : ctx.fs.stat(resolve(path))),
              ),
            ),
          fsReaddir: (path: string) =>
            attempt(async () => await ctx.fs.readdir(resolve(path))),
          fsMkdir: (path: string, recursive: boolean) =>
            attempt(
              async () => await ctx.fs.mkdir(resolve(path), { recursive }),
            ),
          fsRm: (path: string, recursive: boolean, force: boolean) =>
            attempt(
              async () => await ctx.fs.rm(resolve(path), { force, recursive }),
            ),
          fsExists: (path: string) =>
            attempt(async () => await ctx.fs.exists(resolve(path))),
          fsSymlink: (target: string, path: string) =>
            attempt(async () => await ctx.fs.symlink(target, resolve(path))),
          fsReadlink: (path: string) =>
            attempt(async () => await ctx.fs.readlink(resolve(path))),
          fsChmod: (path: string, mode: number) =>
            attempt(async () => await ctx.fs.chmod(resolve(path), mode)),
          fsRealpath: (path: string) =>
            attempt(async () => await ctx.fs.realpath(resolve(path))),
          fsRename: (from: string, to: string) =>
            attempt(async () => await ctx.fs.mv(resolve(from), resolve(to))),
          fsCopy: (from: string, to: string) =>
            attempt(async () => await ctx.fs.cp(resolve(from), resolve(to))),
          stdout: (value: string) => appendOutput("stdout", value),
          stderr: (value: string) => appendOutput("stderr", value),
          async fetch(
            url: string,
            init?: {
              method?: string;
              headers?: Record<string, string>;
              body?: string;
            },
          ) {
            return await attempt(async () => {
              if (!ctx.fetch)
                throw new Error(
                  "Network access not configured. Enable network in Bash options.",
                );
              const remaining =
                deadline === Number.POSITIVE_INFINITY
                  ? undefined
                  : Math.max(0, deadline - Date.now());
              const response = await ctx.fetch(url, {
                method: init?.method,
                headers: init?.headers,
                body: init?.body,
                ...(remaining === undefined ? {} : { timeoutMs: remaining }),
                signal: getHostFunctionContext().abortSignal,
              });
              return {
                body: Buffer.from(response.body).toString("latin1"),
                bodyBase64: fromBuffer(response.body, "base64"),
                headers: response.headers,
                status: response.status,
                statusText: response.statusText,
                url: response.url,
              };
            });
          },
          async exec(command: string, stdin?: string) {
            return await attempt(async () => {
              if (!ctx.exec)
                throw new Error(
                  "Command execution not available in this context.",
                );
              const execOptions: CommandExecOptions = {
                cwd: ctx.cwd,
                env,
                signal: getHostFunctionContext().abortSignal,
                stdin: stdin ?? "",
              };
              return await jsExecContext.run(
                true,
                () => ctx.exec?.(command, execOptions) as Promise<ExecResult>,
              );
            });
          },
          async execArgs(command: string, args: string[]) {
            return await attempt(async () => {
              if (!ctx.exec)
                throw new Error(
                  "Command execution not available in this context.",
                );
              return await jsExecContext.run(
                true,
                () =>
                  ctx.exec?.(shellJoinArgs([command]), {
                    // Preserve spawnSync's argv-only executable semantics.
                    args: args.map(String),
                    cwd: ctx.cwd,
                    env,
                    signal: getHostFunctionContext().abortSignal,
                  }) as Promise<ExecResult>,
              );
            });
          },
          async invokeTool(path: string, argsJson: string) {
            return await attempt(async () => {
              if (!ctx.invokeTool) throw new Error(`Unknown tool: ${path}`);
              return await DefenseInDepthBox.runTrustedAsync(
                () => ctx.invokeTool?.(path, argsJson) as Promise<string>,
              );
            });
          },
        },
      },
    }),
  );

  const setup = guestSetupSource(
    options,
    env,
    ctx.cwd,
    ctx.invokeTool !== undefined,
  );
  const bootstrap = options.bootstrapCode ?? "";
  const moduleLoader: RunModuleLoader | undefined = options.isModule
    ? {
        identity: "just-bash-js-exec-v1",
        normalize(specifier, importer) {
          const bare = specifier.startsWith("node:")
            ? specifier.slice(5)
            : specifier;
          if (bare === "just-bash:bootstrap") return bare;
          if (
            BUILTIN_EXPORTS[bare] !== undefined ||
            UNSUPPORTED_MODULES[bare] !== undefined
          )
            return `just-bash:builtin:${bare}`;
          if (!specifier.startsWith(".") && !specifier.startsWith("/"))
            return `just-bash:missing:${specifier}`;
          const importerDirectory =
            importer === "<entry>" || importer.startsWith("just-bash:")
              ? options.scriptPath.includes("/")
                ? options.scriptPath.slice(
                    0,
                    options.scriptPath.lastIndexOf("/"),
                  )
                : ctx.cwd
              : importer.slice(0, importer.lastIndexOf("/"));
          return normalizePath(importerDirectory || ctx.cwd, specifier);
        },
        async load(specifier) {
          if (specifier === "just-bash:bootstrap") return setup;
          if (specifier.startsWith("just-bash:builtin:"))
            return createBuiltInModuleSource(
              specifier.slice("just-bash:builtin:".length),
            );
          if (specifier.startsWith("just-bash:missing:"))
            throw new Error(
              `Cannot find module '${specifier.slice("just-bash:missing:".length)}': not found. Run 'js-exec --help' for available modules.`,
            );
          return await DefenseInDepthBox.runUntrustedAsync(
            async () => await ctx.fs.readFile(specifier),
          );
        },
      }
    : undefined;
  const sourcePrefix = options.isModule
    ? `import 'just-bash:bootstrap';\n${bootstrap}\n`
    : `${setup}\n${bootstrap}\n`;
  const source = `${sourcePrefix}${options.source}`;
  const sourceLineOffset = sourcePrefix.split("\n").length - 1;

  try {
    await jsExecContext.run(true, async () => {
      let runPromise!: ReturnType<typeof runner.run>;
      DefenseInDepthBox.runTrusted(() => {
        runPromise = runner.run({
          abortSignal,
          limits: {
            maxBridgeRequests: Math.min(
              Math.max(1, ctx.limits.maxJsBridgeRequests),
              RUN_MAX_LIMIT_VALUE,
            ),
            maxConsoleOutputBytes: 1,
            maxHostFunctionArgumentsBytes: maxBridgePayloadBytes,
            maxHostFunctionOutputBytes: maxBridgePayloadBytes,
            maxResultBytes: ctx.limits.maxWorkerMessageBytes,
            memoryLimitBytes: RUN_MEMORY_LIMIT_BYTES,
            timeoutMs:
              deadline === Number.POSITIVE_INFINITY
                ? RUN_MAX_LIMIT_VALUE
                : Math.min(
                    Math.max(1, deadline - Date.now()),
                    RUN_MAX_LIMIT_VALUE,
                  ),
          },
          ...(moduleLoader === undefined ? {} : { moduleLoader }),
          source,
        });
      });
      await runPromise;
    });
  } catch (error) {
    const message = getErrorMessage(error);
    if (
      requestedExitCode !== undefined &&
      RunError.isInstance(error) &&
      error.code === "RUN_HOST_FUNCTION_ERROR"
    ) {
      output.exitCode = requestedExitCode;
    } else if (
      error instanceof RunTimeoutError ||
      error instanceof RunAbortedError
    ) {
      return {
        ...output,
        exitCode: 124,
        stderr: `${output.stderr}js-exec: ${error instanceof RunTimeoutError || deadlineSignal.aborted ? `Execution timeout: exceeded ${ctx.limits.maxJsTimeoutMs}ms limit` : "Execution aborted"}\n`,
      };
    } else if (error instanceof RunBridgeLimitError) {
      output.exitCode = 1;
      output.stderr += `js-exec: ${sanitizeHostErrorMessage(message)}\n`;
    } else {
      output.exitCode = 1;
      const guestMessage = formatGuestError(error, options, sourceLineOffset);
      const isGuestPrimitive =
        error instanceof Error &&
        error.constructor.name === "RunError" &&
        error.stack?.includes("(<run-worker>)") === true &&
        parseGuestSourceLocation(error.stack) === undefined;
      output.stderr += isGuestPrimitive
        ? `${guestMessage}\n`
        : guestMessage === message
          ? `js-exec: ${sanitizeHostErrorMessage(message)}\n`
          : `${guestMessage}\n`;
    }
  }
  if (output.limitExceeded) {
    output.stderr = `js-exec: total output size exceeded (>${maxOutputSize} bytes), increase executionLimits.maxOutputSize\n`;
  }
  return {
    exitCode: output.exitCode,
    stderr: output.stderr,
    stdout: output.stdout,
  };
}

export async function executeWithRun(
  options: RunJsOptions,
  ctx: RuntimeCommandContext,
): Promise<ExecResult> {
  if (jsExecContext.getStore()) {
    return {
      exitCode: 1,
      stderr: "js-exec: recursive invocation is not supported\n",
      stdout: "",
    };
  }
  const timeoutController = new AbortController();
  const deadline =
    ctx.limits.maxJsTimeoutMs === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : Date.now() + ctx.limits.maxJsTimeoutMs;
  const timeout = _setTimeoutIfFinite(
    () => timeoutController.abort(),
    ctx.limits.maxJsTimeoutMs,
  );
  const combinedAbort = combineAbortSignals(
    ctx.signal,
    timeoutController.signal,
  );
  try {
    return await enqueue(
      async () =>
        await executeWithRunInner(
          options,
          ctx,
          combinedAbort.signal,
          deadline,
          timeoutController.signal,
        ),
      combinedAbort.signal,
    );
  } catch (error) {
    if (!(error instanceof JsExecQueueCanceledError)) throw error;
    const timedOut = timeoutController.signal.aborted;
    return {
      exitCode: 124,
      stderr: `js-exec: ${timedOut ? `Execution timeout: exceeded ${ctx.limits.maxJsTimeoutMs}ms limit` : "Execution aborted"}\n`,
      stdout: "",
    };
  } finally {
    combinedAbort.cleanup();
    _clearFiniteTimeout(timeout);
  }
}

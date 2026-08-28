import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { stripTypeScriptTypes } from "node:module";
import { createRunner, RunAbortedError, RunTimeoutError } from "run";
import { sanitizeHostErrorMessage } from "../../fs/sanitize-error.js";
import { mapToRecord } from "../../helpers/env.js";
import { shellJoinArgs } from "../../helpers/shell-quote.js";
import { getErrorMessage } from "../../interpreter/helpers/errors.js";
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
  stripTypes: boolean;
}

interface SnapshotEntry {
  path: string;
  type: "file" | "directory" | "symlink";
  content?: number[];
  target?: string;
  mode: number;
  mtime: string;
}

interface FileOperation {
  type:
    | "write"
    | "append"
    | "mkdir"
    | "rm"
    | "symlink"
    | "chmod"
    | "rename"
    | "copy";
  path: string;
  data?: number[];
  target?: string;
  destination?: string;
  recursive?: boolean;
  force?: boolean;
  mode?: number;
}

interface GuestResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  operations: FileOperation[];
}

const jsExecRunner = createRunner({
  continuationAudience: "just-bash-js-exec",
});
const jsExecRunResource = new AsyncResource("just-bash:js-exec:run");
const jsExecContext = new AsyncLocalStorage<boolean>();
let activeJsExecRuns = 0;

const RUN_BUFFER_MODULE_SOURCE = BUFFER_MODULE_SOURCE.replace(
  "Buffer.prototype.toString = function(encoding, start, end) {",
  "Object.defineProperty(Buffer.prototype, 'toString', { configurable: true, writable: true, value: function(encoding, start, end) {",
).replace(
  "};\nBuffer.prototype.toJSON = function() {",
  "}});\nBuffer.prototype.toJSON = function() {",
);

function adaptAsyncCapabilities(source: string): string {
  source = source.replace(/(?<![\w$.]|await\s)\bfetch\s*\(/g, "await fetch(");
  const callPattern =
    /\b(?:tools(?:\.[A-Za-z_$][\w$]*)+|require\s*\(\s*["']child_process["']\s*\)\s*\.\s*(?:execSync|spawnSync)|(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:execSync|spawnSync))\s*\(/g;
  const replacements: Array<{ start: number; end: number }> = [];
  for (const match of source.matchAll(callPattern)) {
    const start = match.index;
    if (start === undefined) continue;
    if (source[start - 1] === ".") continue;
    const prefix = source.slice(Math.max(0, start - 6), start);
    if (/\bawait\s*$/.test(prefix)) continue;
    const openParen = start + match[0].lastIndexOf("(");
    let depth = 0;
    let quote: "'" | '"' | "`" | null = null;
    let escaped = false;
    for (let index = openParen; index < source.length; index++) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        quote = character;
      } else if (character === "(") {
        depth++;
      } else if (character === ")") {
        depth--;
        if (depth === 0) {
          replacements.push({ start, end: index + 1 });
          break;
        }
      }
    }
  }
  let transformed = source;
  for (const replacement of replacements.reverse()) {
    transformed =
      transformed.slice(0, replacement.start) +
      `(await ${transformed.slice(replacement.start, replacement.end)})` +
      transformed.slice(replacement.end);
  }
  return transformed;
}

function resolvePath(cwd: string, path: string): string {
  const parts = (path.startsWith("/") ? path : `${cwd}/${path}`).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return `/${resolved.join("/")}`;
}

async function snapshotFileSystem(
  ctx: RuntimeCommandContext,
): Promise<SnapshotEntry[]> {
  const paths = new Set(ctx.fs.getAllPaths());
  for (const required of ["/", "/home", "/home/user", "/tmp"]) {
    paths.add(required);
  }
  const entries: SnapshotEntry[] = [];
  for (const path of [...paths].sort()) {
    try {
      const stat = await ctx.fs.lstat(path);
      if (stat.isSymbolicLink) {
        entries.push({
          path,
          type: "symlink",
          target: await ctx.fs.readlink(path),
          mode: stat.mode,
          mtime: stat.mtime.toISOString(),
        });
      } else if (stat.isDirectory) {
        entries.push({
          path,
          type: "directory",
          mode: stat.mode,
          mtime: stat.mtime.toISOString(),
        });
      } else {
        entries.push({
          path,
          type: "file",
          content: Array.from(await ctx.fs.readFileBuffer(path)),
          mode: stat.mode,
          mtime: stat.mtime.toISOString(),
        });
      }
    } catch {
      // Optional default-layout paths may not exist on custom filesystems.
    }
  }
  return entries;
}

async function applyFileOperations(
  ctx: RuntimeCommandContext,
  operations: FileOperation[],
): Promise<void> {
  for (const operation of operations) {
    const path = resolvePath(ctx.cwd, operation.path);
    switch (operation.type) {
      case "write":
        await ctx.fs.writeFile(path, Uint8Array.from(operation.data ?? []));
        break;
      case "append":
        await ctx.fs.appendFile(path, Uint8Array.from(operation.data ?? []));
        break;
      case "mkdir":
        await ctx.fs.mkdir(path, { recursive: operation.recursive });
        break;
      case "rm":
        await ctx.fs.rm(path, {
          recursive: operation.recursive,
          force: operation.force,
        });
        break;
      case "symlink":
        await ctx.fs.symlink(operation.target ?? "", path);
        break;
      case "chmod":
        await ctx.fs.chmod(path, operation.mode ?? 0);
        break;
      case "rename":
        await ctx.fs.mv(
          path,
          resolvePath(ctx.cwd, operation.destination ?? ""),
        );
        break;
      case "copy":
        await ctx.fs.cp(
          path,
          resolvePath(ctx.cwd, operation.destination ?? ""),
        );
        break;
    }
  }
}

function transformModule(source: string): string {
  const exportedNames: string[] = [];
  let transformed = source
    .replace(
      /import\s+{([^}]+)}\s+from\s+["']([^"']+)["'];?/g,
      (_match, names: string, specifier: string) =>
        `const {${names}} = await __import(${JSON.stringify(specifier)});`,
    )
    .replace(
      /import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["'];?/g,
      (_match, name: string, specifier: string) =>
        `const __imported_${name} = await __import(${JSON.stringify(specifier)}); const ${name} = __imported_${name}.default ?? __imported_${name};`,
    )
    .replace(
      /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["'];?/g,
      (_match, name: string, specifier: string) =>
        `const ${name} = await __import(${JSON.stringify(specifier)});`,
    )
    .replace(
      /import\s+["']([^"']+)["'];?/g,
      (_match, specifier: string) =>
        `await __import(${JSON.stringify(specifier)});`,
    )
    .replace(/export\s+default\s+/g, "module.exports.default = ")
    .replace(
      /export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
      (_match, asyncKeyword: string | undefined, name: string) => {
        exportedNames.push(name);
        return `${asyncKeyword ?? ""}function ${name}`;
      },
    )
    .replace(
      /export\s+(const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
      (_match, kind: string, name: string) => {
        exportedNames.push(name);
        return `${kind} ${name}`;
      },
    )
    .replace(/export\s*{([^}]*)};?/g, (_match, names: string) => {
      if (!names.trim()) return "";
      return names
        .split(",")
        .map((part) => {
          const [local, exported = local] = part.trim().split(/\s+as\s+/);
          return `module.exports.${exported} = ${local};`;
        })
        .join("\n");
    });
  if (exportedNames.length > 0) {
    transformed += `\n${exportedNames
      .map((name) => `module.exports.${name} = ${name};`)
      .join("\n")}`;
  }
  return adaptAsyncCapabilities(transformed);
}

function collectModuleSpecifiers(source: string): string[] {
  // @banned-pattern-ignore: parses static import declarations from guest source; it does not invoke host import()
  return [
    ...source.matchAll(/import(?:\s+[\s\S]*?\s+from\s+|\s*)["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

async function bundleModules(
  ctx: RuntimeCommandContext,
  source: string,
  scriptPath: string,
): Promise<string> {
  const modules = new Map<string, string>();
  const visit = async (moduleSource: string, modulePath: string) => {
    if (modules.has(modulePath)) return;
    if (modulePath.endsWith(".ts") || modulePath.endsWith(".mts")) {
      moduleSource = stripTypesOutsideSandbox(moduleSource);
    }
    for (const specifier of collectModuleSpecifiers(moduleSource)) {
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        const resolved = resolvePath(
          modulePath.substring(0, modulePath.lastIndexOf("/")) || ctx.cwd,
          specifier,
        );
        const importedSource = await ctx.fs.readFile(resolved);
        await visit(importedSource, resolved);
      }
    }
    modules.set(modulePath, transformModule(moduleSource));
  };
  await visit(source, scriptPath);
  const registrations = [...modules]
    .map(
      ([path, moduleSource]) =>
        `__moduleFactories[${JSON.stringify(path)}] = async function(module, exports, __import) {\n${moduleSource}\n};`,
    )
    .join("\n");
  return `${registrations}\nawait __import(${JSON.stringify(scriptPath)});`;
}

function stripTypesOutsideSandbox(source: string): string {
  return jsExecRunResource.runInAsyncScope(() => stripTypeScriptTypes(source));
}

function createGuestSource(
  options: RunJsOptions,
  snapshot: SnapshotEntry[],
  userSource: string,
): string {
  return `
const __stdout = [];
const __stderr = [];
const __operations = [];
const __pending = [];
const __snapshot = ${JSON.stringify(snapshot)};
const __cwd = ${JSON.stringify(options.scriptPath === "-c" ? "/home/user" : undefined)};
const __processCwd = ${JSON.stringify(options.scriptPath ? undefined : undefined)};
const __actualCwd = ${JSON.stringify("")};
const __entries = Object.create(null);
for (const entry of __snapshot) __entries[entry.path] = entry;
function __normalize(path) {
  const input = String(path);
  const parts = (input.startsWith('/') ? input : ${JSON.stringify(
    options.scriptPath,
  )} && ${JSON.stringify(options.scriptPath)} !== '-c'
    ? ${JSON.stringify(options.scriptPath)}.slice(0, ${JSON.stringify(
      options.scriptPath,
    )}.lastIndexOf('/')) + '/' + input
    : ${JSON.stringify("/home/user")} + '/' + input).split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return '/' + out.join('/');
}
function __parent(path) {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}
function __ensureParent(path) {
  const parent = __entries[__parent(path)];
  if (!parent || parent.type !== 'directory') throw new Error('ENOENT: no such file or directory, open ' + path);
}
function __bytes(value) {
  if (value instanceof Buffer) return Array.from(value._data);
  if (value instanceof Uint8Array) return Array.from(value);
  return _utf8Encode(String(value));
}
function __statValue(entry) {
  if (!entry) throw new Error('ENOENT: no such file or directory');
  return {
    isFile: entry.type === 'file',
    isDirectory: entry.type === 'directory',
    isSymbolicLink: entry.type === 'symlink',
    mode: entry.mode,
    size: entry.content ? entry.content.length : 0,
    mtime: new Date(entry.mtime)
  };
}
const console = {
  log: (...args) => __stdout.push(args.map(__formatConsole).join(' ') + '\\n'),
  info: (...args) => __stdout.push(args.map(__formatConsole).join(' ') + '\\n'),
  debug: (...args) => __stdout.push(args.map(__formatConsole).join(' ') + '\\n'),
  error: (...args) => __stderr.push(args.map(__formatConsole).join(' ') + '\\n'),
  warn: (...args) => __stderr.push(args.map(__formatConsole).join(' ') + '\\n')
};
function __formatConsole(value) {
  if (value instanceof Buffer) return value.toString();
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  try { return JSON.stringify(value); } catch { return String(value); }
}
globalThis.console = console;
${RUN_BUFFER_MODULE_SOURCE}
const fs = {
  readFileSync(path, opts) {
    const entry = __entries[__normalize(path)];
    if (!entry || entry.type !== 'file') throw new Error('ENOENT: no such file or directory, open ' + path);
    const bytes = entry.content || [];
    const encoding = typeof opts === 'string' ? opts : opts && opts.encoding;
    return encoding ? Buffer.from(bytes).toString(encoding) : Buffer.from(bytes);
  },
  readFileBuffer(path) {
    return fs.readFileSync(path)._data.buffer;
  },
  writeFileSync(path, data) {
    path = __normalize(path); __ensureParent(path);
    const bytes = __bytes(data);
    __entries[path] = { path, type: 'file', content: bytes, mode: 420, mtime: new Date().toISOString() };
    __operations.push({ type: 'write', path, data: bytes });
  },
  appendFileSync(path, data) {
    path = __normalize(path); __ensureParent(path);
    const previous = __entries[path] && __entries[path].content || [];
    const bytes = previous.concat(__bytes(data));
    __entries[path] = { path, type: 'file', content: bytes, mode: 420, mtime: new Date().toISOString() };
    __operations.push({ type: 'write', path, data: bytes });
  },
  existsSync(path) { return Boolean(__entries[__normalize(path)]); },
  statSync(path) { return __statValue(__entries[__normalize(path)]); },
  lstatSync(path) { return __statValue(__entries[__normalize(path)]); },
  readdirSync(path) {
    path = __normalize(path);
    if (!__entries[path] || __entries[path].type !== 'directory') throw new Error('ENOTDIR: not a directory, scandir ' + path);
    const prefix = path === '/' ? '/' : path + '/';
    return Object.keys(__entries).filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).map(p => p.slice(prefix.length));
  },
  mkdirSync(path, opts) {
    path = __normalize(path);
    const recursive = Boolean(opts && opts.recursive);
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (let index = 0; index < parts.length; index++) {
      current += '/' + parts[index];
      if (__entries[current]) continue;
      if (!recursive && index !== parts.length - 1) throw new Error('ENOENT: no such file or directory, mkdir ' + path);
      __entries[current] = { path: current, type: 'directory', mode: 493, mtime: new Date().toISOString() };
      __operations.push({ type: 'mkdir', path: current, recursive: false });
    }
  },
  rmSync(path, opts) {
    path = __normalize(path);
    if (!__entries[path]) {
      if (opts && opts.force) return;
      throw new Error('ENOENT: no such file or directory, rm ' + path);
    }
    const prefix = path + '/';
    const children = Object.keys(__entries).filter(p => p.startsWith(prefix));
    if (children.length && !(opts && opts.recursive)) throw new Error('ENOTEMPTY: directory not empty, rm ' + path);
    for (const child of children) delete __entries[child];
    delete __entries[path];
    __operations.push({ type: 'rm', path, recursive: Boolean(opts && opts.recursive), force: Boolean(opts && opts.force) });
  },
  symlinkSync(target, path) {
    path = __normalize(path); __ensureParent(path);
    __entries[path] = { path, type: 'symlink', target: String(target), mode: 511, mtime: new Date().toISOString() };
    __operations.push({ type: 'symlink', path, target: String(target) });
  },
  readlinkSync(path) {
    const entry = __entries[__normalize(path)];
    if (!entry || entry.type !== 'symlink') throw new Error('EINVAL: invalid argument, readlink ' + path);
    return entry.target;
  },
  chmodSync(path, mode) {
    path = __normalize(path);
    if (!__entries[path]) throw new Error('ENOENT: no such file or directory, chmod ' + path);
    __entries[path].mode = Number(mode);
    __operations.push({ type: 'chmod', path, mode: Number(mode) });
  },
  realpathSync(path) { return __normalize(path); },
  renameSync(oldPath, newPath) {
    oldPath = __normalize(oldPath); newPath = __normalize(newPath);
    const entry = __entries[oldPath];
    if (!entry) throw new Error('ENOENT: no such file or directory, rename ' + oldPath);
    delete __entries[oldPath]; entry.path = newPath; __entries[newPath] = entry;
    __operations.push({ type: 'rename', path: oldPath, destination: newPath });
  },
  copyFileSync(source, destination) {
    source = __normalize(source); destination = __normalize(destination);
    const entry = __entries[source];
    if (!entry || entry.type !== 'file') throw new Error('ENOENT: no such file or directory, copyfile ' + source);
    __entries[destination] = { ...entry, path: destination, content: entry.content.slice() };
    __operations.push({ type: 'copy', path: source, destination });
  }
};
fs.unlinkSync = fs.rmSync;
fs.rmdirSync = fs.rmSync;
for (const name of ['readFile','writeFile','stat','lstat','readdir','mkdir','rm','appendFile','symlink','readlink','chmod','realpath','rename','copyFile','unlink','rmdir']) {
  fs[name] = function() { throw new Error('fs.' + name + '() with callbacks is not supported. Use fs.' + name + 'Sync() or fs.promises.' + name + '() instead.'); };
}
fs.promises = {
  readFile: async (...args) => fs.readFileSync(...args),
  writeFile: async (...args) => fs.writeFileSync(...args),
  stat: async (...args) => fs.statSync(...args),
  lstat: async (...args) => fs.lstatSync(...args),
  readdir: async (...args) => fs.readdirSync(...args),
  mkdir: async (...args) => fs.mkdirSync(...args),
  rm: async (...args) => fs.rmSync(...args),
  appendFile: async (...args) => fs.appendFileSync(...args),
  symlink: async (...args) => fs.symlinkSync(...args),
  readlink: async (...args) => fs.readlinkSync(...args),
  chmod: async (...args) => fs.chmodSync(...args),
  realpath: async (...args) => fs.realpathSync(...args),
  rename: async (...args) => fs.renameSync(...args),
  copyFile: async (...args) => fs.copyFileSync(...args),
  unlink: async (...args) => fs.rmSync(...args),
  rmdir: async (...args) => fs.rmSync(...args),
  access: async path => { if (!fs.existsSync(path)) throw new Error('ENOENT: no such file or directory: ' + path); }
};
globalThis.fs = fs;
globalThis.env = ${JSON.stringify(Object.create(null))};
const process = {
  argv: ${JSON.stringify([options.scriptPath, ...options.scriptArgs])},
  cwd: () => ${JSON.stringify("")},
  env: globalThis.env,
  platform: 'linux',
  arch: 'x64',
  versions: { node: '22.0.0', quickjs: '2024' },
  version: 'v22.0.0',
  exit(code = 0) { const error = new Error('process.exit()'); error.__jsExecExit = Number(code); throw error; }
};
globalThis.process = process;
${PATH_MODULE_SOURCE}
globalThis[Symbol.for('jb:fetch')] = async (url, opts) => {
  const result = await __host.fetch(url, opts);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
${FETCH_POLYFILL_SOURCE.replace(
  "globalThis.fetch = function fetch(input, init) {",
  "globalThis.fetch = async function fetch(input, init) {",
)
  .replace(
    "var raw = _nativeFetch(url, opts);",
    "var raw = await _nativeFetch(url, opts);",
  )
  .replace(
    "return Promise.resolve(response);",
    "var pending = Promise.resolve(response); __pending.push(pending); return pending;",
  )
  .replace(
    "return Promise.reject(new TypeError(e.message || 'fetch failed'));",
    "var pending = Promise.reject(new TypeError(e.message || 'fetch failed')); __pending.push(pending.catch(function(){})); return pending;",
  )}
${EVENTS_MODULE_SOURCE}
${OS_MODULE_SOURCE}
${URL_MODULE_SOURCE}
${ASSERT_MODULE_SOURCE}
${UTIL_MODULE_SOURCE}
${STREAM_MODULE_SOURCE}
${STRING_DECODER_MODULE_SOURCE}
${QUERYSTRING_MODULE_SOURCE}
const __childProcess = {
  exec: async (command, opts) => await __host.exec(command, opts && opts.stdin),
  async execSync(command, opts) {
    const result = await __host.exec(command, opts && opts.stdin);
    if (result.exitCode !== 0) {
      const error = new Error('Command failed: ' + command);
      error.status = result.exitCode;
      error.stderr = result.stderr;
      error.stdout = result.stdout;
      throw error;
    }
    return result.stdout;
  },
  async spawnSync(command, args) {
    const result = await __host.execArgs(command, args || []);
    return { stdout: result.stdout, stderr: result.stderr, status: result.exitCode };
  }
};
const __modules = Object.assign(Object.create(null), {
  fs, path: globalThis[Symbol.for('jb:path')], child_process: __childProcess,
  process, console, os: globalThis[Symbol.for('jb:os')],
  url: globalThis[Symbol.for('jb:url')], assert: globalThis[Symbol.for('jb:assert')],
  util: globalThis[Symbol.for('jb:util')], events: globalThis[Symbol.for('jb:events')],
  buffer: globalThis[Symbol.for('jb:buffer')], stream: globalThis[Symbol.for('jb:stream')],
  string_decoder: globalThis[Symbol.for('jb:string_decoder')],
  querystring: globalThis[Symbol.for('jb:querystring')]
});
const __unsupported = ${JSON.stringify(UNSUPPORTED_MODULES)};
const __moduleFactories = Object.create(null);
const __moduleCache = Object.create(null);
function __resolveModule(name, parent) {
  if (name.startsWith('node:')) name = name.slice(5);
  if (!name.startsWith('.') && !name.startsWith('/')) return name;
  if (name.startsWith('/')) return __normalize(name);
  const base = parent ? parent.slice(0, parent.lastIndexOf('/')) : ${JSON.stringify(
    options.scriptPath,
  )};
  return __normalize(base + '/' + name);
}
function __require(name) {
  const resolved = name.startsWith('node:') ? name.slice(5) : name;
  if (Object.hasOwn(__modules, resolved)) return __modules[resolved];
  if (Object.hasOwn(__unsupported, resolved)) throw new Error("Module '" + resolved + "' is not available in the js-exec sandbox. " + __unsupported[resolved] + " Run 'js-exec --help' for available modules.");
  throw new Error("Cannot find module '" + name + "'. Run 'js-exec --help' for available modules.");
}
async function __import(name, parent) {
  const resolved = __resolveModule(name, parent);
  if (Object.hasOwn(__modules, resolved)) return __modules[resolved];
  if (Object.hasOwn(__unsupported, resolved)) throw new Error("Module '" + resolved + "' is not available in the js-exec sandbox. " + __unsupported[resolved] + " Run 'js-exec --help' for available modules.");
  if (!Object.hasOwn(__moduleFactories, resolved)) throw new Error("Cannot find module '" + name + "'. Run 'js-exec --help' for available modules.");
  if (__moduleCache[resolved]) return __moduleCache[resolved].exports;
  const module = { exports: {} }; __moduleCache[resolved] = module;
  await __moduleFactories[resolved](module, module.exports, child => __import(child, resolved));
  return module.exports;
}
globalThis.require = __require;
globalThis.require.resolve = name => name;
globalThis.tools = new Proxy(function(){}, {
  get(_target, property) {
    if (property === 'then' || typeof property === 'symbol') return undefined;
    return __makeToolsProxy([String(property)]);
  }
});
function __makeToolsProxy(path) {
  return new Proxy(function(){}, {
    get(_target, property) {
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return __makeToolsProxy(path.concat(String(property)));
    },
    apply(_target, _this, args) {
      return __host.invokeTool(path.join('.'), args.length ? JSON.stringify(args[0]) : '').then(function(result) {
        if (!result.ok) throw new Error(result.error);
        return result.value;
      });
    }
  });
}
try {
  ${options.bootstrapCode ?? ""}
  ${userSource}
  await Promise.allSettled(__pending);
  for (let index = 0; index < 8; index++) await Promise.resolve();
  return { stdout: __stdout.join(''), stderr: __stderr.join(''), exitCode: 0, operations: __operations };
} catch (error) {
  if (error && Object.hasOwn(error, '__jsExecExit')) {
    return { stdout: __stdout.join(''), stderr: __stderr.join(''), exitCode: error.__jsExecExit, operations: __operations };
  }
  const errorMessage = error && error.message ? String(error.message) : String(error);
  const errorStack = error && error.stack ? String(error.stack) : '';
  const message = errorStack.includes(errorMessage)
    ? errorStack
    : errorMessage + (errorStack ? '\\n' + errorStack : '');
  return { stdout: __stdout.join(''), stderr: __stderr.join('') + message + '\\n', exitCode: 1, operations: __operations };
}
`;
}

async function executeWithRunInner(
  options: RunJsOptions,
  ctx: RuntimeCommandContext,
): Promise<ExecResult> {
  const snapshot = await snapshotFileSystem(ctx);
  const strippedSource = options.stripTypes
    ? stripTypesOutsideSandbox(options.source)
    : options.source;
  const source = options.isModule
    ? await bundleModules(ctx, strippedSource, options.scriptPath)
    : adaptAsyncCapabilities(strippedSource);
  const env = mapToRecord(ctx.env);
  const cwd = ctx.cwd;
  const guestSource = createGuestSource(options, snapshot, source)
    .replace(
      `globalThis.env = ${JSON.stringify(Object.create(null))};`,
      `globalThis.env = ${JSON.stringify(env)};`,
    )
    .replace(
      `cwd: () => ${JSON.stringify("")}`,
      `cwd: () => ${JSON.stringify(cwd)}`,
    );

  const wrappedExec = ctx.exec
    ? async (command: string, stdin?: string) =>
        await jsExecContext.run(
          true,
          async () =>
            await ctx.exec?.(command, {
              cwd: ctx.cwd,
              env,
              stdin: stdin ?? "",
            } satisfies CommandExecOptions),
        )
    : async () => ({
        stdout: "",
        stderr: "exec not available\n",
        exitCode: 127,
      });
  const wrappedExecArgs = ctx.exec
    ? async (command: string, args: string[]) =>
        await jsExecContext.run(
          true,
          async () =>
            await ctx.exec?.(shellJoinArgs([command, ...args]), {
              cwd: ctx.cwd,
              env,
            } satisfies CommandExecOptions),
        )
    : async () => ({
        stdout: "",
        stderr: "exec not available\n",
        exitCode: 127,
      });

  try {
    const result = await jsExecContext.run(true, () =>
      jsExecRunResource.runInAsyncScope(
        async () =>
          await jsExecRunner.run<GuestResult>({
            source: guestSource,
            abortSignal: ctx.signal,
            limits: {
              timeoutMs: ctx.limits.maxJsTimeoutMs,
              memoryLimitBytes: 64 * 1024 * 1024,
              maxConsoleOutputBytes: 1,
              maxResultBytes: 16 * 1024 * 1024,
              maxHostFunctionArgumentsBytes: ctx.limits.maxWorkerMessageBytes,
              maxHostFunctionOutputBytes: ctx.limits.maxWorkerMessageBytes,
            },
            hostFunctions: {
              __host: {
                fetch: async (
                  url: string,
                  init?: {
                    method?: string;
                    headers?: Record<string, string>;
                    body?: string;
                  },
                ) => {
                  try {
                    if (!ctx.fetch) {
                      throw new Error("Network access not configured");
                    }
                    const response = await ctx.fetch(url, init);
                    return {
                      ok: true,
                      value: {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers,
                        body: Buffer.from(response.body).toString("latin1"),
                        url: response.url || url,
                      },
                    };
                  } catch (error) {
                    return { ok: false, error: getErrorMessage(error) };
                  }
                },
                exec: wrappedExec,
                execArgs: wrappedExecArgs,
                invokeTool: async (path: string, argsJson: string) => {
                  try {
                    if (!ctx.invokeTool)
                      throw new Error(`Unknown tool: ${path}`);
                    const resultJson = await ctx.invokeTool(path, argsJson);
                    return {
                      ok: true,
                      value: resultJson ? JSON.parse(resultJson) : undefined,
                    };
                  } catch (error) {
                    return { ok: false, error: getErrorMessage(error) };
                  }
                },
              },
            },
          }),
      ),
    );
    if (result.status !== "completed") {
      return {
        stdout: "",
        stderr: "js-exec: execution interrupted\n",
        exitCode: 1,
      };
    }
    await applyFileOperations(ctx, result.value.operations);
    if (
      ctx.limits.maxOutputSize > 0 &&
      Buffer.byteLength(result.value.stdout) +
        Buffer.byteLength(result.value.stderr) >
        ctx.limits.maxOutputSize
    ) {
      return {
        stdout: "",
        stderr: `js-exec: total output size exceeded limit of ${ctx.limits.maxOutputSize} bytes\n`,
        exitCode: 1,
      };
    }
    return {
      stdout: result.value.stdout,
      stderr: result.value.stderr,
      exitCode: result.value.exitCode,
    };
  } catch (error) {
    const timedOut = error instanceof RunTimeoutError;
    const aborted = error instanceof RunAbortedError;
    return {
      stdout: "",
      stderr: timedOut
        ? `js-exec: Execution timeout: exceeded ${ctx.limits.maxJsTimeoutMs}ms limit\n`
        : aborted
          ? "js-exec: Execution aborted\n"
          : `js-exec: ${sanitizeHostErrorMessage(getErrorMessage(error))}\n`,
      exitCode: timedOut || aborted ? 124 : 1,
    };
  }
}

export async function executeWithRun(
  options: RunJsOptions,
  ctx: RuntimeCommandContext,
): Promise<ExecResult> {
  if (jsExecContext.getStore()) {
    return {
      stdout: "",
      stderr: "js-exec: recursive invocation is not supported\n",
      exitCode: 1,
    };
  }
  if (activeJsExecRuns > 0) {
    return {
      stdout: "",
      stderr: "js-exec: JavaScript runtime maxWorkers limit reached (1).\n",
      exitCode: 1,
    };
  }

  activeJsExecRuns++;
  try {
    return await executeWithRunInner(options, ctx);
  } finally {
    activeJsExecRuns--;
  }
}

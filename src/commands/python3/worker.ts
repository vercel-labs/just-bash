/**
 * Worker thread for Python execution via CPython Emscripten.
 * Creates a fresh CPython WASM instance per execution (EXIT_RUNTIME).
 *
 * Security model: CPython Emscripten has zero JS bridge code.
 * `import js` fails with `ModuleNotFoundError` — the module doesn't exist.
 * `os.system()` is patched to no-op at Emscripten level.
 * No sandbox code needed — isolation is by construction.
 *
 * Defense-in-depth activates BEFORE CPython loads to block dangerous Node.js APIs.
 */

import { createRequire } from "node:module";
import { dirname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { sanitizeHostErrorMessage } from "../../fs/sanitize-error.js";
import {
  WorkerDefenseInDepth,
  type WorkerDefenseStats,
} from "../../security/index.js";
import {
  sanitizeUnknownError,
  wrapWasmCallback,
} from "../../security/wasm-callback.js";
import { SyncBackend } from "../worker-bridge/sync-backend.js";

export interface WorkerInput {
  protocolToken: string;
  sharedBuffer: SharedArrayBuffer;
  pythonCode: string;
  cwd: string;
  env: Record<string, string>;
  args: string[];
  scriptPath?: string;
  timeoutMs?: number;
}

export interface WorkerOutput {
  success: boolean;
  error?: string;
  /** Defense-in-depth stats if enabled */
  defenseStats?: WorkerDefenseStats;
}

const require = createRequire(import.meta.url);
const CPYTHON_ENTRY_BASENAME = "/vendor/cpython-emscripten/python.cjs";
const CPYTHON_STDLIB_BASENAME = "/vendor/cpython-emscripten/python313.zip";
let moduleLoadGuardInstalled = false;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isApprovedCpythonEntryPath(path: string): boolean {
  return normalizePath(path).endsWith(CPYTHON_ENTRY_BASENAME);
}

function isApprovedStdlibZipPath(path: string): boolean {
  return normalizePath(path).endsWith(CPYTHON_STDLIB_BASENAME);
}

function assertApprovedPath(
  path: string,
  kind: "cpython-entry" | "cpython-stdlib",
): void {
  const ok =
    kind === "cpython-entry"
      ? isApprovedCpythonEntryPath(path)
      : isApprovedStdlibZipPath(path);
  if (!ok) {
    throw new Error(
      `[Defense-in-depth] rejected ${kind} path outside approved vendor bundle: ${path}`,
    );
  }
}

// Module._load protection: block dangerous require() calls at file load time,
// BEFORE python.cjs is loaded. This closes the initialization window where
// Emscripten callbacks could call require() unrestricted.
// ESM imports (import { ... } from "...") are unaffected by Module._load.
try {
  // biome-ignore lint/complexity/noBannedTypes: Module._load signature is untyped
  const NodeModule = require("node:module") as { _load: Function };
  if (typeof NodeModule._load === "function") {
    const originalLoad = NodeModule._load;
    const blockedModules = new Set([
      "child_process",
      "node:child_process",
      "cluster",
      "node:cluster",
      "dgram",
      "node:dgram",
      "dns",
      "node:dns",
      "net",
      "node:net",
      "tls",
      "node:tls",
      "vm",
      "node:vm",
      "v8",
      "node:v8",
      "inspector",
      "node:inspector",
      "inspector/promises",
      "node:inspector/promises",
      "trace_events",
      "node:trace_events",
      "perf_hooks",
      "node:perf_hooks",
      "worker_threads",
      "node:worker_threads",
    ]);
    NodeModule._load = function (request: string, ...rest: unknown[]) {
      if (blockedModules.has(request)) {
        throw new Error(
          `[Defense-in-depth] require('${request}') is blocked in worker context`,
        );
      }
      return originalLoad.apply(this, [request, ...rest]);
    };
    moduleLoadGuardInstalled = true;
  }
} catch {
  /* best-effort */
}

let cpythonEntryPath: string;
try {
  cpythonEntryPath = require.resolve(
    "../../../vendor/cpython-emscripten/python.cjs",
  );
} catch (_e) {
  // Fallback: resolve relative to this file
  cpythonEntryPath =
    dirname(import.meta.url).replace("file://", "") +
    "/../../../vendor/cpython-emscripten/python.cjs";
}
assertApprovedPath(cpythonEntryPath, "cpython-entry");

const cpythonDir = dirname(cpythonEntryPath);
const stdlibZipPath = `${cpythonDir}/python313.zip`;
assertApprovedPath(stdlibZipPath, "cpython-stdlib");

// Emscripten module types
interface EmscriptenModule {
  FS: EmscriptenFS & {
    filesystems: Record<string, EmscriptenFSType>;
    mkdirTree: (path: string) => void;
    writeFile: (path: string, data: Uint8Array) => void;
  };
  PATH: EmscriptenPATH;
  ENV: Record<string, string>;
  callMain: (args: string[]) => number;
}

/**
 * Create a HOSTFS backend that bridges to just-bash's filesystem.
 * This follows the Emscripten NODEFS pattern but uses SyncBackend.
 */

// Emscripten FS type definitions (based on Emscripten's internal structures)
interface EmscriptenNode {
  name: string;
  mode: number;
  parent: EmscriptenNode;
  mount: EmscriptenMount;
  id: number;
  node_ops?: EmscriptenNodeOps;
  stream_ops?: EmscriptenStreamOps;
  // Custom properties for HOSTFS
  hostPath?: string;
}

interface EmscriptenStream {
  node: EmscriptenNode;
  flags: number;
  position: number;
  // Custom properties for HOSTFS
  hostContent?: Uint8Array;
  hostModified?: boolean;
  hostPath?: string;
}

interface EmscriptenMount {
  opts: { root: string };
}

interface EmscriptenNodeOps {
  getattr: (node: EmscriptenNode) => EmscriptenStat;
  setattr: (
    node: EmscriptenNode,
    attr: { mode?: number; size?: number },
  ) => void;
  lookup: (parent: EmscriptenNode, name: string) => EmscriptenNode;
  mknod: (
    parent: EmscriptenNode,
    name: string,
    mode: number,
    dev: number,
  ) => EmscriptenNode;
  rename: (
    oldNode: EmscriptenNode,
    newDir: EmscriptenNode,
    newName: string,
  ) => void;
  unlink: (parent: EmscriptenNode, name: string) => void;
  rmdir: (parent: EmscriptenNode, name: string) => void;
  readdir: (node: EmscriptenNode) => string[];
  symlink: (parent: EmscriptenNode, newName: string, oldPath: string) => void;
  readlink: (node: EmscriptenNode) => string;
}

interface EmscriptenStreamOps {
  open: (stream: EmscriptenStream) => void;
  close: (stream: EmscriptenStream) => void;
  read: (
    stream: EmscriptenStream,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => number;
  write: (
    stream: EmscriptenStream,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => number;
  llseek: (stream: EmscriptenStream, offset: number, whence: number) => number;
}

interface EmscriptenStat {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  blksize: number;
  blocks: number;
}

interface EmscriptenFS {
  isDir: (mode: number) => boolean;
  isFile: (mode: number) => boolean;
  isLink: (mode: number) => boolean;
  createNode: (
    parent: EmscriptenNode | null,
    name: string,
    mode: number,
    dev?: number,
  ) => EmscriptenNode;
  ErrnoError: new (errno: number) => Error;
  mkdir: (path: string) => void;
  unmount: (path: string) => void;
  mount: (
    type: EmscriptenFSType,
    opts: { root: string },
    mountpoint: string,
  ) => void;
}

interface EmscriptenFSType {
  mount: (mount: EmscriptenMount) => EmscriptenNode;
  createNode: (
    parent: EmscriptenNode | null,
    name: string,
    mode: number,
    dev?: number,
  ) => EmscriptenNode;
  node_ops: EmscriptenNodeOps;
  stream_ops: EmscriptenStreamOps;
}

interface EmscriptenPATH {
  join: (...paths: string[]) => string;
  join2: (path1: string, path2: string) => string;
}

function createHOSTFS(
  backend: SyncBackend,
  FS: EmscriptenFS,
  PATH: EmscriptenPATH,
) {
  const ERRNO_CODES: Record<string, number> = Object.assign(
    Object.create(null) as Record<string, number>,
    {
      EPERM: 63,
      ENOENT: 44,
      EIO: 29,
      EBADF: 8,
      EAGAIN: 6,
      EACCES: 2,
      EBUSY: 10,
      EEXIST: 20,
      ENOTDIR: 54,
      EISDIR: 31,
      EINVAL: 28,
      EMFILE: 33,
      ENOSPC: 51,
      ESPIPE: 70,
      EROFS: 69,
      ENOTEMPTY: 55,
      ENOSYS: 52,
      ENOTSUP: 138,
      ENODATA: 42,
    },
  );

  function realPath(node: EmscriptenNode): string {
    const parts: string[] = [];
    while (node.parent !== node) {
      parts.push(node.name);
      node = node.parent;
    }
    parts.push(node.mount.opts.root);
    parts.reverse();
    return PATH.join(...parts);
  }

  function tryFSOperation<T>(f: () => T): T {
    try {
      return f();
    } catch (e: unknown) {
      const msg =
        (e as Error)?.message?.toLowerCase() ||
        (typeof e === "string" ? e.toLowerCase() : "");
      let code = ERRNO_CODES.EIO;
      if (msg.includes("no such file") || msg.includes("not found")) {
        code = ERRNO_CODES.ENOENT;
      } else if (msg.includes("is a directory")) {
        code = ERRNO_CODES.EISDIR;
      } else if (msg.includes("not a directory")) {
        code = ERRNO_CODES.ENOTDIR;
      } else if (msg.includes("already exists")) {
        code = ERRNO_CODES.EEXIST;
      } else if (msg.includes("permission")) {
        code = ERRNO_CODES.EACCES;
      } else if (msg.includes("not empty")) {
        code = ERRNO_CODES.ENOTEMPTY;
      }
      throw new FS.ErrnoError(code);
    }
  }

  function getMode(path: string): number {
    return tryFSOperation(() => {
      const stat = backend.stat(path);
      let mode = stat.mode & 0o777;
      if (stat.isDirectory) {
        mode |= 0o40000; // S_IFDIR
      } else if (stat.isSymbolicLink) {
        mode |= 0o120000; // S_IFLNK
      } else {
        mode |= 0o100000; // S_IFREG
      }
      return mode;
    });
  }

  const HOSTFS = {
    mount(_mount: EmscriptenMount) {
      // Create root node as directory - don't call backend during mount
      return HOSTFS.createNode(null, "/", 0o40755, 0);
    },

    createNode(
      parent: EmscriptenNode | null,
      name: string,
      mode: number,
      dev?: number,
    ) {
      if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }
      const node = FS.createNode(parent, name, mode, dev);
      node.node_ops = HOSTFS.node_ops;
      node.stream_ops = HOSTFS.stream_ops;
      return node;
    },

    node_ops: {
      getattr(node: EmscriptenNode) {
        const path = realPath(node);
        return tryFSOperation(() => {
          const stat = backend.stat(path);
          let mode = stat.mode & 0o777;
          if (stat.isDirectory) {
            mode |= 0o40000;
          } else if (stat.isSymbolicLink) {
            mode |= 0o120000;
          } else {
            mode |= 0o100000;
          }
          return {
            dev: 1,
            ino: node.id,
            mode,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: 0,
            size: stat.size,
            atime: stat.mtime,
            mtime: stat.mtime,
            ctime: stat.mtime,
            blksize: 4096,
            blocks: Math.ceil(stat.size / 512),
          };
        });
      },

      setattr(node: EmscriptenNode, attr: { mode?: number; size?: number }) {
        const path = realPath(node);
        const mode = attr.mode;
        if (mode !== undefined) {
          tryFSOperation(() => backend.chmod(path, mode));
          node.mode = mode;
        }
        if (attr.size !== undefined) {
          tryFSOperation(() => {
            const content = backend.readFile(path);
            const newContent = content.slice(0, attr.size);
            backend.writeFile(path, newContent);
          });
        }
      },

      lookup(parent: EmscriptenNode, name: string) {
        const path = PATH.join2(realPath(parent), name);
        const mode = getMode(path);
        return HOSTFS.createNode(parent, name, mode);
      },

      mknod(parent: EmscriptenNode, name: string, mode: number, _dev: number) {
        const node = HOSTFS.createNode(parent, name, mode, _dev);
        const path = realPath(node);
        tryFSOperation(() => {
          if (FS.isDir(node.mode)) {
            backend.mkdir(path, false);
          } else {
            backend.writeFile(path, new Uint8Array(0));
          }
        });
        return node;
      },

      rename(oldNode: EmscriptenNode, newDir: EmscriptenNode, newName: string) {
        const oldPath = realPath(oldNode);
        const newPath = PATH.join2(realPath(newDir), newName);
        tryFSOperation(() => {
          const content = backend.readFile(oldPath);
          backend.writeFile(newPath, content);
          backend.rm(oldPath, false, false);
        });
        oldNode.name = newName;
      },

      unlink(parent: EmscriptenNode, name: string) {
        const path = PATH.join2(realPath(parent), name);
        tryFSOperation(() => backend.rm(path, false, false));
      },

      rmdir(parent: EmscriptenNode, name: string) {
        const path = PATH.join2(realPath(parent), name);
        tryFSOperation(() => backend.rm(path, false, false));
      },

      readdir(node: EmscriptenNode) {
        const path = realPath(node);
        return tryFSOperation(() => backend.readdir(path));
      },

      symlink(parent: EmscriptenNode, newName: string, oldPath: string) {
        const newPath = PATH.join2(realPath(parent), newName);
        tryFSOperation(() => backend.symlink(oldPath, newPath));
      },

      readlink(node: EmscriptenNode) {
        const path = realPath(node);
        return tryFSOperation(() => backend.readlink(path));
      },
    },

    stream_ops: {
      open(stream: EmscriptenStream) {
        const path = realPath(stream.node);
        const flags = stream.flags;

        const O_WRONLY = 1;
        const O_RDWR = 2;
        const O_CREAT = 64;
        const O_TRUNC = 512;
        const O_APPEND = 1024;

        const accessMode = flags & 3;
        const isWrite = accessMode === O_WRONLY || accessMode === O_RDWR;
        const isCreate = (flags & O_CREAT) !== 0;
        const isTruncate = (flags & O_TRUNC) !== 0;
        const isAppend = (flags & O_APPEND) !== 0;

        if (FS.isDir(stream.node.mode)) {
          return;
        }

        let content: Uint8Array;
        try {
          if (isTruncate && isWrite) {
            content = new Uint8Array(0);
          } else {
            content = backend.readFile(path);
          }
        } catch (_e) {
          if (isCreate && isWrite) {
            content = new Uint8Array(0);
          } else {
            throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
          }
        }

        stream.hostContent = content;
        stream.hostModified = isTruncate && isWrite;
        stream.hostPath = path;

        if (isAppend) {
          stream.position = content.length;
        }
      },

      close(stream: EmscriptenStream) {
        const hostPath = stream.hostPath;
        const hostContent = stream.hostContent;
        if (stream.hostModified && hostContent && hostPath) {
          tryFSOperation(() => backend.writeFile(hostPath, hostContent));
        }
        delete stream.hostContent;
        delete stream.hostModified;
        delete stream.hostPath;
      },

      read(
        stream: EmscriptenStream,
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ) {
        const content = stream.hostContent;
        if (!content) return 0;

        const size = content.length;
        if (position >= size) return 0;

        const bytesToRead = Math.min(length, size - position);
        buffer.set(content.subarray(position, position + bytesToRead), offset);
        return bytesToRead;
      },

      write(
        stream: EmscriptenStream,
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ) {
        let content = stream.hostContent || new Uint8Array(0);
        const newSize = Math.max(content.length, position + length);

        if (newSize > content.length) {
          const newContent = new Uint8Array(newSize);
          newContent.set(content);
          content = newContent;
          stream.hostContent = content;
        }

        content.set(buffer.subarray(offset, offset + length), position);
        stream.hostModified = true;
        return length;
      },

      llseek(stream: EmscriptenStream, offset: number, whence: number) {
        const SEEK_CUR = 1;
        const SEEK_END = 2;

        let position = offset;
        if (whence === SEEK_CUR) {
          position += stream.position;
        } else if (whence === SEEK_END) {
          if (FS.isFile(stream.node.mode)) {
            const content = stream.hostContent;
            position += content ? content.length : 0;
          }
        }

        if (position < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }

        return position;
      },
    },
  };

  return HOSTFS;
}

/**
 * Generate the Python setup code that runs before user code.
 * Sets up environment, sys.argv, path redirection, HTTP bridge, and jb_http module.
 */
function generateSetupCode(input: WorkerInput): string {
  // Set up environment variables
  const envSetup = Object.entries(input.env)
    .map(([key, value]) => {
      return `os.environ[${JSON.stringify(key)}] = ${JSON.stringify(value)}`;
    })
    .join("\n");

  // Set up sys.argv
  const argv0 = input.scriptPath || "python3";
  const argvList = [argv0, ...input.args]
    .map((arg) => JSON.stringify(arg))
    .join(", ");

  return `
import os
import sys
import json

${envSetup}

sys.argv = [${argvList}]

# Path redirection: redirect /absolute paths to /host mount
def _should_redirect(path):
    return (isinstance(path, str) and
            path.startswith('/') and
            not path.startswith('/lib') and
            not path.startswith('/proc') and
            not path.startswith('/host') and
            not path.startswith('/_jb_http'))

# builtins.open
import builtins
_orig_open = builtins.open
def _redir_open(path, mode='r', *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_open(path, mode, *args, **kwargs)
builtins.open = _redir_open

# os file operations
_orig_listdir = os.listdir
def _redir_listdir(path='.'):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_listdir(path)
os.listdir = _redir_listdir

_orig_exists = os.path.exists
def _redir_exists(path):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_exists(path)
os.path.exists = _redir_exists

_orig_isfile = os.path.isfile
def _redir_isfile(path):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_isfile(path)
os.path.isfile = _redir_isfile

_orig_isdir = os.path.isdir
def _redir_isdir(path):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_isdir(path)
os.path.isdir = _redir_isdir

_orig_stat = os.stat
def _redir_stat(path, *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_stat(path, *args, **kwargs)
os.stat = _redir_stat

_orig_mkdir = os.mkdir
def _redir_mkdir(path, *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_mkdir(path, *args, **kwargs)
os.mkdir = _redir_mkdir

_orig_makedirs = os.makedirs
def _redir_makedirs(path, *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_makedirs(path, *args, **kwargs)
os.makedirs = _redir_makedirs

_orig_remove = os.remove
def _redir_remove(path, *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_remove(path, *args, **kwargs)
os.remove = _redir_remove

_orig_rmdir = os.rmdir
def _redir_rmdir(path, *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_rmdir(path, *args, **kwargs)
os.rmdir = _redir_rmdir

_orig_getcwd = os.getcwd
def _redir_getcwd():
    cwd = _orig_getcwd()
    if cwd.startswith('/host'):
        return cwd[5:]
    return cwd
os.getcwd = _redir_getcwd

_orig_chdir = os.chdir
def _redir_chdir(path):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_chdir(path)
os.chdir = _redir_chdir

# glob
import glob as _glob_module
_orig_glob = _glob_module.glob
def _redir_glob(pathname, *args, **kwargs):
    if _should_redirect(pathname):
        pathname = '/host' + pathname
    return _orig_glob(pathname, *args, **kwargs)
_glob_module.glob = _redir_glob

_orig_iglob = _glob_module.iglob
def _redir_iglob(pathname, *args, **kwargs):
    if _should_redirect(pathname):
        pathname = '/host' + pathname
    return _orig_iglob(pathname, *args, **kwargs)
_glob_module.iglob = _redir_iglob

# os.walk
_orig_walk = os.walk
def _redir_walk(top, *args, **kwargs):
    redirected = False
    if _should_redirect(top):
        top = '/host' + top
        redirected = True
    for dirpath, dirnames, filenames in _orig_walk(top, *args, **kwargs):
        if redirected and dirpath.startswith('/host'):
            dirpath = dirpath[5:] if len(dirpath) > 5 else '/'
        yield dirpath, dirnames, filenames
os.walk = _redir_walk

# os.scandir
_orig_scandir = os.scandir
def _redir_scandir(path='.'):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_scandir(path)
os.scandir = _redir_scandir

# io.open
import io as _io_module
_io_module.open = builtins.open

# shutil
import shutil as _shutil_module

_orig_shutil_copy = _shutil_module.copy
def _redir_shutil_copy(src, dst, *args, **kwargs):
    if _should_redirect(src): src = '/host' + src
    if _should_redirect(dst): dst = '/host' + dst
    return _orig_shutil_copy(src, dst, *args, **kwargs)
_shutil_module.copy = _redir_shutil_copy

_orig_shutil_copy2 = _shutil_module.copy2
def _redir_shutil_copy2(src, dst, *args, **kwargs):
    if _should_redirect(src): src = '/host' + src
    if _should_redirect(dst): dst = '/host' + dst
    return _orig_shutil_copy2(src, dst, *args, **kwargs)
_shutil_module.copy2 = _redir_shutil_copy2

_orig_shutil_copyfile = _shutil_module.copyfile
def _redir_shutil_copyfile(src, dst, *args, **kwargs):
    if _should_redirect(src): src = '/host' + src
    if _should_redirect(dst): dst = '/host' + dst
    return _orig_shutil_copyfile(src, dst, *args, **kwargs)
_shutil_module.copyfile = _redir_shutil_copyfile

_orig_shutil_copytree = _shutil_module.copytree
def _redir_shutil_copytree(src, dst, *args, **kwargs):
    if _should_redirect(src): src = '/host' + src
    if _should_redirect(dst): dst = '/host' + dst
    return _orig_shutil_copytree(src, dst, *args, **kwargs)
_shutil_module.copytree = _redir_shutil_copytree

_orig_shutil_move = _shutil_module.move
def _redir_shutil_move(src, dst, *args, **kwargs):
    if _should_redirect(src): src = '/host' + src
    if _should_redirect(dst): dst = '/host' + dst
    return _orig_shutil_move(src, dst, *args, **kwargs)
_shutil_module.move = _redir_shutil_move

_orig_shutil_rmtree = _shutil_module.rmtree
def _redir_shutil_rmtree(path, *args, **kwargs):
    if _should_redirect(path): path = '/host' + path
    return _orig_shutil_rmtree(path, *args, **kwargs)
_shutil_module.rmtree = _redir_shutil_rmtree

# pathlib.Path
from pathlib import Path

def _redirect_path(p):
    s = str(p)
    if _should_redirect(s):
        return Path('/host' + s)
    return p

Path._orig_stat = Path.stat
def _path_stat(self, *args, **kwargs):
    return _redirect_path(self)._orig_stat(*args, **kwargs)
Path.stat = _path_stat

Path._orig_exists = Path.exists
def _path_exists(self):
    return _redirect_path(self)._orig_exists()
Path.exists = _path_exists

Path._orig_is_file = Path.is_file
def _path_is_file(self):
    return _redirect_path(self)._orig_is_file()
Path.is_file = _path_is_file

Path._orig_is_dir = Path.is_dir
def _path_is_dir(self):
    return _redirect_path(self)._orig_is_dir()
Path.is_dir = _path_is_dir

Path._orig_open = Path.open
def _path_open(self, *args, **kwargs):
    return _redirect_path(self)._orig_open(*args, **kwargs)
Path.open = _path_open

Path._orig_read_text = Path.read_text
def _path_read_text(self, *args, **kwargs):
    return _redirect_path(self)._orig_read_text(*args, **kwargs)
Path.read_text = _path_read_text

Path._orig_read_bytes = Path.read_bytes
def _path_read_bytes(self):
    return _redirect_path(self)._orig_read_bytes()
Path.read_bytes = _path_read_bytes

Path._orig_write_text = Path.write_text
def _path_write_text(self, *args, **kwargs):
    return _redirect_path(self)._orig_write_text(*args, **kwargs)
Path.write_text = _path_write_text

Path._orig_write_bytes = Path.write_bytes
def _path_write_bytes(self, data):
    return _redirect_path(self)._orig_write_bytes(data)
Path.write_bytes = _path_write_bytes

Path._orig_mkdir = Path.mkdir
def _path_mkdir(self, *args, **kwargs):
    return _redirect_path(self)._orig_mkdir(*args, **kwargs)
Path.mkdir = _path_mkdir

Path._orig_rmdir = Path.rmdir
def _path_rmdir(self):
    return _redirect_path(self)._orig_rmdir()
Path.rmdir = _path_rmdir

Path._orig_unlink = Path.unlink
def _path_unlink(self, *args, **kwargs):
    return _redirect_path(self)._orig_unlink(*args, **kwargs)
Path.unlink = _path_unlink

Path._orig_iterdir = Path.iterdir
def _path_iterdir(self):
    redirected = _redirect_path(self)
    for p in redirected._orig_iterdir():
        s = str(p)
        if s.startswith('/host'):
            yield Path(s[5:])
        else:
            yield p
Path.iterdir = _path_iterdir

Path._orig_glob = Path.glob
def _path_glob(self, pattern):
    redirected = _redirect_path(self)
    for p in redirected._orig_glob(pattern):
        s = str(p)
        if s.startswith('/host'):
            yield Path(s[5:])
        else:
            yield p
Path.glob = _path_glob

Path._orig_rglob = Path.rglob
def _path_rglob(self, pattern):
    redirected = _redirect_path(self)
    for p in redirected._orig_rglob(pattern):
        s = str(p)
        if s.startswith('/host'):
            yield Path(s[5:])
        else:
            yield p
Path.rglob = _path_rglob

# Set cwd to host mount
os.chdir('/host' + ${JSON.stringify(input.cwd)})
`;
}

/**
 * Create a custom Emscripten FS for the HTTP bridge.
 * Mounted at /_jb_http. Python writes a request JSON to /_jb_http/request,
 * which triggers backend.httpRequest() synchronously and stores the response.
 * Python then reads the response from the same file.
 */
function createHTTPFS(backend: SyncBackend, FS: EmscriptenFS) {
  // Stores the last HTTP response for read-back
  let lastResponse: Uint8Array | null = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const HTTPFS = {
    mount(_mount: EmscriptenMount) {
      return HTTPFS.createNode(null, "/", 0o40755, 0);
    },

    createNode(
      parent: EmscriptenNode | null,
      name: string,
      mode: number,
      dev?: number,
    ) {
      const node = FS.createNode(parent, name, mode, dev);
      node.node_ops = HTTPFS.node_ops;
      node.stream_ops = HTTPFS.stream_ops;
      return node;
    },

    node_ops: {
      getattr(node: EmscriptenNode) {
        const isDir = node.name === "/" || node.parent === node;
        return {
          dev: 1,
          ino: node.id,
          mode: isDir ? 0o40755 : 0o100666,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          size: lastResponse ? lastResponse.length : 0,
          atime: new Date(),
          mtime: new Date(),
          ctime: new Date(),
          blksize: 4096,
          blocks: 0,
        };
      },
      setattr(_node: EmscriptenNode, _attr: { mode?: number; size?: number }) {
        // no-op
      },
      lookup(parent: EmscriptenNode, name: string) {
        return HTTPFS.createNode(parent, name, 0o100666);
      },
      mknod(parent: EmscriptenNode, name: string, mode: number, _dev: number) {
        return HTTPFS.createNode(parent, name, mode);
      },
      rename() {},
      unlink() {},
      rmdir() {},
      readdir(_node: EmscriptenNode) {
        return ["request"];
      },
      symlink() {},
      readlink(_node: EmscriptenNode) {
        return "";
      },
    },

    stream_ops: {
      open(stream: EmscriptenStream) {
        delete stream.hostContent;
        stream.hostModified = false;

        // If opening for read and we have a cached response, serve it
        const accessMode = stream.flags & 3;
        const isRead = accessMode === 0; // O_RDONLY
        if (isRead && lastResponse) {
          stream.hostContent = lastResponse;
        }
      },

      close(stream: EmscriptenStream) {
        // When the request file is closed after writing, execute the HTTP request
        if (stream.hostModified && stream.hostContent) {
          const reqJson = decoder.decode(stream.hostContent);
          try {
            const req = JSON.parse(reqJson);
            const result = backend.httpRequest(req.url, {
              method: req.method || "GET",
              headers: req.headers || undefined,
              body: req.body || undefined,
            });
            lastResponse = encoder.encode(JSON.stringify(result));
          } catch (e) {
            const message = sanitizeHostErrorMessage((e as Error).message);
            lastResponse = encoder.encode(JSON.stringify({ error: message }));
          }
        }
        delete stream.hostContent;
        delete stream.hostModified;
      },

      read(
        stream: EmscriptenStream,
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ) {
        const content = stream.hostContent;
        if (!content) return 0;
        const size = content.length;
        if (position >= size) return 0;
        const bytesToRead = Math.min(length, size - position);
        buffer.set(content.subarray(position, position + bytesToRead), offset);
        return bytesToRead;
      },

      write(
        stream: EmscriptenStream,
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ) {
        let content = stream.hostContent || new Uint8Array(0);
        const newSize = Math.max(content.length, position + length);
        if (newSize > content.length) {
          const newContent = new Uint8Array(newSize);
          newContent.set(content);
          content = newContent;
          stream.hostContent = content;
        }
        content.set(buffer.subarray(offset, offset + length), position);
        stream.hostModified = true;
        return length;
      },

      llseek(stream: EmscriptenStream, offset: number, whence: number) {
        let position = offset;
        if (whence === 1)
          position += stream.position; // SEEK_CUR
        else if (whence === 2) {
          const content = stream.hostContent;
          position += content ? content.length : 0;
        }
        if (position < 0) throw new FS.ErrnoError(28); // EINVAL
        return position;
      },
    },
  };

  return HTTPFS;
}

/**
 * Generate the HTTP bridge Python code.
 * Uses /_jb_http/request: write request JSON → triggers HTTP → read response JSON.
 */
function generateHttpBridgeCode(): string {
  return `
# HTTP bridge: jb_http module
# Write request JSON to /_jb_http/request (custom FS triggers HTTP via SharedArrayBuffer)
# Then read response JSON from same path.

class _JbHttpResponse:
    """HTTP response object similar to requests.Response"""
    def __init__(self, data):
        self.status_code = data.get('status', 0)
        self.reason = data.get('statusText', '')
        # @banned-pattern-ignore: Python code, not JavaScript
        self.headers = data.get('headers', {})
        self.text = data.get('body', '')
        self.url = data.get('url', '')
        self._error = data.get('error')

    @property
    def ok(self):
        return 200 <= self.status_code < 300

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self._error:
            raise Exception(self._error)
        if not self.ok:
            raise Exception(f"HTTP {self.status_code}: {self.reason}")

class _JbHttp:
    """HTTP client that bridges to just-bash's secureFetch via custom FS"""
    def _do_request(self, method, url, headers=None, body=None):
        import json as _json
        req = _json.dumps({'url': url, 'method': method, 'headers': headers, 'body': body})
        # Write request to HTTPFS — close triggers the HTTP call synchronously
        with _orig_open('/_jb_http/request', 'w') as f:
            f.write(req)
        # Read response (cached by HTTPFS from the HTTP call above)
        with _orig_open('/_jb_http/request', 'r') as f:
            return _json.loads(f.read())

    def request(self, method, url, headers=None, data=None, json_data=None):
        if json_data is not None:
            data = json.dumps(json_data)
            headers = headers or {}
            headers['Content-Type'] = 'application/json'
        result = self._do_request(method, url, headers, data)
        if 'error' in result and result.get('status') is None:
            raise Exception(result['error'])
        return _JbHttpResponse(result)

    def get(self, url, headers=None, **kwargs):
        return self.request('GET', url, headers=headers, **kwargs)

    def post(self, url, headers=None, data=None, json=None, **kwargs):
        return self.request('POST', url, headers=headers, data=data, json_data=json, **kwargs)

    def put(self, url, headers=None, data=None, json=None, **kwargs):
        return self.request('PUT', url, headers=headers, data=data, json_data=json, **kwargs)

    def delete(self, url, headers=None, **kwargs):
        return self.request('DELETE', url, headers=headers, **kwargs)

    def head(self, url, headers=None, **kwargs):
        return self.request('HEAD', url, headers=headers, **kwargs)

    def patch(self, url, headers=None, data=None, json=None, **kwargs):
        return self.request('PATCH', url, headers=headers, data=data, json_data=json, **kwargs)

import types
jb_http = types.ModuleType('jb_http')
jb_http._client = _JbHttp()
jb_http.get = jb_http._client.get
jb_http.post = jb_http._client.post
jb_http.put = jb_http._client.put
jb_http.delete = jb_http._client.delete
jb_http.head = jb_http._client.head
jb_http.patch = jb_http._client.patch
jb_http.request = jb_http._client.request
jb_http.Response = _JbHttpResponse
sys.modules['jb_http'] = jb_http
`;
}

// Read stdlib zip at module load time (before defense-in-depth activates).
import { readFileSync } from "node:fs";

const cachedStdlibZip = new Uint8Array(readFileSync(stdlibZipPath));

function wrapWorkerMessage(
  protocolToken: string,
  message: unknown,
): Record<string, unknown> {
  const wrapped = Object.create(null) as Record<string, unknown>;

  if (!message || typeof message !== "object") {
    wrapped.success = false;
    wrapped.error = "Worker attempted to post non-object message";
    wrapped.protocolToken = protocolToken;
    return wrapped;
  }

  for (const [key, value] of Object.entries(message as Record<string, unknown>))
    wrapped[key] = value;

  // Set token AFTER copying message entries to prevent payload from overwriting it
  wrapped.protocolToken = protocolToken;
  return wrapped;
}

function postWorkerMessage(protocolToken: string, message: unknown): void {
  try {
    parentPort?.postMessage(wrapWorkerMessage(protocolToken, message));
  } catch (error) {
    // Best effort: avoid crashing worker on a closed/invalid parent port.
    console.debug(
      "[python3-worker] failed to post worker message:",
      sanitizeUnknownError(error),
    );
  }
}

async function runPython(input: WorkerInput): Promise<WorkerOutput> {
  if (!moduleLoadGuardInstalled) {
    return {
      success: false,
      error:
        "Defense-in-depth module-loader guard failed to initialize; refusing to execute Python worker",
    };
  }

  const backend = new SyncBackend(input.sharedBuffer, input.timeoutMs);

  // Load the CPython Emscripten factory function
  assertApprovedPath(cpythonEntryPath, "cpython-entry");
  // @banned-pattern-ignore: path validated by assertApprovedPath allowlist above
  const createPythonModule = require(cpythonEntryPath) as (
    config: Record<string, unknown>,
  ) => Promise<EmscriptenModule>;

  // During module initialization, buffer output instead of using the SharedArrayBuffer
  // backend. The bridge handler on the main thread may not be ready yet, and
  // Atomics.wait() would block the worker indefinitely.
  let moduleReady = false;
  const pendingStdout: string[] = [];
  const pendingStderr: string[] = [];

  let Module: EmscriptenModule;
  try {
    const onPreRun = wrapWasmCallback(
      "python3-worker",
      "preRun",
      (mod: EmscriptenModule) => {
        // Write stdlib zip into MEMFS (no real FS access from WASM).
        // Python's zipimport can import directly from zip files.
        mod.FS.mkdirTree("/lib");
        mod.FS.writeFile("/lib/python313.zip", cachedStdlibZip);
        mod.ENV.PYTHONHOME = "/";
        mod.ENV.PYTHONPATH = "/lib/python313.zip";
      },
    );
    const onPrint = wrapWasmCallback(
      "python3-worker",
      "print",
      (text: string) => {
        if (moduleReady) {
          backend.writeStdout(`${text}\n`);
        } else {
          pendingStdout.push(`${text}\n`);
        }
      },
    );
    const onPrintErr = wrapWasmCallback(
      "python3-worker",
      "printErr",
      (text: string) => {
        // Filter out harmless Emscripten/LLVM warnings
        if (
          typeof text === "string" &&
          (text.includes("Could not find platform") ||
            text.includes("LLVM Profile Error"))
        ) {
          return;
        }
        if (moduleReady) {
          backend.writeStderr(`${text}\n`);
        } else {
          pendingStderr.push(`${text}\n`);
        }
      },
    );

    Module = await createPythonModule({
      noInitialRun: true,
      preRun: [onPreRun],
      print: onPrint,
      printErr: onPrintErr,
    });
  } catch (e) {
    const message = sanitizeHostErrorMessage((e as Error).message);
    return {
      success: false,
      error: `Failed to load CPython: ${message}`,
    };
  }

  // Activate defense-in-depth after WASM loads (first call only).
  // Subsequent calls reuse the cached compiled module, so webassembly
  // exclusion in defense config handles that.
  activateDefense(input.protocolToken);

  // Module is ready - enable direct backend output and flush any buffered output
  moduleReady = true;
  for (const text of pendingStdout) backend.writeStdout(text);
  for (const text of pendingStderr) backend.writeStderr(text);

  // Stdlib zip is written to MEMFS in the preRun callback above

  // Mount HOSTFS for just-bash filesystem access
  const HOSTFS = createHOSTFS(backend, Module.FS, Module.PATH);
  try {
    Module.FS.mkdir("/host");
    Module.FS.mount(HOSTFS, { root: "/" }, "/host");
  } catch (e) {
    const message = sanitizeHostErrorMessage((e as Error).message);
    return {
      success: false,
      error: `Failed to mount HOSTFS: ${message}`,
    };
  }

  // Mount HTTPFS for HTTP bridge (Python writes request, FS triggers HTTP, Python reads response)
  const HTTPFS = createHTTPFS(backend, Module.FS);
  try {
    Module.FS.mkdir("/_jb_http");
    Module.FS.mount(HTTPFS, { root: "/" }, "/_jb_http");
  } catch (e) {
    const message = sanitizeHostErrorMessage((e as Error).message);
    return {
      success: false,
      error: `Failed to mount HTTPFS: ${message}`,
    };
  }

  // Create the setup + user code as a single Python script
  const setupCode = generateSetupCode(input);
  const httpBridgeCode = generateHttpBridgeCode();
  const wrappedCode = `
import sys
_jb_exit_code = 0
try:
${setupCode
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
${httpBridgeCode
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
${input.pythonCode
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
except SystemExit as e:
    _jb_exit_code = e.code if isinstance(e.code, int) else (1 if e.code else 0)
except Exception as e:
    import traceback
    traceback.print_exc()
    _jb_exit_code = 1
sys.exit(_jb_exit_code)
`;

  // Write the script to a temp file in MEMFS and execute via callMain
  try {
    Module.FS.mkdir("/tmp");
  } catch (_e) {
    // Already exists
  }

  const encoder = new TextEncoder();
  const scriptPath = "/tmp/_jb_script.py";
  const scriptData = encoder.encode(wrappedCode);

  // Write script to Emscripten FS (MEMFS)
  Module.FS.writeFile(scriptPath, scriptData);

  // Execute CPython with the script
  try {
    const ret = Module.callMain([scriptPath]);
    // callMain returns the exit code, or throws ExitStatus with EXIT_RUNTIME
    const exitCode =
      (typeof ret === "number" ? ret : 0) || (process.exitCode as number) || 0;
    backend.exit(exitCode);
    return { success: true };
  } catch (e) {
    const error = e as Error & { status?: number };
    // Emscripten throws ExitStatus with a status code when EXIT_RUNTIME is set
    const exitCode = error.status ?? (process.exitCode as number) ?? 1;
    backend.exit(exitCode);
    return { success: true };
  }
}

// Defense-in-depth instance
let defense: WorkerDefenseInDepth | null = null;

/**
 * Activate defense-in-depth.
 * Called AFTER CPython WASM loads (WASM compilation needs unrestricted JS).
 * CPython Emscripten has no JS bridge, so fewer exclusions needed than Pyodide.
 */
function activateDefense(protocolToken: string): void {
  if (defense) return;

  // Degrade performance to ms precision BEFORE defense activates.
  // Emscripten's _emscripten_get_now() needs a working timer, but
  // sub-ms precision enables timing side-channel attacks. Replacing
  // with Date.now() gives Emscripten what it needs at safe resolution.
  const _DateNow = Date.now;
  const degraded = { now: () => _DateNow(), timeOrigin: _DateNow() };
  Object.defineProperty(globalThis, "performance", {
    value: degraded,
    writable: true,
    configurable: true,
  });

  const onViolation = wrapWasmCallback(
    "python3-worker",
    "onViolation",
    (v: unknown) => {
      postWorkerMessage(protocolToken, {
        type: "security-violation",
        violation: v,
      });
    },
  );

  defense = new WorkerDefenseInDepth({
    excludeViolationTypes: [
      // SharedArrayBuffer/Atomics: Used by sync-fs-backend.ts for synchronous
      // filesystem communication between the WASM thread and the main thread.
      "shared_array_buffer",
      "atomics",
      // performance: Excluded because we replaced it above with a ms-precision
      // stub. Defense doesn't need to block it — it's already degraded.
      "performance_timing",
    ],
    onViolation,
  });
  // Module._load protection is installed at file scope (top of file),
  // before python.cjs loads, so it's already active here.
}

// Catch unhandled errors in the worker
process.on("uncaughtException", (e) => {
  if (!activeProtocolToken) {
    return;
  }
  const message = sanitizeHostErrorMessage((e as Error).message);
  postWorkerMessage(activeProtocolToken, {
    success: false,
    error: `Worker uncaught exception: ${message}`,
  });
});

let activeProtocolToken: string | null = null;

// Handle execution from parent.
// Each worker runs once with workerData (EXIT_RUNTIME means CPython
// can only callMain once). Stdlib zip is cached at module scope.
if (parentPort) {
  if (workerData) {
    const input = workerData as WorkerInput;
    activeProtocolToken = input.protocolToken;
    runPython(input)
      .then((result) => {
        result.defenseStats = defense?.getStats();
        postWorkerMessage(input.protocolToken, result);
      })
      .catch((e) => {
        const message = sanitizeUnknownError(e);
        postWorkerMessage(input.protocolToken, {
          success: false,
          error: message,
          defenseStats: defense?.getStats(),
        });
      });
  }
}

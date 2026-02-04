/**
 * Worker thread for Python execution via Pyodide.
 * Keeps Pyodide loaded and handles multiple execution requests.
 */

import { parentPort, workerData } from "node:worker_threads";
import { loadPyodide, type PyodideInterface } from "pyodide";
import { SyncFsBackend } from "./sync-fs-backend.js";

export interface WorkerInput {
  sharedBuffer: SharedArrayBuffer;
  pythonCode: string;
  cwd: string;
  env: Record<string, string>;
  args: string[];
  scriptPath?: string;
}

export interface WorkerOutput {
  success: boolean;
  error?: string;
}

let pyodideInstance: PyodideInterface | null = null;
let pyodideLoading: Promise<PyodideInterface> | null = null;

async function getPyodide(): Promise<PyodideInterface> {
  if (pyodideInstance) {
    return pyodideInstance;
  }
  if (pyodideLoading) {
    return pyodideLoading;
  }
  pyodideLoading = loadPyodide();
  pyodideInstance = await pyodideLoading;
  return pyodideInstance;
}

/**
 * Create a HOSTFS backend for Pyodide that bridges to just-bash's filesystem.
 * This follows the Emscripten NODEFS pattern but uses SyncFsBackend.
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
  backend: SyncFsBackend,
  FS: EmscriptenFS,
  PATH: EmscriptenPATH,
) {
  // @banned-pattern-ignore: only accessed via dot notation with literal keys
  const ERRNO_CODES: Record<string, number> = {
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
  };

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

async function runPython(input: WorkerInput): Promise<WorkerOutput> {
  const backend = new SyncFsBackend(input.sharedBuffer);

  let pyodide: PyodideInterface;
  try {
    pyodide = await getPyodide();
  } catch (e) {
    return {
      success: false,
      error: `Failed to load Pyodide: ${(e as Error).message}`,
    };
  }

  // Reset stdout/stderr to discard any pending output from previous runs
  // (important when worker is reused and previous execution was interrupted)
  pyodide.setStdout({ batched: () => {} });
  pyodide.setStderr({ batched: () => {} });

  // Flush any pending Python output from previous runs
  try {
    pyodide.runPython(`
import sys
if hasattr(sys.stdout, 'flush'):
    sys.stdout.flush()
if hasattr(sys.stderr, 'flush'):
    sys.stderr.flush()
`);
  } catch (_e) {
    // Ignore - sys might not be set up yet
  }

  // Set up stdout/stderr capture for this execution
  pyodide.setStdout({
    batched: (text: string) => {
      backend.writeStdout(`${text}\n`);
    },
  });

  pyodide.setStderr({
    batched: (text: string) => {
      backend.writeStderr(`${text}\n`);
    },
  });

  // Get Emscripten FS and PATH modules (internal Pyodide properties, not exposed in types)
  const FS = (pyodide as unknown as { FS: EmscriptenFS }).FS;
  const PATH = (pyodide as unknown as { PATH: EmscriptenPATH }).PATH;

  // Create and mount HOSTFS
  const HOSTFS = createHOSTFS(backend, FS, PATH);

  try {
    // Change to root directory before unmounting to avoid issues
    // with cwd being inside the mount point
    try {
      pyodide.runPython(`import os; os.chdir('/')`);
    } catch (_e) {
      // Ignore
    }

    try {
      FS.mkdir("/host");
    } catch (_e) {
      // Already exists
    }

    try {
      FS.unmount("/host");
    } catch (_e) {
      // Not mounted
    }

    FS.mount(HOSTFS, { root: "/" }, "/host");
  } catch (e) {
    return {
      success: false,
      error: `Failed to mount HOSTFS: ${(e as Error).message}`,
    };
  }

  // Register jb_http JavaScript module for Python HTTP requests
  // This bridges Python HTTP calls to the main thread's secureFetch
  // First, clear any cached import from previous runs (important for worker reuse)
  try {
    pyodide.runPython(`
import sys
if '_jb_http_bridge' in sys.modules:
    del sys.modules['_jb_http_bridge']
if 'jb_http' in sys.modules:
    del sys.modules['jb_http']
`);
  } catch (_e) {
    // sys might not be imported yet, ignore
  }

  pyodide.registerJsModule("_jb_http_bridge", {
    request: (
      url: string,
      method: string,
      headersJson: string | undefined,
      body: string | undefined,
    ) => {
      try {
        // Parse headers from JSON (serialized in Python to avoid PyProxy issues)
        const headers = headersJson ? JSON.parse(headersJson) : undefined;
        const result = backend.httpRequest(url, {
          method: method || "GET",
          headers,
          body: body || undefined,
        });
        return JSON.stringify(result);
      } catch (e) {
        return JSON.stringify({ error: (e as Error).message });
      }
    },
  });

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

  try {
    await pyodide.runPythonAsync(`
import os
import sys
import builtins
import json

${envSetup}

sys.argv = [${argvList}]

# Create jb_http module for HTTP requests
class _JbHttpResponse:
    """HTTP response object similar to requests.Response"""
    def __init__(self, data):
        self.status_code = data.get('status', 0)
        self.reason = data.get('statusText', '')
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
    """HTTP client that bridges to just-bash's secureFetch"""
    def request(self, method, url, headers=None, data=None, json_data=None):
        # Import fresh each time to ensure we use the current bridge
        # (important when worker is reused with different SharedArrayBuffer)
        import _jb_http_bridge
        if json_data is not None:
            data = json.dumps(json_data)
            headers = headers or {}
            headers['Content-Type'] = 'application/json'
        # Serialize headers to JSON to avoid PyProxy issues when passing to JS
        headers_json = json.dumps(headers) if headers else None
        result_json = _jb_http_bridge.request(url, method, headers_json, data)
        result = json.loads(result_json)
        # Check for errors from the bridge (network not configured, URL not allowed, etc.)
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

# Register jb_http as an importable module
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

# ============================================================
# SANDBOX SECURITY SETUP
# ============================================================
# Only apply sandbox restrictions once per Pyodide instance
if not hasattr(builtins, '_jb_sandbox_initialized'):
    builtins._jb_sandbox_initialized = True

    # ------------------------------------------------------------
    # 1. Block dangerous module imports (js, pyodide, pyodide_js, pyodide.ffi)
    # These allow sandbox escape via JavaScript execution
    # ------------------------------------------------------------
    _BLOCKED_MODULES = frozenset({'js', 'pyodide', 'pyodide_js', 'pyodide.ffi'})
    _BLOCKED_PREFIXES = ('js.', 'pyodide.', 'pyodide_js.')

    # Remove pre-loaded dangerous modules from sys.modules
    for _blocked_mod in list(sys.modules.keys()):
        if _blocked_mod in _BLOCKED_MODULES or any(_blocked_mod.startswith(p) for p in _BLOCKED_PREFIXES):
            del sys.modules[_blocked_mod]

    # Create a secure callable wrapper that hides introspection attributes
    # This prevents access to __closure__, __kwdefaults__, __globals__, etc.
    def _make_secure_import(orig_import, blocked, prefixes):
        """Create import function wrapped to block introspection."""
        def _inner(name, globals=None, locals=None, fromlist=(), level=0):
            if name in blocked or any(name.startswith(p) for p in prefixes):
                raise ImportError(f"Module '{name}' is blocked in this sandbox")
            return orig_import(name, globals, locals, fromlist, level)

        class _SecureImport:
            """Wrapper that hides function internals from introspection."""
            __slots__ = ()
            def __call__(self, name, globals=None, locals=None, fromlist=(), level=0):
                return _inner(name, globals, locals, fromlist, level)
            def __getattribute__(self, name):
                if name in ('__call__', '__class__'):
                    return object.__getattribute__(self, name)
                raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")
            def __repr__(self):
                return '<built-in function __import__>'
        return _SecureImport()

    builtins.__import__ = _make_secure_import(builtins.__import__, _BLOCKED_MODULES, _BLOCKED_PREFIXES)
    del _BLOCKED_MODULES, _BLOCKED_PREFIXES, _make_secure_import

    # ------------------------------------------------------------
    # 2. Path redirection helper
    # ------------------------------------------------------------
    def _should_redirect(path):
        """Check if a path should be redirected to /host."""
        return (isinstance(path, str) and
                path.startswith('/') and
                not path.startswith('/lib') and
                not path.startswith('/proc') and
                not path.startswith('/host'))

    # ------------------------------------------------------------
    # 3. Secure wrapper factory for file operations
    # ------------------------------------------------------------
    # This creates callable wrappers that hide __closure__, __globals__, etc.
    def _make_secure_wrapper(func, name):
        """Wrap a function to block introspection attributes."""
        class _SecureWrapper:
            __slots__ = ()
            def __call__(self, *args, **kwargs):
                return func(*args, **kwargs)
            def __getattribute__(self, attr):
                if attr in ('__call__', '__class__'):
                    return object.__getattribute__(self, attr)
                raise AttributeError(f"'{type(self).__name__}' object has no attribute '{attr}'")
            def __repr__(self):
                return f'<built-in function {name}>'
        return _SecureWrapper()

    # ------------------------------------------------------------
    # 4. Redirect file operations to /host (with secure wrappers)
    # ------------------------------------------------------------
    # builtins.open
    _orig_open = builtins.open
    def _redir_open(path, mode='r', *args, **kwargs):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_open(path, mode, *args, **kwargs)
    builtins.open = _make_secure_wrapper(_redir_open, 'open')

    # os.listdir
    _orig_listdir = os.listdir
    def _redir_listdir(path='.'):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_listdir(path)
    os.listdir = _make_secure_wrapper(_redir_listdir, 'listdir')

    # os.path.exists
    _orig_exists = os.path.exists
    def _redir_exists(path):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_exists(path)
    os.path.exists = _make_secure_wrapper(_redir_exists, 'exists')

    # os.path.isfile
    _orig_isfile = os.path.isfile
    def _redir_isfile(path):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_isfile(path)
    os.path.isfile = _make_secure_wrapper(_redir_isfile, 'isfile')

    # os.path.isdir
    _orig_isdir = os.path.isdir
    def _redir_isdir(path):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_isdir(path)
    os.path.isdir = _make_secure_wrapper(_redir_isdir, 'isdir')

    # os.stat
    _orig_stat = os.stat
    def _redir_stat(path, *args, **kwargs):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_stat(path, *args, **kwargs)
    os.stat = _make_secure_wrapper(_redir_stat, 'stat')

    # os.mkdir
    _orig_mkdir = os.mkdir
    def _redir_mkdir(path, *args, **kwargs):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_mkdir(path, *args, **kwargs)
    os.mkdir = _make_secure_wrapper(_redir_mkdir, 'mkdir')

    # os.makedirs
    _orig_makedirs = os.makedirs
    def _redir_makedirs(path, *args, **kwargs):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_makedirs(path, *args, **kwargs)
    os.makedirs = _make_secure_wrapper(_redir_makedirs, 'makedirs')

    # os.remove
    _orig_remove = os.remove
    def _redir_remove(path, *args, **kwargs):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_remove(path, *args, **kwargs)
    os.remove = _make_secure_wrapper(_redir_remove, 'remove')

    # os.rmdir
    _orig_rmdir = os.rmdir
    def _redir_rmdir(path, *args, **kwargs):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_rmdir(path, *args, **kwargs)
    os.rmdir = _make_secure_wrapper(_redir_rmdir, 'rmdir')

    # os.getcwd - strip /host prefix
    _orig_getcwd = os.getcwd
    def _redir_getcwd():
        cwd = _orig_getcwd()
        if cwd.startswith('/host'):
            return cwd[5:]  # Strip '/host' prefix
        return cwd
    os.getcwd = _make_secure_wrapper(_redir_getcwd, 'getcwd')

    # os.chdir
    _orig_chdir = os.chdir
    def _redir_chdir(path):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_chdir(path)
    os.chdir = _make_secure_wrapper(_redir_chdir, 'chdir')

    # ------------------------------------------------------------
    # 5. Additional file operations (glob, walk, scandir, io.open)
    # ------------------------------------------------------------
    import glob as _glob_module

    _orig_glob = _glob_module.glob
    def _redir_glob(pathname, *args, **kwargs):
        if _should_redirect(pathname):
            pathname = '/host' + pathname
        return _orig_glob(pathname, *args, **kwargs)
    _glob_module.glob = _make_secure_wrapper(_redir_glob, 'glob')

    _orig_iglob = _glob_module.iglob
    def _redir_iglob(pathname, *args, **kwargs):
        if _should_redirect(pathname):
            pathname = '/host' + pathname
        return _orig_iglob(pathname, *args, **kwargs)
    _glob_module.iglob = _make_secure_wrapper(_redir_iglob, 'iglob')

    # os.walk (generator - needs special handling)
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
    os.walk = _make_secure_wrapper(_redir_walk, 'walk')

    # os.scandir
    _orig_scandir = os.scandir
    def _redir_scandir(path='.'):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_scandir(path)
    os.scandir = _make_secure_wrapper(_redir_scandir, 'scandir')

    # io.open (same secure wrapper as builtins.open)
    import io as _io_module
    _io_module.open = builtins.open

    # ------------------------------------------------------------
    # 6. shutil file operations
    # ------------------------------------------------------------
    import shutil as _shutil_module

    # shutil.copy(src, dst)
    _orig_shutil_copy = _shutil_module.copy
    def _redir_shutil_copy(src, dst, *args, **kwargs):
        if _should_redirect(src):
            src = '/host' + src
        if _should_redirect(dst):
            dst = '/host' + dst
        return _orig_shutil_copy(src, dst, *args, **kwargs)
    _shutil_module.copy = _make_secure_wrapper(_redir_shutil_copy, 'copy')

    # shutil.copy2(src, dst)
    _orig_shutil_copy2 = _shutil_module.copy2
    def _redir_shutil_copy2(src, dst, *args, **kwargs):
        if _should_redirect(src):
            src = '/host' + src
        if _should_redirect(dst):
            dst = '/host' + dst
        return _orig_shutil_copy2(src, dst, *args, **kwargs)
    _shutil_module.copy2 = _make_secure_wrapper(_redir_shutil_copy2, 'copy2')

    # shutil.copyfile(src, dst)
    _orig_shutil_copyfile = _shutil_module.copyfile
    def _redir_shutil_copyfile(src, dst, *args, **kwargs):
        if _should_redirect(src):
            src = '/host' + src
        if _should_redirect(dst):
            dst = '/host' + dst
        return _orig_shutil_copyfile(src, dst, *args, **kwargs)
    _shutil_module.copyfile = _make_secure_wrapper(_redir_shutil_copyfile, 'copyfile')

    # shutil.copytree(src, dst)
    _orig_shutil_copytree = _shutil_module.copytree
    def _redir_shutil_copytree(src, dst, *args, **kwargs):
        if _should_redirect(src):
            src = '/host' + src
        if _should_redirect(dst):
            dst = '/host' + dst
        return _orig_shutil_copytree(src, dst, *args, **kwargs)
    _shutil_module.copytree = _make_secure_wrapper(_redir_shutil_copytree, 'copytree')

    # shutil.move(src, dst)
    _orig_shutil_move = _shutil_module.move
    def _redir_shutil_move(src, dst, *args, **kwargs):
        if _should_redirect(src):
            src = '/host' + src
        if _should_redirect(dst):
            dst = '/host' + dst
        return _orig_shutil_move(src, dst, *args, **kwargs)
    _shutil_module.move = _make_secure_wrapper(_redir_shutil_move, 'move')

    # shutil.rmtree(path)
    _orig_shutil_rmtree = _shutil_module.rmtree
    def _redir_shutil_rmtree(path, *args, **kwargs):
        if _should_redirect(path):
            path = '/host' + path
        return _orig_shutil_rmtree(path, *args, **kwargs)
    _shutil_module.rmtree = _make_secure_wrapper(_redir_shutil_rmtree, 'rmtree')

    # ------------------------------------------------------------
    # 7. pathlib.Path - redirect path resolution
    # ------------------------------------------------------------
    from pathlib import Path, PurePosixPath

    def _redirect_path(p):
        """Convert a Path to redirect /absolute paths to /host."""
        s = str(p)
        if _should_redirect(s):
            return Path('/host' + s)
        return p

    # Helper to create method wrappers for Path
    def _wrap_path_method(orig_method, name):
        def wrapper(self, *args, **kwargs):
            redirected = _redirect_path(self)
            return getattr(redirected, '_orig_' + name)(*args, **kwargs)
        return wrapper

    # Store original methods with _orig_ prefix, then replace with redirecting versions
    # Path.stat()
    Path._orig_stat = Path.stat
    def _path_stat(self, *args, **kwargs):
        return _redirect_path(self)._orig_stat(*args, **kwargs)
    Path.stat = _path_stat

    # Path.exists()
    Path._orig_exists = Path.exists
    def _path_exists(self):
        return _redirect_path(self)._orig_exists()
    Path.exists = _path_exists

    # Path.is_file()
    Path._orig_is_file = Path.is_file
    def _path_is_file(self):
        return _redirect_path(self)._orig_is_file()
    Path.is_file = _path_is_file

    # Path.is_dir()
    Path._orig_is_dir = Path.is_dir
    def _path_is_dir(self):
        return _redirect_path(self)._orig_is_dir()
    Path.is_dir = _path_is_dir

    # Path.open()
    Path._orig_open = Path.open
    def _path_open(self, *args, **kwargs):
        return _redirect_path(self)._orig_open(*args, **kwargs)
    Path.open = _path_open

    # Path.read_text()
    Path._orig_read_text = Path.read_text
    def _path_read_text(self, *args, **kwargs):
        return _redirect_path(self)._orig_read_text(*args, **kwargs)
    Path.read_text = _path_read_text

    # Path.read_bytes()
    Path._orig_read_bytes = Path.read_bytes
    def _path_read_bytes(self):
        return _redirect_path(self)._orig_read_bytes()
    Path.read_bytes = _path_read_bytes

    # Path.write_text()
    Path._orig_write_text = Path.write_text
    def _path_write_text(self, *args, **kwargs):
        return _redirect_path(self)._orig_write_text(*args, **kwargs)
    Path.write_text = _path_write_text

    # Path.write_bytes()
    Path._orig_write_bytes = Path.write_bytes
    def _path_write_bytes(self, data):
        return _redirect_path(self)._orig_write_bytes(data)
    Path.write_bytes = _path_write_bytes

    # Path.mkdir()
    Path._orig_mkdir = Path.mkdir
    def _path_mkdir(self, *args, **kwargs):
        return _redirect_path(self)._orig_mkdir(*args, **kwargs)
    Path.mkdir = _path_mkdir

    # Path.rmdir()
    Path._orig_rmdir = Path.rmdir
    def _path_rmdir(self):
        return _redirect_path(self)._orig_rmdir()
    Path.rmdir = _path_rmdir

    # Path.unlink()
    Path._orig_unlink = Path.unlink
    def _path_unlink(self, *args, **kwargs):
        return _redirect_path(self)._orig_unlink(*args, **kwargs)
    Path.unlink = _path_unlink

    # Path.iterdir()
    Path._orig_iterdir = Path.iterdir
    def _path_iterdir(self):
        redirected = _redirect_path(self)
        for p in redirected._orig_iterdir():
            # Strip /host prefix from results
            s = str(p)
            if s.startswith('/host'):
                yield Path(s[5:])
            else:
                yield p
    Path.iterdir = _path_iterdir

    # Path.glob()
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

    # Path.rglob()
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
`);
  } catch (e) {
    return {
      success: false,
      error: `Failed to set up environment: ${(e as Error).message}`,
    };
  }

  // Run the Python code wrapped in try/except to catch SystemExit
  // This prevents Pyodide from hanging on sys.exit()
  try {
    // Wrap user code to handle sys.exit() gracefully
    const wrappedCode = `
import sys
_jb_exit_code = 0
try:
${input.pythonCode
  .split("\n")
  .map((line) => `    ${line}`)
  .join("\n")}
except SystemExit as e:
    _jb_exit_code = e.code if isinstance(e.code, int) else (1 if e.code else 0)
`;
    await pyodide.runPythonAsync(wrappedCode);
    // Get the exit code from Python
    const exitCode = pyodide.globals.get("_jb_exit_code") as number;
    backend.exit(exitCode);
    return { success: true };
  } catch (e) {
    const error = e as Error;
    backend.writeStderr(`${error.message}\n`);
    backend.exit(1);
    return { success: true };
  }
}

// Handle messages from parent
if (parentPort) {
  if (workerData) {
    runPython(workerData as WorkerInput).then((result) => {
      parentPort?.postMessage(result);
    });
  }

  parentPort.on("message", async (input: WorkerInput) => {
    try {
      const result = await runPython(input);
      parentPort?.postMessage(result);
    } catch (e) {
      parentPort?.postMessage({ success: false, error: (e as Error).message });
    }
  });
}

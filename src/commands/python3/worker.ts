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

# Redirect root paths to /host for file operations
# Only patch once - check if already patched
if not hasattr(builtins, '_jb_original_open'):
    builtins._jb_original_open = builtins.open

    def _redirected_open(path, mode='r', *args, **kwargs):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return builtins._jb_original_open(path, mode, *args, **kwargs)
    builtins.open = _redirected_open

    os._jb_original_listdir = os.listdir
    def _redirected_listdir(path='.'):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return os._jb_original_listdir(path)
    os.listdir = _redirected_listdir

    os.path._jb_original_exists = os.path.exists
    def _redirected_exists(path):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return os.path._jb_original_exists(path)
    os.path.exists = _redirected_exists

    os.path._jb_original_isfile = os.path.isfile
    def _redirected_isfile(path):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return os.path._jb_original_isfile(path)
    os.path.isfile = _redirected_isfile

    os.path._jb_original_isdir = os.path.isdir
    def _redirected_isdir(path):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return os.path._jb_original_isdir(path)
    os.path.isdir = _redirected_isdir

    os._jb_original_stat = os.stat
    def _redirected_stat(path, *args, **kwargs):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return os._jb_original_stat(path, *args, **kwargs)
    os.stat = _redirected_stat

    os._jb_original_mkdir = os.mkdir
    def _redirected_mkdir(path, *args, **kwargs):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return os._jb_original_mkdir(path, *args, **kwargs)
    os.mkdir = _redirected_mkdir

    os._jb_original_makedirs = os.makedirs
    def _redirected_makedirs(path, *args, **kwargs):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return os._jb_original_makedirs(path, *args, **kwargs)
    os.makedirs = _redirected_makedirs

    os._jb_original_remove = os.remove
    def _redirected_remove(path, *args, **kwargs):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return os._jb_original_remove(path, *args, **kwargs)
    os.remove = _redirected_remove

    os._jb_original_rmdir = os.rmdir
    def _redirected_rmdir(path, *args, **kwargs):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return os._jb_original_rmdir(path, *args, **kwargs)
    os.rmdir = _redirected_rmdir

    # Patch os.getcwd to strip /host prefix
    os._jb_original_getcwd = os.getcwd
    def _redirected_getcwd():
        cwd = os._jb_original_getcwd()
        if cwd.startswith('/host'):
            return cwd[5:]  # Strip '/host' prefix
        return cwd
    os.getcwd = _redirected_getcwd

    # Patch os.chdir to add /host prefix
    os._jb_original_chdir = os.chdir
    def _redirected_chdir(path):
        if isinstance(path, str) and path.startswith('/') and not path.startswith('/lib') and not path.startswith('/proc') and not path.startswith('/host'):
            path = '/host' + path
        return os._jb_original_chdir(path)
    os.chdir = _redirected_chdir

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

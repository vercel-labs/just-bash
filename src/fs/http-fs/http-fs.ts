import type {
  BufferEncoding,
  CpOptions,
  DirentEntry,
  FileContent,
  FsStat,
  IFileSystem,
  MkdirOptions,
  ReadFileOptions,
  RmOptions,
  WriteFileOptions,
} from "../interface.js";

export interface HttpFsFile {
  size?: number;
}

export interface HttpFsOptions {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  headers?: Record<string, string>;
  maxFileSize?: number;
}

interface FileNode {
  type: "file";
  size: number;
  cached: Uint8Array | null;
}

interface DirNode {
  type: "directory";
  children: Set<string>;
}

type FsNode = FileNode | DirNode;

/**
 * A read-only filesystem backed by HTTP.
 *
 * Files are declared up front (the "manifest") and fetched lazily on first
 * read. Once fetched, content is cached in memory for the lifetime of the
 * instance. Directory structure is derived from the file paths -- no
 * directory-listing endpoint is required on the server.
 *
 * @example
 * ```ts
 * const fs = new HttpFs("https://cdn.example.com/repo", [
 *   "README.md",
 *   "src/index.ts",
 *   "src/utils.ts",
 * ]);
 * await fs.readFile("/README.md"); // fetches once, then cached
 * await fs.readdir("/src");        // ["index.ts", "utils.ts"]
 * ```
 */
export class HttpFs implements IFileSystem {
  private readonly baseUrl: string;
  private readonly nodes: Map<string, FsNode>;
  private readonly fetchFn: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;
  private readonly reqHeaders: Record<string, string>;
  private readonly maxFileSize: number;
  private readonly epoch: Date;

  constructor(
    baseUrl: string,
    files: string[] | Record<string, HttpFsFile>,
    options?: HttpFsOptions,
  ) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    this.fetchFn = options?.fetch ?? globalThis.fetch.bind(globalThis);
    this.reqHeaders = Object.create(null) as Record<string, string>;
    if (options?.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        this.reqHeaders[k] = v;
      }
    }
    this.maxFileSize = options?.maxFileSize ?? 10_485_760;
    this.epoch = new Date();
    this.nodes = new Map();
    this.nodes.set("/", { type: "directory", children: new Set() });
    this.buildTree(files);
  }

  // ---------------------------------------------------------------------------
  // Tree construction
  // ---------------------------------------------------------------------------

  private buildTree(files: string[] | Record<string, HttpFsFile>): void {
    const entries: Array<[string, HttpFsFile]> = Array.isArray(files)
      ? files.map((f) => [f, {}])
      : Object.entries(files);

    for (const [raw, meta] of entries) {
      const isDir = raw.endsWith("/");
      const path = normalizePath(raw);
      if (path === "/") continue;

      const segments = path.split("/").filter(Boolean);

      // Ensure every ancestor directory exists
      let current = "";
      for (let i = 0; i < segments.length; i++) {
        const parent = current || "/";
        current = `${current}/${segments[i]}`;
        const isLast = i === segments.length - 1;

        if (isLast && !isDir) {
          // Leaf file
          if (!this.nodes.has(current)) {
            this.nodes.set(current, {
              type: "file",
              size: meta.size ?? 0,
              cached: null,
            });
          }
        } else if (!this.nodes.has(current)) {
          this.nodes.set(current, { type: "directory", children: new Set() });
        }

        // Register as child of parent
        const parentNode = this.nodes.get(parent);
        if (parentNode?.type === "directory") {
          parentNode.children.add(segments[i]);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private resolve(path: string): FsNode | undefined {
    return this.nodes.get(normalizePath(path));
  }

  private resolveFile(path: string, op: string): FileNode {
    const node = this.resolve(path);
    const p = normalizePath(path);
    if (!node) throw fsError("ENOENT", op, p);
    if (node.type === "directory") throw fsError("EISDIR", op, p);
    return node;
  }

  private resolveDir(path: string, op: string): DirNode {
    const node = this.resolve(path);
    const p = normalizePath(path);
    if (!node) throw fsError("ENOENT", op, p);
    if (node.type === "file") throw fsError("ENOTDIR", op, p);
    return node;
  }

  private resolveAny(path: string, op: string): FsNode {
    const node = this.resolve(path);
    if (!node) throw fsError("ENOENT", op, normalizePath(path));
    return node;
  }

  private async fetchContent(path: string): Promise<Uint8Array> {
    const node = this.resolveFile(path, "open");
    if (node.cached) return node.cached;

    const relative = normalizePath(path).slice(1); // strip leading /
    const url = `${this.baseUrl}${relative}`;

    const resp = await this.fetchFn(url, { headers: { ...this.reqHeaders } });

    if (!resp.ok) {
      if (resp.status === 404) throw fsError("ENOENT", "open", path);
      throw fsError("EIO", "open", path);
    }

    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.length > this.maxFileSize) {
      throw fsError("EFBIG", "open", path);
    }

    node.cached = buf;
    node.size = buf.length;
    return buf;
  }

  // ---------------------------------------------------------------------------
  // Public: reads
  // ---------------------------------------------------------------------------

  async readFile(
    path: string,
    _options?: ReadFileOptions | BufferEncoding,
  ): Promise<string> {
    const buf = await this.fetchContent(path);
    return new TextDecoder().decode(buf);
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return this.fetchContent(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.resolve(path) !== undefined;
  }

  async stat(path: string): Promise<FsStat> {
    const node = this.resolveAny(path, "stat");
    return nodeToStat(node, this.epoch);
  }

  async lstat(path: string): Promise<FsStat> {
    return this.stat(path);
  }

  async readdir(path: string): Promise<string[]> {
    const dir = this.resolveDir(path, "scandir");
    return Array.from(dir.children).sort();
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const dir = this.resolveDir(path, "scandir");
    const p = normalizePath(path);
    const out: DirentEntry[] = [];

    for (const name of dir.children) {
      const childPath = p === "/" ? `/${name}` : `${p}/${name}`;
      const child = this.nodes.get(childPath);
      out.push({
        name,
        isFile: child?.type === "file",
        isDirectory: child?.type === "directory",
        isSymbolicLink: false,
      });
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async realpath(path: string): Promise<string> {
    this.resolveAny(path, "realpath");
    return normalizePath(path);
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith("/")) return normalizePath(path);
    const combined = base === "/" ? `/${path}` : `${base}/${path}`;
    return normalizePath(combined);
  }

  getAllPaths(): string[] {
    return Array.from(this.nodes.keys()).sort();
  }

  /**
   * Eagerly fetch all files in the manifest. Useful when you know you'll
   * need everything and want to parallelise the network I/O up front.
   */
  async prefetch(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [path, node] of this.nodes) {
      if (node.type === "file" && !node.cached) {
        promises.push(this.fetchContent(path).then(() => {}));
      }
    }
    await Promise.all(promises);
  }

  // ---------------------------------------------------------------------------
  // Public: writes (all throw EROFS)
  // ---------------------------------------------------------------------------

  async writeFile(
    _path: string,
    _content: FileContent,
    _options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    throw fsError("EROFS", "write", _path);
  }

  async appendFile(
    _path: string,
    _content: FileContent,
    _options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    throw fsError("EROFS", "append", _path);
  }

  async mkdir(_path: string, _options?: MkdirOptions): Promise<void> {
    throw fsError("EROFS", "mkdir", _path);
  }

  async rm(_path: string, _options?: RmOptions): Promise<void> {
    throw fsError("EROFS", "rm", _path);
  }

  async cp(_src: string, _dest: string, _options?: CpOptions): Promise<void> {
    throw fsError("EROFS", "cp", _dest);
  }

  async mv(_src: string, _dest: string): Promise<void> {
    throw fsError("EROFS", "mv", _dest);
  }

  async chmod(_path: string, _mode: number): Promise<void> {
    throw fsError("EROFS", "chmod", _path);
  }

  async symlink(_target: string, _linkPath: string): Promise<void> {
    throw fsError("EROFS", "symlink", _linkPath);
  }

  async link(_existingPath: string, _newPath: string): Promise<void> {
    throw fsError("EROFS", "link", _newPath);
  }

  async readlink(path: string): Promise<string> {
    const node = this.resolveAny(path, "readlink");
    if (node.type !== "file") throw fsError("EINVAL", "readlink", path);
    throw fsError("EINVAL", "readlink", path);
  }

  async utimes(_path: string, _atime: Date, _mtime: Date): Promise<void> {
    throw fsError("EROFS", "utimes", _path);
  }
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  let p = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
  if (!p.startsWith("/")) p = `/${p}`;
  const parts = p.split("/").filter((s) => s && s !== ".");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return `/${resolved.join("/")}` || "/";
}

const ERROR_MESSAGES: Record<string, string> = Object.assign(
  Object.create(null),
  {
    ENOENT: "no such file or directory",
    EISDIR: "illegal operation on a directory",
    ENOTDIR: "not a directory",
    EROFS: "read-only file system",
    EFBIG: "file too large",
    EIO: "input/output error",
    EINVAL: "invalid argument",
    EEXIST: "file already exists",
  },
);

function fsError(code: string, op: string, path: string): Error {
  const msg = ERROR_MESSAGES[code] ?? code;
  return new Error(`${code}: ${msg}, ${op} '${path}'`);
}

function nodeToStat(node: FsNode, mtime: Date): FsStat {
  return {
    isFile: node.type === "file",
    isDirectory: node.type === "directory",
    isSymbolicLink: false,
    mode: node.type === "directory" ? 0o755 : 0o644,
    size: node.type === "file" ? node.size : 0,
    mtime,
  };
}

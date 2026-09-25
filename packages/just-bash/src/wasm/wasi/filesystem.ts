import { bytesFromUint8Array, latin1FromBytes } from "../../encoding.js";
import type { FsStat } from "../../fs/interface.js";
import type { ResolvedCommandContext } from "../../types.js";
import { RPC_BYTES } from "../protocol.js";
import type { WasmLimits } from "../types.js";
import type { FileStat } from "../worker-types.js";
import * as WASI from "./abi.js";
import type { WasiOperation, WasiRequest } from "./requests.js";

const encoder = new TextEncoder();
const ALL_RIGHTS = (1n << 28n) - 1n;
const FALLBACK_DEVICE = String(0xffff_fffe);

export class WasiError extends Error {
  constructor(readonly errno: number) {
    super(`WASI error ${errno}`);
  }
}

export function errnoFrom(error: unknown): number {
  if (error instanceof WasiError) return error.errno;
  const message = error instanceof Error ? error.message : "";
  const codes: Array<[string, number]> = [
    ["ENOENT", WASI.ERRNO_NOENT],
    ["EEXIST", WASI.ERRNO_EXIST],
    ["ENOTDIR", WASI.ERRNO_NOTDIR],
    ["EISDIR", WASI.ERRNO_ISDIR],
    ["ENOTEMPTY", WASI.ERRNO_NOTEMPTY],
    ["ELOOP", WASI.ERRNO_LOOP],
    ["EROFS", WASI.ERRNO_ROFS],
    ["EACCES", WASI.ERRNO_ACCES],
    ["EPERM", WASI.ERRNO_PERM],
    ["ENOSPC", WASI.ERRNO_NOSPC],
    ["EINVAL", WASI.ERRNO_INVAL],
    ["EBUSY", WASI.ERRNO_BUSY],
    ["EXDEV", WASI.ERRNO_XDEV],
  ];
  return (
    codes.find(
      ([code]) => message === code || message.startsWith(`${code}:`),
    )?.[1] ?? WASI.ERRNO_IO
  );
}

interface Descriptor {
  path: string;
  type: number;
  position: number;
  flags: number;
  rights: bigint;
  inheriting: bigint;
}

interface CachedFile {
  bytes: Uint8Array;
  size: number;
  mtimeMs: number;
  identity: string | undefined;
  contentVersion: number | string | undefined;
  lease: { release(): void } | undefined;
}

function cacheIdentity(stat: FsStat): string | undefined {
  if (stat.identity !== undefined) return stat.identity;
  if (stat.dev !== undefined && stat.ino !== undefined)
    return `${stat.dev}:${stat.ino}`;
  return undefined;
}

function fileStat(stat: FsStat): FileStat {
  return {
    type: stat.isSymbolicLink
      ? WASI.FILETYPE_SYMBOLIC_LINK
      : stat.isDirectory
        ? WASI.FILETYPE_DIRECTORY
        : stat.isFile
          ? WASI.FILETYPE_REGULAR_FILE
          : WASI.FILETYPE_UNKNOWN,
    size: stat.size,
    mtime: stat.mtime.getTime(),
    ino: String(stat.ino ?? 0),
    dev: String(stat.dev ?? 0),
  };
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw new WasiError(WASI.ERRNO_INVAL);
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.includes("\0"))
    throw new WasiError(WASI.ERRNO_INVAL);
  if (encoder.encode(value).length > 4096)
    throw new WasiError(WASI.ERRNO_NAMETOOLONG);
  return value;
}

function bigint(value: unknown): bigint {
  if (typeof value !== "string" || !/^-?\d{1,20}$/.test(value))
    throw new WasiError(WASI.ERRNO_INVAL);
  return BigInt(value);
}

/** All guest filesystem authority lives here, on the async host side. */
export class WasiFileSystem {
  private readonly fds = new Map<number, Descriptor>();
  private readonly fileCache = new Map<string, CachedFile>();
  private readonly fallbackInodes = new Map<
    string,
    { ino: string; lease: { release(): void } | undefined }
  >();
  private nextFallbackInode = 1;
  private nextFd = 4;
  private active = true;
  private stdinPosition = 0;
  private outputBytes = 0;
  private readonly stderrDecoder = new TextDecoder();
  private readonly outputLeases: Array<{ release(): void }> = [];
  stdout = "";
  stderr = "";

  constructor(
    private readonly ctx: ResolvedCommandContext,
    private readonly limits: WasmLimits,
  ) {
    for (const [fd, path, type] of [
      [0, "", WASI.FILETYPE_CHARACTER_DEVICE],
      [1, "", WASI.FILETYPE_CHARACTER_DEVICE],
      [2, "", WASI.FILETYPE_CHARACTER_DEVICE],
      [3, "/", WASI.FILETYPE_DIRECTORY],
    ] as const) {
      this.fds.set(fd, {
        path,
        type,
        position: 0,
        flags: 0,
        rights:
          fd === 0
            ? BigInt(WASI.RIGHTS_FD_READ | WASI.RIGHTS_FD_FILESTAT_GET)
            : fd < 3
              ? BigInt(WASI.RIGHTS_FD_WRITE | WASI.RIGHTS_FD_FILESTAT_GET)
              : ALL_RIGHTS,
        inheriting: fd < 3 ? 0n : ALL_RIGHTS,
      });
    }
  }

  close(): void {
    this.active = false;
    this.stderr += this.stderrDecoder.decode();
    for (const lease of this.outputLeases.splice(0)) lease.release();
    this.clearFileCache();
    for (const { lease } of this.fallbackInodes.values()) lease?.release();
    this.fallbackInodes.clear();
    this.fds.clear();
  }

  private fileStat(stat: FsStat): FileStat {
    const result = fileStat(stat);
    if (
      (stat.dev !== undefined && stat.ino !== undefined) ||
      stat.identity === undefined
    )
      return result;
    let cached = this.fallbackInodes.get(stat.identity);
    if (!cached) {
      if (this.fallbackInodes.size >= this.ctx.limits.maxTraversalEntries)
        throw new WasiError(WASI.ERRNO_NOSPC);
      const lease = this.ctx.executionScope?.reserveBytes(
        64 + stat.identity.length * 2,
        "WASI inode metadata",
      );
      cached = { ino: String(this.nextFallbackInode++), lease };
      this.fallbackInodes.set(stat.identity, cached);
    }
    result.dev = FALLBACK_DEVICE;
    result.ino = cached.ino;
    return result;
  }

  private check(): void {
    if (!this.active || this.ctx.signal?.aborted)
      throw new WasiError(WASI.ERRNO_CANCELED);
    this.ctx.executionScope?.throwIfAborted("WASI filesystem");
  }

  private fd(id: number, right = 0): Descriptor {
    const fd = this.fds.get(id);
    if (!fd) throw new WasiError(WASI.ERRNO_BADF);
    if ((fd.rights & BigInt(right)) !== BigInt(right))
      throw new WasiError(WASI.ERRNO_NOTCAPABLE);
    return fd;
  }

  private size(size: number): number {
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > this.limits.maxFileBytes
    )
      throw new WasiError(WASI.ERRNO_FBIG);
    return size;
  }

  private async resolve(
    fd: Descriptor,
    path: string,
    follow: boolean,
    create = false,
  ): Promise<string> {
    if (fd.type !== WASI.FILETYPE_DIRECTORY)
      throw new WasiError(WASI.ERRNO_NOTDIR);
    if (!path) throw new WasiError(WASI.ERRNO_NOENT);
    if (path.startsWith("/")) throw new WasiError(WASI.ERRNO_NOTCAPABLE);
    const root = await this.ctx.fs.realpath(fd.path);
    this.check();
    const contained = (resolved: string) => {
      if (
        resolved !== root &&
        !resolved.startsWith(root === "/" ? "/" : `${root}/`)
      )
        throw new WasiError(WASI.ERRNO_NOTCAPABLE);
    };
    let resolved = root;
    const parts = path.split("/");
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part || part === ".") continue;
      if (part === "..") {
        resolved = this.ctx.fs.resolvePath(resolved, "..");
      } else {
        const next = this.ctx.fs.resolvePath(resolved, part);
        if (index < parts.length - 1) {
          resolved = await this.ctx.fs.realpath(next);
          this.check();
          contained(resolved);
          if (!(await this.ctx.fs.stat(resolved)).isDirectory)
            throw new WasiError(WASI.ERRNO_NOTDIR);
        } else if (follow) {
          try {
            resolved = await this.ctx.fs.realpath(next);
          } catch (error) {
            if (!create || errnoFrom(error) !== WASI.ERRNO_NOENT) throw error;
            // A dangling symlink must not turn into an unchecked write.
            try {
              const entry = await this.ctx.fs.lstat(next);
              if (entry.isSymbolicLink)
                throw new WasiError(WASI.ERRNO_NOTCAPABLE);
            } catch (missing) {
              if (errnoFrom(missing) !== WASI.ERRNO_NOENT) throw missing;
            }
            resolved = next;
          }
        } else resolved = next;
      }
      this.check();
      contained(resolved);
    }
    return resolved;
  }

  private async stat(fd: Descriptor): Promise<FileStat> {
    if (fd.type === WASI.FILETYPE_CHARACTER_DEVICE)
      return { type: fd.type, size: 0, mtime: 0, ino: "0", dev: "0" };
    const result = this.fileStat(await this.ctx.fs.stat(fd.path));
    this.check();
    return result;
  }

  private invalidate(
    path: string,
    recursive = false,
    identity = this.fileCache.get(path)?.identity,
  ): void {
    for (const [cachedPath, cached] of this.fileCache) {
      if (
        cachedPath === path ||
        (recursive && cachedPath.startsWith(`${path}/`)) ||
        (identity !== undefined && cached.identity === identity)
      ) {
        cached.lease?.release();
        this.fileCache.delete(cachedPath);
      }
    }
  }

  private clearFileCache(): void {
    for (const cached of this.fileCache.values()) cached.lease?.release();
    this.fileCache.clear();
  }

  private async fileBytes(path: string): Promise<Uint8Array> {
    const stat = await this.ctx.fs.stat(path);
    this.check();
    if (!stat.isFile) throw new WasiError(WASI.ERRNO_NOTSUP);
    this.size(stat.size);
    const identity = cacheIdentity(stat);
    const cached = this.fileCache.get(path);
    if (
      stat.contentVersion !== undefined &&
      cached?.size === stat.size &&
      cached.mtimeMs === stat.mtime.getTime() &&
      cached.identity === identity &&
      cached.contentVersion === stat.contentVersion
    )
      return cached.bytes;
    // Keep one file snapshot at a time so sequential file reads do not retain
    // every file's bytes against the command's live-byte budget.
    this.clearFileCache();
    const lease = this.ctx.executionScope?.reserveBytes(
      stat.size,
      "WASI file I/O",
    );
    try {
      this.ctx.executionScope?.consumeWork(
        Math.ceil(stat.size / RPC_BYTES),
        "WASI file read",
      );
      const bytes = await this.ctx.fs.readFileBuffer(path);
      this.check();
      this.size(bytes.length);
      if (bytes.length > stat.size) throw new WasiError(WASI.ERRNO_AGAIN);
      this.fileCache.set(path, {
        bytes,
        size: stat.size,
        mtimeMs: stat.mtime.getTime(),
        identity,
        contentVersion: stat.contentVersion,
        lease,
      });
      return bytes;
    } catch (error) {
      lease?.release();
      throw error;
    }
  }

  private async replaceBytes(
    path: string,
    size: number,
    edit: (next: Uint8Array) => void,
  ): Promise<void> {
    const old = await this.fileBytes(path);
    this.ctx.executionScope?.consumeWork(
      Math.ceil(size / RPC_BYTES),
      "WASI file write",
    );
    const lease = this.ctx.executionScope?.reserveBytes(size, "WASI file I/O");
    let retained = false;
    try {
      const next = new Uint8Array(size);
      next.set(old.subarray(0, size));
      edit(next);
      this.check();
      await this.ctx.fs.writeFile(path, next);
      this.check();
      const stat = await this.ctx.fs.stat(path);
      this.check();
      if (stat.size !== size) throw new WasiError(WASI.ERRNO_AGAIN);
      this.invalidate(path);
      this.fileCache.set(path, {
        bytes: next,
        size,
        mtimeMs: stat.mtime.getTime(),
        identity: cacheIdentity(stat),
        contentVersion: stat.contentVersion,
        lease,
      });
      retained = true;
    } finally {
      if (!retained) {
        lease?.release();
        this.invalidate(path);
      }
    }
  }

  private async read(
    id: number,
    length: number,
    offset?: number,
  ): Promise<Uint8Array> {
    const fd = this.fd(id, WASI.RIGHTS_FD_READ);
    if (id === 0) {
      if (offset !== undefined) throw new WasiError(WASI.ERRNO_SPIPE);
      const stdin = latin1FromBytes(this.ctx.stdin);
      const end = Math.min(stdin.length, this.stdinPosition + length);
      const result = Uint8Array.from(
        stdin.slice(this.stdinPosition, end),
        (c) => c.charCodeAt(0),
      );
      this.stdinPosition = end;
      return result;
    }
    if (fd.type !== WASI.FILETYPE_REGULAR_FILE)
      throw new WasiError(WASI.ERRNO_ISDIR);
    const bytes = await this.fileBytes(fd.path);
    const start = offset ?? fd.position;
    const result = bytes.slice(start, start + length);
    if (offset === undefined) fd.position += result.length;
    return result;
  }

  private async write(
    id: number,
    bytes: Uint8Array,
    offset?: number,
  ): Promise<number> {
    const fd = this.fd(id, WASI.RIGHTS_FD_WRITE);
    if (id === 1 || id === 2) {
      if (offset !== undefined) throw new WasiError(WASI.ERRNO_SPIPE);
      if (
        bytes.length >
        Math.min(
          this.ctx.limits.maxOutputSize,
          this.ctx.limits.maxStringLength,
        ) -
          this.outputBytes
      )
        throw new Error("WASI output limit exceeded");
      const lease = this.ctx.executionScope?.reserveBytes(
        bytes.length,
        "WASI output",
      );
      if (lease) this.outputLeases.push(lease);
      this.outputBytes += bytes.length;
      if (id === 1) {
        // Keep every byte, including non-UTF-8 and split multibyte sequences.
        this.stdout += latin1FromBytes(bytesFromUint8Array(bytes));
      } else this.stderr += this.stderrDecoder.decode(bytes, { stream: true });
      return bytes.length;
    }
    if (fd.type !== WASI.FILETYPE_REGULAR_FILE)
      throw new WasiError(WASI.ERRNO_ISDIR);
    if (bytes.length === 0) return 0;
    const stat = await this.ctx.fs.stat(fd.path);
    this.check();
    if (!stat.isFile) throw new WasiError(WASI.ERRNO_NOTSUP);
    const start =
      fd.flags & WASI.FDFLAGS_APPEND ? stat.size : (offset ?? fd.position);
    const size = this.size(Math.max(stat.size, start + bytes.length));
    if (start === stat.size) {
      this.invalidate(fd.path, false, cacheIdentity(stat));
      await this.ctx.fs.appendFile(fd.path, bytes);
    } else {
      await this.replaceBytes(fd.path, size, (next) => {
        next.set(bytes, start);
      });
    }
    this.check();
    if (offset === undefined) fd.position = start + bytes.length;
    return bytes.length;
  }

  private async open(
    id: number,
    request: Extract<WasiOperation, { op: "open" }>,
  ): Promise<number> {
    const parent = this.fd(id, WASI.RIGHTS_PATH_OPEN);
    const path = text(request.path);
    const lookupFlags = integer(request.lookupFlags, 1);
    const openFlags = integer(request.openFlags, 15);
    const rights = bigint(request.rights);
    const inheriting = bigint(request.inheritingRights);
    const flags = integer(request.flags, 31);
    if (
      rights < 0n ||
      inheriting < 0n ||
      ((rights | inheriting) & ~parent.inheriting) !== 0n
    )
      throw new WasiError(WASI.ERRNO_NOTCAPABLE);
    if (this.fds.size >= this.ctx.limits.maxFileDescriptors)
      throw new WasiError(WASI.ERRNO_MFILE);
    const create = (openFlags & WASI.OFLAGS_CREAT) !== 0;
    if (create) this.fd(id, WASI.RIGHTS_PATH_CREATE_FILE);
    if (openFlags & WASI.OFLAGS_TRUNC)
      this.fd(id, WASI.RIGHTS_PATH_FILESTAT_SET_SIZE);
    const resolved = await this.resolve(parent, path, !!lookupFlags, create);
    let stat: FsStat;
    try {
      stat = await this.ctx.fs.lstat(resolved);
      if (stat.isSymbolicLink) throw new WasiError(WASI.ERRNO_LOOP);
      if (create && openFlags & WASI.OFLAGS_EXCL)
        throw new WasiError(WASI.ERRNO_EXIST);
    } catch (error) {
      if (!create || errnoFrom(error) !== WASI.ERRNO_NOENT) throw error;
      if (openFlags & WASI.OFLAGS_DIRECTORY)
        throw new WasiError(WASI.ERRNO_INVAL);
      this.check();
      await this.ctx.fs.writeFile(resolved, new Uint8Array());
      this.invalidate(resolved);
      stat = await this.ctx.fs.stat(resolved);
    }
    this.check();
    if (!stat.isDirectory && !stat.isFile)
      throw new WasiError(WASI.ERRNO_NOTSUP);
    if (openFlags & WASI.OFLAGS_DIRECTORY && !stat.isDirectory)
      throw new WasiError(WASI.ERRNO_NOTDIR);
    if (openFlags & WASI.OFLAGS_TRUNC) {
      if (stat.isDirectory) throw new WasiError(WASI.ERRNO_ISDIR);
      if (!(rights & BigInt(WASI.RIGHTS_FD_WRITE)))
        throw new WasiError(WASI.ERRNO_NOTCAPABLE);
      await this.ctx.fs.writeFile(resolved, new Uint8Array());
      this.invalidate(resolved, false, cacheIdentity(stat));
      this.check();
    }
    const handle = this.nextFd++;
    this.fds.set(handle, {
      path: resolved,
      type: stat.isDirectory
        ? WASI.FILETYPE_DIRECTORY
        : WASI.FILETYPE_REGULAR_FILE,
      position: 0,
      flags,
      rights,
      inheriting,
    });
    return handle;
  }

  async request(request: WasiRequest): Promise<Uint8Array> {
    this.check();
    this.ctx.executionScope?.consumeWork(1, "WASI request");
    const id = integer(request.fd);
    if (
      "data" in request &&
      request.data !== undefined &&
      (!(request.data instanceof Uint8Array) || request.data.length > RPC_BYTES)
    )
      throw new WasiError(WASI.ERRNO_INVAL);
    let result: unknown;
    switch (request.op) {
      case "open":
        result = await this.open(id, request);
        break;
      case "close":
        this.fd(id);
        this.fds.delete(id);
        break;
      case "read":
        return this.read(
          id,
          integer(request.size, RPC_BYTES),
          request.offset === undefined ? undefined : integer(request.offset),
        );
      case "write":
        result = await this.write(
          id,
          request.data ?? new Uint8Array(),
          request.offset === undefined ? undefined : integer(request.offset),
        );
        break;
      case "stat":
        result = await this.stat(this.fd(id, WASI.RIGHTS_FD_FILESTAT_GET));
        break;
      case "fdstat": {
        const fd = this.fd(id);
        result = {
          type: fd.type,
          flags: fd.flags,
          rights: String(fd.rights),
          inheriting: String(fd.inheriting),
        };
        break;
      }
      case "flags":
        this.fd(id, WASI.RIGHTS_FD_FDSTAT_SET_FLAGS).flags = integer(
          request.flags,
          31,
        );
        break;
      case "rights": {
        const fd = this.fd(id);
        const rights = bigint(request.rights);
        const inheriting = bigint(request.inheritingRights);
        if (
          rights < 0n ||
          inheriting < 0n ||
          rights & ~fd.rights ||
          inheriting & ~fd.inheriting
        )
          throw new WasiError(WASI.ERRNO_NOTCAPABLE);
        fd.rights = rights;
        fd.inheriting = inheriting;
        break;
      }
      case "seek": {
        const fd = this.fd(id, WASI.RIGHTS_FD_SEEK);
        if (fd.type !== WASI.FILETYPE_REGULAR_FILE)
          throw new WasiError(WASI.ERRNO_SPIPE);
        const whence = integer(request.whence, 2);
        const start =
          whence === 0
            ? 0
            : whence === 1
              ? fd.position
              : (await this.stat(fd)).size;
        fd.position = integer(Number(BigInt(start) + bigint(request.offset)));
        result = fd.position;
        break;
      }
      case "tell":
        result = this.fd(id, WASI.RIGHTS_FD_TELL).position;
        break;
      case "resize": {
        const fd = this.fd(id, WASI.RIGHTS_FD_FILESTAT_SET_SIZE);
        const size = this.size(integer(request.size));
        await this.replaceBytes(fd.path, size, () => {});
        break;
      }
      case "sync":
        this.fd(id, WASI.RIGHTS_FD_SYNC);
        break;
      case "datasync":
        this.fd(id, WASI.RIGHTS_FD_DATASYNC);
        break;
      case "pathstat": {
        const path = await this.resolve(
          this.fd(id, WASI.RIGHTS_PATH_FILESTAT_GET),
          text(request.path),
          !!integer(request.flags, 1),
        );
        result = this.fileStat(await this.ctx.fs.lstat(path));
        break;
      }
      default:
        throw new WasiError(WASI.ERRNO_NOTSUP);
    }
    this.check();
    return result === undefined
      ? new Uint8Array()
      : encoder.encode(JSON.stringify(result));
  }
}

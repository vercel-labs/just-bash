/**
 * ReadWriteFs - Direct wrapper around the real filesystem
 *
 * All operations go directly to the underlying Node.js filesystem.
 * Paths are relative to the configured root directory.
 *
 * Security: Symlinks are blocked by default (allowSymlinks: false).
 * All real-FS access goes through resolveAndValidate() / validateParent()
 * gates which detect symlink traversal via path comparison. When symlinks
 * are allowed, targets are validated and transformed to stay within root.
 * New methods must use these gates — never access the real FS directly.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { type ByteString, unsafeBytesFromLatin1 } from "../../encoding.js";
import {
  type FileContent,
  fromBuffer,
  getEncoding,
  toBuffer,
} from "../encoding.js";
import type {
  CpOptions,
  CreateExclusiveOptions,
  DirentEntry,
  FsStat,
  IFileSystem,
  MkdirOptions,
  ReadFileOptions,
  RmOptions,
  WriteFileOptions,
} from "../interface.js";
import { resolvePath as resolveVPath } from "../path-utils.js";
import {
  isPathWithinRoot,
  normalizePath,
  resolveCanonicalPath,
  resolveCanonicalPathNoSymlinks,
  sanitizeFsError,
  validatePath,
  validateRootDirectory,
} from "../real-fs-utils.js";

/** Error patterns that are safe to pass through (contain virtual paths, not real ones). */
const RW_PASSTHROUGH_ERRORS = [
  "EACCES",
  "escaping sandbox",
  "EFBIG",
  "ENOTSUP",
] as const;

export interface ReadWriteFsOptions {
  /**
   * The root directory on the real filesystem.
   * All paths are relative to this root.
   */
  root: string;

  /**
   * Maximum file size in bytes that can be read.
   * Files larger than this will throw an EFBIG error.
   * Defaults to 10MB (10485760).
   */
  maxFileReadSize?: number;

  /**
   * Maximum file size in bytes that metadata operations and append may copy
   * when isolating a multiply-linked regular file. Defaults to 100MB.
   * Set to 0 to disable this limit.
   */
  maxCopyOnWriteSize?: number;

  /**
   * Maximum regular file size in bytes that cp may copy. Defaults to 0
   * (unlimited) for compatibility with normal filesystem copy behavior.
   */
  maxCopySize?: number;

  /**
   * Whether to allow following and creating symlinks.
   * When false (default), any path traversing a symlink is rejected
   * and symlink() throws EPERM.
   */
  allowSymlinks?: boolean;
}

export class ReadWriteFs implements IFileSystem {
  private static activeMutationRoots = new Set<string>();
  private static pendingMutations: Array<{
    root: string;
    start: () => void;
  }> = [];
  private readonly root: string;
  private readonly canonicalRoot: string;
  private readonly maxFileReadSize: number;
  private readonly maxCopyOnWriteSize: number;
  private readonly maxCopySize: number;
  private readonly allowSymlinks: boolean;

  constructor(options: ReadWriteFsOptions) {
    this.root = nodePath.resolve(options.root);
    this.maxFileReadSize = options.maxFileReadSize ?? 10485760;
    this.maxCopyOnWriteSize = options.maxCopyOnWriteSize ?? 104857600;
    this.maxCopySize = options.maxCopySize ?? 0;
    this.allowSymlinks = options.allowSymlinks ?? false;

    // Verify root exists and is a directory
    validateRootDirectory(this.root, "ReadWriteFs");

    // Compute canonical root (resolves symlinks like /var -> /private/var on macOS)
    this.canonicalRoot = fs.realpathSync(this.root);
  }

  /**
   * Validate that a resolved real path stays within the sandbox root and
   * return the canonical (symlink-resolved) path for use in subsequent I/O.
   * This closes the TOCTOU gap where the original path could be swapped
   * between validation and use.
   * Throws EACCES if the path escapes the root.
   */
  private resolveAndValidate(realPath: string, virtualPath: string): string {
    const canonical = this.allowSymlinks
      ? resolveCanonicalPath(realPath, this.canonicalRoot)
      : resolveCanonicalPathNoSymlinks(realPath, this.root, this.canonicalRoot);
    if (canonical === null) {
      throw new Error(
        `EACCES: permission denied, '${virtualPath}' resolves outside sandbox`,
      );
    }
    return canonical;
  }

  /**
   * Validate the parent directory of a path (for operations like lstat/readlink
   * that should not follow the final component's symlink).
   * Returns the canonical parent joined with the original basename.
   */
  private validateParent(realPath: string, virtualPath: string): string {
    const parent = nodePath.dirname(realPath);
    const canonicalParent = this.resolveAndValidate(parent, virtualPath);
    return nodePath.join(canonicalParent, nodePath.basename(realPath));
  }

  /**
   * Convert a virtual path to a real filesystem path.
   */
  private toRealPath(virtualPath: string): string {
    const normalized = normalizePath(virtualPath);
    const realPath = nodePath.join(this.root, normalized);
    return nodePath.resolve(realPath);
  }

  async readFile(
    path: string,
    options?: ReadFileOptions | BufferEncoding,
  ): Promise<string> {
    const buffer = await this.readFileBuffer(path);
    const encoding = getEncoding(options);
    return fromBuffer(buffer, encoding);
  }

  async readFileBytes(path: string): Promise<ByteString> {
    const buffer = await this.readFileBuffer(path);
    return unsafeBytesFromLatin1(fromBuffer(buffer, "binary"));
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    validatePath(path, "open");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);

    try {
      // When symlinks are disabled, use O_NOFOLLOW to prevent TOCTOU: if the
      // file at `canonical` is replaced with a symlink between
      // resolveAndValidate() and this open, O_NOFOLLOW makes it fail with
      // ELOOP instead of following it.
      const flags = this.allowSymlinks
        ? fs.constants.O_RDONLY
        : fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
      const fh = await fs.promises.open(canonical, flags);
      try {
        if (this.maxFileReadSize > 0) {
          const stat = await fh.stat();
          if (stat.size > this.maxFileReadSize) {
            throw new Error(
              `EFBIG: file too large, read '${path}' (${stat.size} bytes, max ${this.maxFileReadSize})`,
            );
          }
        }
        const content = await fh.readFile();
        return new Uint8Array(content);
      } finally {
        await fh.close();
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      if (err.code === "EISDIR") {
        throw new Error(
          `EISDIR: illegal operation on a directory, read '${path}'`,
        );
      }
      if (err.code === "ELOOP") {
        // O_NOFOLLOW caught a symlink swap (TOCTOU defense)
        throw new Error(`EACCES: permission denied, '${path}' is a symlink`);
      }
      this.sanitizeError(e, path, "open");
    }
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    await this.withFilesystemMutation(() =>
      this.writeFileUnlocked(path, content, options),
    );
  }

  private async writeFileUnlocked(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    validatePath(path, "write");
    const realPath = this.toRealPath(path);
    let canonical = this.resolveAndValidate(realPath, path);
    const encoding = getEncoding(options);
    const buffer = toBuffer(content, encoding);

    // Ensure parent directory exists
    const dir = nodePath.dirname(canonical);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      // Re-validate after mkdir to catch TOCTOU: a concurrent process could
      // replace a parent directory with a symlink between the initial
      // validation and mkdir.
      canonical = this.resolveAndValidate(realPath, path);
      const noFollow = this.allowSymlinks ? 0 : fs.constants.O_NOFOLLOW;
      let existingStat: fs.Stats | null = null;
      try {
        const pathStat = await fs.promises.lstat(canonical);
        if (!pathStat.isFile() && !pathStat.isDirectory()) {
          throw new Error(`EACCES: cannot write special file '${path}'`);
        }
        const fh = await fs.promises.open(
          canonical,
          fs.constants.O_WRONLY | fs.constants.O_NONBLOCK | noFollow,
        );
        try {
          existingStat = await fh.stat();
          if (!existingStat.isFile()) {
            throw new Error(`EACCES: cannot write special file '${path}'`);
          }
          if (existingStat.nlink <= 1) {
            await fh.truncate(0);
            await fh.writeFile(buffer);
            return;
          }
        } finally {
          await fh.close();
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await this.replaceFile(canonical, buffer, existingStat);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ELOOP") {
        throw new Error(`EACCES: permission denied, '${path}' is a symlink`);
      }
      this.sanitizeError(e, path, "write");
    }
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    await this.withFilesystemMutation(() =>
      this.appendFileUnlocked(path, content, options),
    );
  }

  private async appendFileUnlocked(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    validatePath(path, "append");
    const realPath = this.toRealPath(path);
    const encoding = getEncoding(options);
    const buffer = toBuffer(content, encoding);
    let canonical = this.resolveAndValidate(realPath, path);
    // Ensure parent directory exists
    const dir = nodePath.dirname(canonical);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      // Re-validate after mkdir to catch TOCTOU parent-swap attacks
      canonical = this.resolveAndValidate(realPath, path);
      const noFollow = this.allowSymlinks ? 0 : fs.constants.O_NOFOLLOW;
      let existingStat: fs.Stats | null = null;
      try {
        const pathStat = await fs.promises.lstat(canonical);
        if (!pathStat.isFile() && !pathStat.isDirectory()) {
          throw new Error(`EACCES: cannot append special file '${path}'`);
        }
        const permissionHandle = await fs.promises.open(
          canonical,
          fs.constants.O_WRONLY |
            fs.constants.O_APPEND |
            fs.constants.O_NONBLOCK |
            noFollow,
        );
        try {
          existingStat = await permissionHandle.stat();
          if (!existingStat.isFile()) {
            throw new Error(`EACCES: cannot append special file '${path}'`);
          }
          if (existingStat.nlink <= 1) {
            await permissionHandle.writeFile(buffer);
            return;
          }
        } finally {
          await permissionHandle.close();
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }

      if (!existingStat) {
        await this.replaceFile(canonical, buffer, null);
        return;
      }
      this.assertCopyOnWriteSize(existingStat.size, "append", path);
      // Copy through a no-atime handle where the platform supports it. The
      // copy is limited to the size snapshot above, so concurrent growth
      // cannot make this loop unbounded.
      const source = await this.openCopySource(canonical);
      try {
        const stat = await source.stat();
        if (
          !stat.isFile() ||
          stat.dev !== existingStat.dev ||
          stat.ino !== existingStat.ino
        ) {
          throw new Error(`EACCES: file identity changed, append '${path}'`);
        }
        await this.replaceFile(canonical, buffer, stat, {
          handle: source,
          size: existingStat.size,
        });
      } finally {
        await source.close();
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ELOOP") {
        throw new Error(`EACCES: permission denied, '${path}' is a symlink`);
      }
      this.sanitizeError(e, path, "append");
    }
  }

  private async withFilesystemMutation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      ReadWriteFs.pendingMutations.push({
        root: this.canonicalRoot,
        start: () => {
          ReadWriteFs.activeMutationRoots.add(this.canonicalRoot);
          void operation()
            .then(resolve, reject)
            .finally(() => {
              ReadWriteFs.activeMutationRoots.delete(this.canonicalRoot);
              ReadWriteFs.drainMutationQueue();
            });
        },
      });
      ReadWriteFs.drainMutationQueue();
    });
  }

  private static drainMutationQueue(): void {
    for (let index = 0; index < ReadWriteFs.pendingMutations.length; ) {
      const pending = ReadWriteFs.pendingMutations[index];
      const overlapsActiveRoot = [...ReadWriteFs.activeMutationRoots].some(
        (activeRoot) =>
          isPathWithinRoot(pending.root, activeRoot) ||
          isPathWithinRoot(activeRoot, pending.root),
      );
      if (overlapsActiveRoot) {
        index++;
        continue;
      }
      ReadWriteFs.pendingMutations.splice(index, 1);
      pending.start();
    }
  }

  private assertCopyOnWriteSize(
    size: number,
    operation: string,
    virtualPath: string,
  ): void {
    if (this.maxCopyOnWriteSize > 0 && size > this.maxCopyOnWriteSize) {
      throw new Error(
        `EFBIG: file too large for copy-on-write ${operation} '${virtualPath}' (${size} bytes, max ${this.maxCopyOnWriteSize})`,
      );
    }
  }

  private assertCopySize(stat: fs.Stats, virtualPath: string): void {
    if (this.maxCopySize > 0 && stat.size > this.maxCopySize) {
      throw new Error(
        `EFBIG: file too large to copy '${virtualPath}' (${stat.size} bytes, max ${this.maxCopySize})`,
      );
    }
  }

  private randomTransactionToken(): string {
    return randomBytes(16).toString("hex");
  }

  /** Open a bounded copy source, avoiding atime updates where permitted. */
  private async openCopySource(
    canonical: string,
  ): Promise<fs.promises.FileHandle> {
    const noFollow = this.allowSymlinks ? 0 : fs.constants.O_NOFOLLOW;
    const flags = fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | noFollow;
    const noAtime = (
      fs.constants as typeof fs.constants & { O_NOATIME?: number }
    ).O_NOATIME;
    if (process.platform !== "linux" || noAtime === undefined) {
      return fs.promises.open(canonical, flags);
    }

    // O_NOATIME can be exposed by a Node runtime, but the kernel rejects it
    // with EPERM when the process does not own the inode and lacks CAP_FOWNER.
    // In that case preserve normal readable-file behavior.
    try {
      return await fs.promises.open(canonical, flags | noAtime);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e;
      return fs.promises.open(canonical, flags);
    }
  }

  /**
   * Commit file contents by replacing a directory entry, never by mutating
   * its existing inode. This prevents writes through host-planted hard links
   * from changing files outside the sandbox.
   */
  private async replaceFile(
    canonical: string,
    content: Uint8Array,
    existingStat: Pick<fs.Stats, "mode" | "atime" | "mtime"> | null,
    source?: { handle: fs.promises.FileHandle; size: number },
    times?: { atime: Date; mtime: Date },
    preserveSpecialModeBits = false,
  ): Promise<void> {
    const dir = nodePath.dirname(canonical);
    let tempPath = "";
    let fh: fs.promises.FileHandle | null = null;
    const createMode = existingStat === null ? 0o666 : 0o600;
    for (let attempts = 0; attempts < 16; attempts++) {
      tempPath = nodePath.join(
        dir,
        `.just-bash-write-${this.randomTransactionToken()}`,
      );
      try {
        fh = await fs.promises.open(
          tempPath,
          fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
          createMode,
        );
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
    if (!fh) throw new Error(`EEXIST: replacement write '${canonical}'`);
    const tempHandle = fh;
    const tempIdentity = await tempHandle.stat();
    let committed = false;

    try {
      try {
        let position = 0;
        const writeAt = async (data: Uint8Array): Promise<void> => {
          let offset = 0;
          while (offset < data.byteLength) {
            const { bytesWritten } = await tempHandle.write(
              data,
              offset,
              data.byteLength - offset,
              position + offset,
            );
            if (bytesWritten === 0) {
              throw new Error("EIO: replacement write made no progress");
            }
            offset += bytesWritten;
          }
          position += offset;
        };
        if (source) {
          const chunk = Buffer.allocUnsafe(64 * 1024);
          let sourcePosition = 0;
          let remaining = source.size;
          while (remaining > 0) {
            const bytesToRead = Math.min(chunk.length, remaining);
            const { bytesRead } = await source.handle.read(
              chunk,
              0,
              bytesToRead,
              sourcePosition,
            );
            if (bytesRead === 0) break;
            await writeAt(chunk.subarray(0, bytesRead));
            sourcePosition += bytesRead;
            remaining -= bytesRead;
          }
        }
        await writeAt(content);
        if (existingStat !== null) {
          await tempHandle.chmod(
            existingStat.mode & (preserveSpecialModeBits ? 0o7777 : 0o777),
          );
        }
        if (times) {
          await tempHandle.utimes(times.atime, times.mtime);
        } else if (existingStat !== null) {
          const tempStat = await tempHandle.stat();
          await tempHandle.utimes(existingStat.atime, tempStat.mtime);
        }
      } finally {
        await tempHandle.close();
        fh = null;
      }

      // Fail closed if another same-user actor replaced the staging entry
      // while its file handle was open. rename() itself is entry-oriented, but
      // committing an attacker-substituted entry would violate write intent.
      const stagedIdentity = await fs.promises.lstat(tempPath);
      if (
        !stagedIdentity.isFile() ||
        stagedIdentity.dev !== tempIdentity.dev ||
        stagedIdentity.ino !== tempIdentity.ino
      ) {
        throw new Error("EACCES: replacement staging entry changed");
      }
      await fs.promises.rename(tempPath, canonical);
      committed = true;
    } finally {
      if (fh) await fh.close().catch(() => {});
      if (!committed) {
        await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    if (path.includes("\0")) return false;
    const realPath = this.toRealPath(path);
    try {
      const canonical = this.resolveAndValidate(realPath, path);
      await fs.promises.access(canonical);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FsStat> {
    validatePath(path, "stat");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);

    try {
      // Use lstat instead of stat to close a TOCTOU gap: if the file at
      // `canonical` is replaced with a symlink between resolveAndValidate()
      // and this call, lstat detects it (returns isSymbolicLink() = true)
      // instead of following it.
      const stat = await fs.promises.lstat(canonical);
      if (!this.allowSymlinks && stat.isSymbolicLink()) {
        throw new Error(`EACCES: permission denied, '${path}' is a symlink`);
      }
      return {
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymbolicLink: stat.isSymbolicLink(),
        mode: stat.mode,
        size: stat.size,
        mtime: stat.mtime,
        dev: stat.dev,
        ino: stat.ino,
        identity: `real:${stat.dev}:${stat.ino}`,
      };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
      }
      this.sanitizeError(e, path, "stat");
    }
  }

  async lstat(path: string): Promise<FsStat> {
    validatePath(path, "lstat");
    const realPath = this.toRealPath(path);
    const canonical = this.validateParent(realPath, path);

    try {
      const stat = await fs.promises.lstat(canonical);
      return {
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymbolicLink: stat.isSymbolicLink(),
        mode: stat.mode,
        size: stat.size,
        mtime: stat.mtime,
        dev: stat.dev,
        ino: stat.ino,
        identity: `real:${stat.dev}:${stat.ino}`,
      };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, lstat '${path}'`);
      }
      this.sanitizeError(e, path, "lstat");
    }
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    await this.withFilesystemMutation(() => this.mkdirUnlocked(path, options));
  }

  /**
   * Atomically create a private file or directory that must not already
   * exist. `O_CREAT|O_EXCL` (and `mkdir`) are exclusive in the kernel, so a
   * concurrent host process cannot win a race between a check and the create,
   * and the mode is applied by the creating syscall rather than a later
   * chmod — the entry is never on disk with the default 0644/0755. POSIX
   * requires `O_EXCL` to fail on a symlink at the final component, so a
   * pre-planted link is a collision instead of a write-through target.
   */
  async createExclusive(
    path: string,
    options: CreateExclusiveOptions,
  ): Promise<void> {
    await this.withFilesystemMutation(() =>
      this.createExclusiveUnlocked(path, options),
    );
  }

  /**
   * Confirm that what was just created is the entry the validated path still
   * denotes, and that it is still inside the root.
   *
   * O_EXCL and O_NOFOLLOW only bind the final component. A concurrent host
   * process can swap an *intermediate* directory for a symlink between the
   * parent validation and the create, which would place the new entry outside
   * the sandbox. Re-resolving afterwards detects that, and comparing
   * device/inode detects a swap of the entry itself. On failure the entry is
   * removed on a best-effort basis before the error surfaces, so a swap does
   * not leave a stray file behind.
   */
  private async assertCreatedInsideRoot(
    canonical: string,
    realPath: string,
    virtualPath: string,
    syscall: string,
    createdStat: fs.Stats,
  ): Promise<void> {
    let ok = false;
    try {
      const revalidated = this.resolveAndValidate(realPath, virtualPath);
      const current = await fs.promises.lstat(revalidated);
      ok =
        revalidated === canonical &&
        current.dev === createdStat.dev &&
        current.ino === createdStat.ino;
    } catch {
      ok = false;
    }
    if (ok) return;

    // Deliberately no cleanup. This branch means the path no longer denotes
    // what was created — an intermediate component was swapped, or the entry
    // itself was replaced — so every pathname available here is exactly the
    // one just proven untrustworthy. Removing it would follow the swapped
    // component and delete an attacker-chosen target, which is a worse
    // outcome than the stray entry it would tidy up: that entry is empty and
    // 0600 at a path the attacker already controls. Node exposes no way to
    // unlink by descriptor, so there is no safe removal to perform.
    throw new Error(
      `EACCES: permission denied, '${virtualPath}' resolves outside sandbox during ${syscall}`,
    );
  }

  private async createExclusiveUnlocked(
    path: string,
    options: CreateExclusiveOptions,
  ): Promise<void> {
    const syscall = options.directory ? "mkdir" : "open";
    validatePath(path, syscall);
    const realPath = this.toRealPath(path);
    // Validate the parent without following a symlink occupying the name.
    const canonical =
      realPath === this.root
        ? this.resolveAndValidate(realPath, path)
        : this.validateParent(realPath, path);

    try {
      if (options.directory) {
        await fs.promises.mkdir(canonical, { mode: options.mode });
        // Open the new directory without following symlinks and identify it
        // by descriptor, so a concurrent replacement at the same pathname is
        // caught by the comparison below rather than silently accepted.
        const dirHandle = await fs.promises.open(
          canonical,
          fs.constants.O_RDONLY |
            (fs.constants.O_DIRECTORY ?? 0) |
            (this.allowSymlinks ? 0 : fs.constants.O_NOFOLLOW),
        );
        try {
          await this.assertCreatedInsideRoot(
            canonical,
            realPath,
            path,
            syscall,
            await dirHandle.stat(),
          );
        } finally {
          await dirHandle.close();
        }
        return;
      }
      const noFollow = this.allowSymlinks ? 0 : fs.constants.O_NOFOLLOW;
      const handle = await fs.promises.open(
        canonical,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          noFollow,
        options.mode,
      );
      try {
        await this.assertCreatedInsideRoot(
          canonical,
          realPath,
          path,
          syscall,
          await handle.stat(),
        );
      } finally {
        await handle.close();
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EEXIST") {
        throw new Error(`EEXIST: file already exists, ${syscall} '${path}'`);
      }
      if (err.code === "ENOENT") {
        throw new Error(
          `ENOENT: no such file or directory, ${syscall} '${path}'`,
        );
      }
      this.sanitizeError(e, path, syscall);
    }
  }

  private async mkdirUnlocked(
    path: string,
    options?: MkdirOptions,
  ): Promise<void> {
    validatePath(path, "mkdir");
    const realPath = this.toRealPath(path);
    // mkdir creates the final directory entry. Validate its parent without
    // following a dangling symlink already occupying the requested name.
    const canonical =
      realPath === this.root
        ? this.resolveAndValidate(realPath, path)
        : this.validateParent(realPath, path);

    try {
      await fs.promises.mkdir(canonical, { recursive: options?.recursive });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EEXIST") {
        throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
      }
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
      }
      this.sanitizeError(e, path, "mkdir");
    }
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.readdirWithFileTypes(path);
    return entries.map((e) => e.name);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    validatePath(path, "scandir");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);

    try {
      // Defense-in-depth lstat check: if the directory at `canonical` was
      // replaced with a symlink between resolveAndValidate() and readdir,
      // lstat detects it.  Node.js has no fd-based readdir, so a tiny
      // TOCTOU window remains between this lstat and the readdir below.
      if (!this.allowSymlinks) {
        const dirStat = await fs.promises.lstat(canonical);
        if (dirStat.isSymbolicLink()) {
          throw new Error(`EACCES: permission denied, '${path}' is a symlink`);
        }
      }
      const entries = await fs.promises.readdir(canonical, {
        withFileTypes: true,
      });
      return entries
        .map((dirent) => ({
          name: dirent.name,
          isFile: dirent.isFile(),
          isDirectory: dirent.isDirectory(),
          isSymbolicLink: dirent.isSymbolicLink(),
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      }
      if (err.code === "ENOTDIR") {
        throw new Error(`ENOTDIR: not a directory, scandir '${path}'`);
      }
      this.sanitizeError(e, path, "scandir");
    }
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    await this.withFilesystemMutation(() => this.rmUnlocked(path, options));
  }

  private async rmUnlocked(path: string, options?: RmOptions): Promise<void> {
    validatePath(path, "rm");
    const realPath = this.toRealPath(path);
    // Deletion is entry-oriented: authorize the parent, but do not resolve the
    // final component. Resolving it would turn `rm link` into `rm target` when
    // symlinks are allowed, which can delete an unrelated file or directory.
    const canonical = this.validateParent(realPath, path);

    try {
      const stat = await fs.promises.lstat(canonical);
      if (!this.allowSymlinks && stat.isSymbolicLink()) {
        throw new Error(`EACCES: permission denied, '${path}' is a symlink`);
      }
      await fs.promises.rm(canonical, {
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
      });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        if (options?.force) return;
        throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
      }
      if (err.code === "ENOTEMPTY") {
        throw new Error(`ENOTEMPTY: directory not empty, rm '${path}'`);
      }
      this.sanitizeError(e, path, "rm");
    }
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    await this.withFilesystemMutation(() =>
      this.cpUnlocked(src, dest, options),
    );
  }

  private async cpUnlocked(
    src: string,
    dest: string,
    options?: CpOptions,
  ): Promise<void> {
    validatePath(src, "cp");
    validatePath(dest, "cp");
    const srcReal = this.toRealPath(src);
    const destReal = this.toRealPath(dest);
    // cp operates on the source directory entry itself, including when it is
    // a symlink. Validate its parent without resolving the final component.
    const srcCanonical = this.validateParent(srcReal, src);
    const destCanonical = this.resolveAndValidate(destReal, dest);
    let srcStat: fs.Stats;
    try {
      srcStat = await fs.promises.lstat(srcCanonical);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, cp '${src}'`);
      }
      this.sanitizeError(e, src, "cp");
    }
    if (
      srcStat.isDirectory() &&
      isPathWithinRoot(destCanonical, srcCanonical)
    ) {
      throw new Error(`EINVAL: cannot copy '${src}' into itself, '${dest}'`);
    }
    if (!srcStat.isDirectory()) {
      try {
        const destEntry = this.validateParent(destReal, dest);
        const destEntryStat = await fs.promises.lstat(destEntry);
        if (
          srcStat.dev === destEntryStat.dev &&
          srcStat.ino === destEntryStat.ino
        ) {
          throw new Error(
            `EINVAL: cannot copy '${src}' onto itself, '${dest}'`,
          );
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    if (srcStat.isFile()) {
      try {
        const destStat = await fs.promises.stat(destCanonical);
        if (srcStat.dev === destStat.dev && srcStat.ino === destStat.ino) {
          throw new Error(
            `EINVAL: cannot copy '${src}' onto itself, '${dest}'`,
          );
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }

    try {
      await this.preflightCopyTree(srcCanonical, src);
    } catch (e) {
      this.sanitizeError(e, src, "cp");
    }

    // Match fs.cp's behavior for a missing destination hierarchy. Validate
    // again after creating it so the path used for replacement reflects the
    // directory entries that now exist.
    if (srcStat.isFile() || srcStat.isSymbolicLink()) {
      try {
        await fs.promises.mkdir(nodePath.dirname(destCanonical), {
          recursive: true,
        });
        this.resolveAndValidate(destReal, dest);
      } catch (e) {
        this.sanitizeError(e, dest, "cp");
      }
    }

    try {
      await this.copyTreeEntry(
        srcCanonical,
        destReal,
        src,
        dest,
        options?.recursive ?? false,
      );
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, cp '${src}'`);
      }
      if (err.code === "EISDIR") {
        throw new Error(`EISDIR: is a directory, cp '${src}'`);
      }
      this.sanitizeError(e, src, "cp");
    }
  }

  private async copyTreeEntry(
    source: string,
    destinationReal: string,
    virtualSource: string,
    virtualDestination: string,
    recursive: boolean,
  ): Promise<void> {
    const stat = await fs.promises.lstat(source);
    if (stat.isFile()) {
      this.assertCopySize(stat, virtualSource);
      const destination = this.resolveAndValidate(
        destinationReal,
        virtualDestination,
      );
      const destinationStat = await this.assertCopyDestinationWritable(
        destination,
        virtualDestination,
      );
      const sourceHandle = await this.openCopySource(source);
      try {
        const sourceStat = await sourceHandle.stat();
        if (
          !sourceStat.isFile() ||
          sourceStat.dev !== stat.dev ||
          sourceStat.ino !== stat.ino
        ) {
          throw new Error(
            `EACCES: file identity changed, cp '${virtualSource}'`,
          );
        }
        await this.replaceFile(
          destination,
          new Uint8Array(0),
          destinationStat ?? stat,
          { handle: sourceHandle, size: stat.size },
        );
      } finally {
        await sourceHandle.close();
      }
      return;
    }
    if (stat.isSymbolicLink()) {
      if (!this.allowSymlinks) {
        throw new Error(
          `EACCES: permission denied, cp '${virtualSource}' contains a symlink`,
        );
      }
      const rawTarget = await fs.promises.readlink(source);
      const target = nodePath.isAbsolute(rawTarget)
        ? await this.toVirtualAbsoluteSymlinkTarget(rawTarget, virtualSource)
        : rawTarget;
      await this.replaceSymlink(destinationReal, virtualDestination, target);
      return;
    }
    if (stat.isDirectory()) {
      if (!recursive) {
        throw new Error(`EISDIR: is a directory, cp '${virtualSource}'`);
      }
      let destination = this.resolveAndValidate(
        destinationReal,
        virtualDestination,
      );
      await fs.promises.mkdir(destination, { recursive: true });
      // A pre-existing child symlink, or a parent swap during mkdir, must not
      // redirect subsequent recursive entries outside the sandbox.
      destination = this.resolveAndValidate(
        destinationReal,
        virtualDestination,
      );
      for (const entry of await fs.promises.readdir(source)) {
        await this.copyTreeEntry(
          nodePath.join(source, entry),
          nodePath.join(destinationReal, entry),
          nodePath.join(virtualSource, entry),
          nodePath.join(virtualDestination, entry),
          true,
        );
      }
      await fs.promises.chmod(destination, stat.mode & 0o7777);
      return;
    }
    throw new Error(`EINVAL: unsupported file type, cp '${virtualSource}'`);
  }

  private async assertCopyDestinationWritable(
    destination: string,
    virtualDestination: string,
  ): Promise<fs.Stats | null> {
    let entryStat: fs.Stats;
    try {
      entryStat = await fs.promises.lstat(destination);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    if (!entryStat.isFile()) {
      if (entryStat.isDirectory()) return entryStat;
      throw new Error(
        `EACCES: cannot copy over special file '${virtualDestination}'`,
      );
    }

    const noFollow = this.allowSymlinks ? 0 : fs.constants.O_NOFOLLOW;
    const handle = await fs.promises.open(
      destination,
      fs.constants.O_WRONLY | fs.constants.O_NONBLOCK | noFollow,
    );
    try {
      const openedStat = await handle.stat();
      if (
        !openedStat.isFile() ||
        openedStat.dev !== entryStat.dev ||
        openedStat.ino !== entryStat.ino
      ) {
        throw new Error(
          `EACCES: destination changed, cp '${virtualDestination}'`,
        );
      }
    } finally {
      await handle.close();
    }
    return entryStat;
  }

  private async replaceSymlink(
    destinationReal: string,
    virtualDestination: string,
    target: string,
  ): Promise<void> {
    const destination = this.validateParent(
      destinationReal,
      virtualDestination,
    );
    const virtualDir = nodePath.dirname(normalizePath(virtualDestination));
    let tempVirtual = "";
    let tempReal = "";
    let tempCanonical = "";
    let tempIdentity: fs.Stats | null = null;

    for (let attempts = 0; attempts < 16; attempts++) {
      const tempName = `.just-bash-copy-link-${this.randomTransactionToken()}`;
      tempVirtual =
        virtualDir === "/" ? `/${tempName}` : `${virtualDir}/${tempName}`;
      tempReal = this.toRealPath(tempVirtual);
      try {
        await this.symlinkUnlocked(target, tempVirtual);
        tempCanonical = this.validateParent(tempReal, tempVirtual);
        tempIdentity = await fs.promises.lstat(tempCanonical);
        break;
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code !== "EEXIST" && !err.message.startsWith("EEXIST:")) {
          throw e;
        }
      }
    }
    if (!tempIdentity) {
      throw new Error(`EEXIST: replacement symlink '${virtualDestination}'`);
    }

    let committed = false;
    try {
      const stagedIdentity = await fs.promises.lstat(tempCanonical);
      if (
        !stagedIdentity.isSymbolicLink() ||
        stagedIdentity.dev !== tempIdentity.dev ||
        stagedIdentity.ino !== tempIdentity.ino
      ) {
        throw new Error("EACCES: replacement symlink entry changed");
      }
      await fs.promises.rename(tempCanonical, destination);
      committed = true;
    } finally {
      if (!committed && tempCanonical) {
        await fs.promises.rm(tempCanonical, { force: true }).catch(() => {});
      }
    }
  }

  private async toVirtualAbsoluteSymlinkTarget(
    rawTarget: string,
    virtualSource: string,
  ): Promise<string> {
    const resolvedTarget = nodePath.resolve(rawTarget);
    const canonicalTarget = await fs.promises.realpath(resolvedTarget);
    const canonicalTargetParent = await fs.promises.realpath(
      nodePath.dirname(resolvedTarget),
    );
    const preservedTarget = nodePath.join(
      canonicalTargetParent,
      nodePath.basename(resolvedTarget),
    );
    if (
      !isPathWithinRoot(canonicalTarget, this.canonicalRoot) ||
      !isPathWithinRoot(preservedTarget, this.canonicalRoot)
    ) {
      throw new Error(
        `EACCES: permission denied, cp '${virtualSource}' contains an unsafe symlink`,
      );
    }
    const relative = preservedTarget.slice(this.canonicalRoot.length);
    return relative || "/";
  }

  private async preflightCopyTree(
    source: string,
    virtualSource: string,
    visited = new Set<string>(),
  ): Promise<void> {
    const stat = await fs.promises.lstat(source);
    const identity = `${stat.dev}:${stat.ino}`;
    if (visited.has(identity)) {
      throw new Error(`ELOOP: cp '${virtualSource}' contains a cycle`);
    }
    if (stat.isSymbolicLink()) {
      if (!this.allowSymlinks) {
        throw new Error(
          `EACCES: permission denied, cp '${virtualSource}' contains a symlink`,
        );
      }
      const resolved = await fs.promises.realpath(source);
      if (!isPathWithinRoot(resolved, this.canonicalRoot)) {
        throw new Error(
          `EACCES: permission denied, cp '${virtualSource}' contains an unsafe symlink`,
        );
      }
      return;
    }
    if (!stat.isDirectory()) return;
    visited.add(identity);
    try {
      const entries = await fs.promises.readdir(source);
      for (const entry of entries) {
        await this.preflightCopyTree(
          nodePath.join(source, entry),
          nodePath.join(virtualSource, entry),
          visited,
        );
      }
    } finally {
      visited.delete(identity);
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.withFilesystemMutation(() => this.mvUnlocked(src, dest));
  }

  private async mvUnlocked(src: string, dest: string): Promise<void> {
    validatePath(src, "mv");
    validatePath(dest, "mv");
    const srcReal = this.toRealPath(src);
    const destReal = this.toRealPath(dest);
    // Use validateParent (not resolveAndValidate) because rename() operates on
    // directory entries — it does NOT follow the final symlink component.
    // resolveAndValidate would resolve through symlinks, breaking symlink moves.
    const srcCanonical = this.validateParent(srcReal, src);
    const destCanonical = this.validateParent(destReal, dest);
    let sourceStat: fs.Stats;
    try {
      sourceStat = await fs.promises.lstat(srcCanonical);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, mv '${src}'`);
      }
      this.sanitizeError(e, src, "mv");
    }
    if (
      sourceStat.isDirectory() &&
      this.isSameOrDescendantIdentity(srcCanonical, destCanonical)
    ) {
      throw new Error(`EINVAL: cannot move '${src}' into itself, '${dest}'`);
    }

    // Check if source is a symlink - if so, validate that its target
    // will still be valid after the move (prevents mv+symlink escape)
    try {
      if (sourceStat.isSymbolicLink()) {
        const target = await fs.promises.readlink(srcCanonical);
        // Resolve the target relative to the destination location
        const resolvedTarget = nodePath.resolve(
          nodePath.dirname(destCanonical),
          target,
        );
        const canonicalTarget = await fs.promises
          .realpath(resolvedTarget)
          .catch(() => resolvedTarget);
        if (!isPathWithinRoot(canonicalTarget, this.canonicalRoot)) {
          throw new Error(
            `EACCES: permission denied, mv '${src}' -> '${dest}' would create symlink escaping sandbox`,
          );
        }
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, mv '${src}'`);
      }
      if (
        err.message?.includes("EACCES") ||
        err.message?.includes("escaping sandbox")
      ) {
        throw e;
      }
      // For other errors, let the rename below handle it
    }

    // Ensure destination parent directory exists
    const destDir = nodePath.dirname(destCanonical);
    try {
      await fs.promises.mkdir(destDir, { recursive: true });
    } catch (e) {
      this.sanitizeError(e, dest, "mv");
    }

    try {
      await fs.promises.rename(srcCanonical, destCanonical);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, mv '${src}'`);
      }
      // If rename fails across devices, fall back to copy + delete
      if (err.code === "EXDEV") {
        await this.moveAcrossDevices(src, dest);
        return;
      }
      this.sanitizeError(e, src, "mv");
    }

    // Fix 2: After a successful directory rename, recursively scan the
    // destination for symlinks that now escape the sandbox. If any are found,
    // undo the move to prevent the escape.
    try {
      const destStat = fs.lstatSync(destCanonical);
      if (destStat.isDirectory()) {
        const escaping = this.findEscapingSymlinks(destCanonical);
        if (escaping.length > 0) {
          // Undo the move
          await fs.promises.rename(destCanonical, srcCanonical);
          throw new Error(
            `EACCES: permission denied, mv '${src}' -> '${dest}' would create symlinks escaping sandbox`,
          );
        }
      }
    } catch (e) {
      if (
        (e as Error).message?.includes("EACCES") ||
        (e as Error).message?.includes("escaping sandbox")
      ) {
        throw e;
      }
      // A scan failure cannot be treated as proof that the moved tree is safe.
      await fs.promises.rename(destCanonical, srcCanonical).catch(() => {});
      this.sanitizeError(e, dest, "mv");
    }
  }

  /** Compare canonical path identity, not user-visible lexical spelling. */
  private isSameOrDescendantIdentity(
    srcReal: string,
    destReal: string,
  ): boolean {
    let canonicalSource = srcReal;
    let canonicalDestination = destReal;
    try {
      canonicalSource = fs.realpathSync(srcReal);
    } catch {
      // The caller's lstat reports the useful virtual-path error.
    }
    try {
      canonicalDestination = fs.realpathSync(destReal);
    } catch {
      try {
        const canonicalParent = fs.realpathSync(nodePath.dirname(destReal));
        canonicalDestination = nodePath.join(
          canonicalParent,
          nodePath.basename(destReal),
        );
      } catch {
        // validateParent already supplied the best canonical destination.
      }
    }
    return isPathWithinRoot(canonicalDestination, canonicalSource);
  }

  private async uniqueTransactionPath(
    path: string,
    purpose: "stage" | "backup" | "source",
  ): Promise<string> {
    const parent = nodePath.posix.dirname(path);
    for (let attempts = 0; attempts < 16; attempts++) {
      const candidate = nodePath.posix.join(
        parent,
        `.just-bash-mv-${purpose}-${this.randomTransactionToken()}`,
      );
      if (!(await this.exists(candidate))) return candidate;
    }
    throw new Error(`EEXIST: mv '${path}'`);
  }

  /**
   * Transactional EXDEV fallback. The destination is assembled under a hidden
   * sibling, then committed by rename. Source removal is also staged by rename,
   * so failures can restore both visible names without claiming atomicity.
   */
  private async moveAcrossDevices(src: string, dest: string): Promise<void> {
    const stage = await this.uniqueTransactionPath(dest, "stage");
    const backup = await this.uniqueTransactionPath(dest, "backup");
    const sourceTombstone = await this.uniqueTransactionPath(src, "source");
    const stageReal = this.validateParent(this.toRealPath(stage), stage);
    const backupReal = this.validateParent(this.toRealPath(backup), backup);
    const sourceReal = this.validateParent(this.toRealPath(src), src);
    const sourceTombstoneReal = this.validateParent(
      this.toRealPath(sourceTombstone),
      sourceTombstone,
    );
    const destReal = this.validateParent(this.toRealPath(dest), dest);
    let destinationBackedUp = false;
    let destinationCommitted = false;
    let sourceStaged = false;

    const rollback = async (): Promise<void> => {
      if (sourceStaged) {
        await fs.promises
          .rename(sourceTombstoneReal, sourceReal)
          .catch(() => {});
      }
      if (destinationCommitted) {
        await fs.promises
          .rm(destReal, { recursive: true, force: true })
          .catch(() => {});
      }
      if (destinationBackedUp) {
        await fs.promises.rename(backupReal, destReal).catch(() => {});
      }
      await fs.promises
        .rm(stageReal, { recursive: true, force: true })
        .catch(() => {});
    };

    try {
      // cp performs the complete traversal and symlink policy checks before any
      // visible destination name is changed.
      await this.cpUnlocked(src, stage, { recursive: true });
      const stagedStat = await fs.promises.lstat(stageReal);
      if (
        stagedStat.isDirectory() &&
        this.findEscapingSymlinks(stageReal).length > 0
      ) {
        throw new Error(
          `EACCES: permission denied, mv '${src}' -> '${dest}' would create symlinks escaping sandbox`,
        );
      }
      try {
        await fs.promises.rename(destReal, backupReal);
        destinationBackedUp = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await fs.promises.rename(stageReal, destReal);
      destinationCommitted = true;
      await fs.promises.rename(sourceReal, sourceTombstoneReal);
      sourceStaged = true;
      await fs.promises.rm(sourceTombstoneReal, {
        recursive: true,
        force: false,
      });
      sourceStaged = false;
      if (destinationBackedUp) {
        // The move is fully committed once the source tombstone is gone.
        // Backup cleanup cannot be allowed to roll back the only remaining
        // complete copy, so treat failure here as non-fatal garbage collection.
        await fs.promises
          .rm(backupReal, { recursive: true, force: true })
          .catch(() => {});
      }
    } catch (e) {
      await rollback();
      this.sanitizeError(e, src, "mv");
    }
  }

  resolvePath(base: string, path: string): string {
    return resolveVPath(base, path);
  }

  getAllPaths(): string[] {
    // Recursively scan the filesystem
    const paths: string[] = [];
    this.scanDir("/", paths);
    return paths;
  }

  private sanitizeError(
    e: unknown,
    virtualPath: string,
    operation: string,
  ): never {
    sanitizeFsError(e, virtualPath, operation, RW_PASSTHROUGH_ERRORS);
  }

  /**
   * Recursively scan a directory for symlinks whose targets escape the sandbox.
   * Returns an array of paths (real OS paths) for any escaping symlinks found.
   */
  private findEscapingSymlinks(dir: string): string[] {
    const escaping: string[] = [];
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const entryPath = nodePath.join(dir, entry);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(entryPath);
        const resolvedTarget = nodePath.resolve(dir, target);
        let canonicalTarget: string;
        try {
          canonicalTarget = fs.realpathSync(resolvedTarget);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          canonicalTarget = resolvedTarget;
        }
        if (!isPathWithinRoot(canonicalTarget, this.canonicalRoot)) {
          escaping.push(entryPath);
        }
      } else if (stat.isDirectory()) {
        escaping.push(...this.findEscapingSymlinks(entryPath));
      }
    }
    return escaping;
  }

  private scanDir(virtualDir: string, paths: string[]): void {
    const realPath = this.toRealPath(virtualDir);

    // Validate through the gate to ensure we don't follow symlinks or
    // escape the sandbox root.  resolveAndValidate returns the canonical
    // path, closing the TOCTOU gap between validation and readdirSync.
    let canonical: string;
    try {
      canonical = this.resolveAndValidate(realPath, virtualDir);
    } catch {
      return; // path escapes sandbox or doesn't exist
    }

    try {
      const entries = fs.readdirSync(canonical);
      for (const entry of entries) {
        const virtualPath =
          virtualDir === "/" ? `/${entry}` : `${virtualDir}/${entry}`;
        paths.push(virtualPath);

        const entryRealPath = nodePath.join(canonical, entry);
        // Use lstatSync to avoid following OS symlinks that could point
        // outside the sandbox root. Symlinks are listed but not traversed.
        const stat = fs.lstatSync(entryRealPath);
        if (stat.isDirectory()) {
          this.scanDir(virtualPath, paths);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.withFilesystemMutation(() => this.chmodUnlocked(path, mode));
  }

  private async chmodUnlocked(path: string, mode: number): Promise<void> {
    validatePath(path, "chmod");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);

    try {
      const initialStat = await fs.promises.lstat(canonical);
      // Copy-on-write is meaningful only for regular files. Opening a FIFO
      // for reading can block indefinitely, and replacing any special inode
      // would silently change its file type.
      if (!initialStat.isFile()) {
        if (!initialStat.isDirectory() && initialStat.nlink > 1) {
          throw new Error(
            `EACCES: cannot chmod multiply-linked special file '${path}'`,
          );
        }
        // Path-based metadata calls preserve directory and special-file
        // permission semantics. They are not atomic against direct host path
        // replacement, which is outside ReadWriteFs's trusted-host boundary.
        await fs.promises.chmod(canonical, mode);
        return;
      }
      if (initialStat.nlink <= 1) {
        // See the trusted-host concurrency limitation documented above.
        await fs.promises.chmod(canonical, mode);
        return;
      }
      this.assertCopyOnWriteSize(initialStat.size, "chmod", path);

      const source = await this.openCopySource(canonical);
      try {
        const stat = await source.stat();
        if (!stat.isFile()) {
          throw new Error(`EACCES: file type changed, chmod '${path}'`);
        }
        await this.replaceFile(
          canonical,
          new Uint8Array(0),
          { mode, atime: stat.atime, mtime: stat.mtime },
          { handle: source, size: stat.size },
          { atime: stat.atime, mtime: stat.mtime },
          true,
        );
      } finally {
        await source.close();
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, chmod '${path}'`);
      }
      if (err.code === "ELOOP") {
        throw new Error(`EACCES: permission denied, '${path}' is a symlink`);
      }
      this.sanitizeError(e, path, "chmod");
    }
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    await this.withFilesystemMutation(() =>
      this.symlinkUnlocked(target, linkPath),
    );
  }

  private async symlinkUnlocked(
    target: string,
    linkPath: string,
  ): Promise<void> {
    if (!this.allowSymlinks) {
      throw new Error(`EPERM: operation not permitted, symlink '${linkPath}'`);
    }
    validatePath(linkPath, "symlink");
    const realLinkPath = this.toRealPath(linkPath);
    // Validate that the link path's parent stays within sandbox
    // (prevents creating symlinks outside via pre-existing OS symlinks in parent path)
    const canonicalLinkPath = this.validateParent(realLinkPath, linkPath);

    // Validate and transform symlink target to prevent sandbox escape.
    // Resolve the target: if absolute, treat as virtual path; if relative, resolve from link's dir
    const normalizedLinkPath = normalizePath(linkPath);
    const linkDir = normalizePath(nodePath.dirname(normalizedLinkPath));
    const resolvedVirtualTarget = target.startsWith("/")
      ? normalizePath(target)
      : normalizePath(linkDir === "/" ? `/${target}` : `${linkDir}/${target}`);

    // Convert to real path - this is where the symlink should actually point.
    // Use canonicalRoot (not this.root) so the relative path computation is
    // consistent with the canonical link directory (avoids /tmp vs /private/tmp mismatch).
    const resolvedRealTarget = nodePath.join(
      this.canonicalRoot,
      resolvedVirtualTarget,
    );

    // For relative symlinks, compute the correct relative path from link to target within root
    // For absolute symlinks, use the absolute path within root
    const canonicalLinkDir = nodePath.dirname(canonicalLinkPath);
    const safeTarget = target.startsWith("/")
      ? resolvedRealTarget
      : nodePath.relative(canonicalLinkDir, resolvedRealTarget) || ".";

    try {
      await fs.promises.symlink(safeTarget, canonicalLinkPath);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EEXIST") {
        throw new Error(`EEXIST: file already exists, symlink '${linkPath}'`);
      }
      this.sanitizeError(e, linkPath, "symlink");
    }
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    await this.withFilesystemMutation(() =>
      this.linkUnlocked(existingPath, newPath),
    );
  }

  private async linkUnlocked(
    existingPath: string,
    newPath: string,
  ): Promise<void> {
    validatePath(existingPath, "link");
    validatePath(newPath, "link");
    const realExisting = this.toRealPath(existingPath);
    const realNew = this.toRealPath(newPath);
    const canonicalExisting = this.resolveAndValidate(
      realExisting,
      existingPath,
    );
    // link creates the final directory entry and must not follow a dangling
    // symlink already occupying that name.
    const canonicalNew =
      realNew === this.root
        ? this.resolveAndValidate(realNew, newPath)
        : this.validateParent(realNew, newPath);

    try {
      await fs.promises.link(canonicalExisting, canonicalNew);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(
          `ENOENT: no such file or directory, link '${existingPath}'`,
        );
      }
      if (err.code === "EEXIST") {
        throw new Error(`EEXIST: file already exists, link '${newPath}'`);
      }
      if (err.code === "EPERM") {
        throw new Error(
          `EPERM: operation not permitted, link '${existingPath}'`,
        );
      }
      this.sanitizeError(e, existingPath, "link");
    }
  }

  async readlink(path: string): Promise<string> {
    validatePath(path, "readlink");
    const realPath = this.toRealPath(path);
    const canonical = this.validateParent(realPath, path);

    try {
      const rawTarget = await fs.promises.readlink(canonical);

      // Convert the raw OS target to a virtual path to prevent
      // leaking real filesystem paths outside the sandbox.
      const normalizedVirtual = normalizePath(path);
      const linkDir = nodePath.dirname(normalizedVirtual);

      // Resolve the raw target to an absolute real path
      const resolvedRealTarget = nodePath.isAbsolute(rawTarget)
        ? rawTarget
        : nodePath.resolve(nodePath.dirname(canonical), rawTarget);
      const canonicalTarget = await fs.promises
        .realpath(resolvedRealTarget)
        .catch(() => resolvedRealTarget);

      if (isPathWithinRoot(canonicalTarget, this.canonicalRoot)) {
        // Within root - compute virtual target path and return as relative
        const virtualTarget =
          canonicalTarget.slice(this.canonicalRoot.length) || "/";
        // Return as relative path from the link's virtual directory
        if (linkDir === "/") {
          return virtualTarget.startsWith("/")
            ? virtualTarget.slice(1) || "."
            : virtualTarget;
        }
        return nodePath.relative(linkDir, virtualTarget);
      }

      // Outside root - the symlink target points outside the sandbox.
      // For symlinks created through our API, targets are sanitized. But
      // pre-existing OS symlinks (e.g., in a malicious git repo) may have
      // unsanitized targets. Return just the basename for both absolute and
      // relative targets to avoid leaking path structure information.
      // (A relative target like "../../../etc/passwd" would reveal sandbox depth.)
      return nodePath.basename(rawTarget);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(
          `ENOENT: no such file or directory, readlink '${path}'`,
        );
      }
      if (err.code === "EINVAL") {
        throw new Error(`EINVAL: invalid argument, readlink '${path}'`);
      }
      this.sanitizeError(e, path, "readlink");
    }
  }

  /**
   * Resolve all symlinks in a path to get the canonical physical path.
   * This is equivalent to POSIX realpath().
   */
  async realpath(path: string): Promise<string> {
    validatePath(path, "realpath");
    const realPath = this.toRealPath(path);

    // Validate the path respects the symlink policy before resolving.
    // Without this, realpath() would follow symlinks that other methods
    // (readFile, stat, etc.) correctly reject via resolveAndValidate().
    // Convert EACCES to ENOENT because realpath semantically "doesn't find"
    // the canonical path rather than "denies access".
    try {
      this.resolveAndValidate(realPath, path);
    } catch {
      throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
    }

    let resolved: string;
    try {
      resolved = await fs.promises.realpath(realPath);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(
          `ENOENT: no such file or directory, realpath '${path}'`,
        );
      }
      if (err.code === "ELOOP") {
        throw new Error(
          `ELOOP: too many levels of symbolic links, realpath '${path}'`,
        );
      }
      this.sanitizeError(e, path, "realpath");
    }

    // Convert back to virtual path (relative to root)
    // Use canonicalRoot (computed at construction) for consistent comparison
    // with resolveAndValidate. Use boundary-safe prefix check to prevent
    // /data matching /datastore.
    if (isPathWithinRoot(resolved, this.canonicalRoot)) {
      const relative = resolved.slice(this.canonicalRoot.length);
      return relative || "/";
    }
    // Resolved path is outside root - reject it to prevent sandbox escape
    throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
  }

  /**
   * Set access and modification times of a file
   * @param path - The file path
   * @param atime - Access time
   * @param mtime - Modification time
   */
  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    await this.withFilesystemMutation(() =>
      this.utimesUnlocked(path, atime, mtime),
    );
  }

  private async utimesUnlocked(
    path: string,
    atime: Date,
    mtime: Date,
  ): Promise<void> {
    validatePath(path, "utimes");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);

    try {
      const initialStat = await fs.promises.lstat(canonical);
      if (!initialStat.isFile()) {
        if (!initialStat.isDirectory() && initialStat.nlink > 1) {
          throw new Error(
            `EACCES: cannot change times on multiply-linked special file '${path}'`,
          );
        }
        // Path-based metadata calls preserve directory and special-file
        // permission semantics. They are not atomic against direct host path
        // replacement, which is outside ReadWriteFs's trusted-host boundary.
        await fs.promises.utimes(canonical, atime, mtime);
        return;
      }
      if (initialStat.nlink <= 1) {
        // See the trusted-host concurrency limitation documented above.
        await fs.promises.utimes(canonical, atime, mtime);
        return;
      }
      this.assertCopyOnWriteSize(initialStat.size, "utimes", path);

      const source = await this.openCopySource(canonical);
      try {
        const stat = await source.stat();
        if (!stat.isFile()) {
          throw new Error(`EACCES: file type changed, utimes '${path}'`);
        }
        await this.replaceFile(
          canonical,
          new Uint8Array(0),
          stat,
          { handle: source, size: stat.size },
          { atime, mtime },
          true,
        );
      } finally {
        await source.close();
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, utimes '${path}'`);
      }
      if (err.code === "ELOOP") {
        throw new Error(`EACCES: permission denied, '${path}' is a symlink`);
      }
      this.sanitizeError(e, path, "utimes");
    }
  }
}

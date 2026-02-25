/**
 * ReadWriteFs - Direct wrapper around the real filesystem
 *
 * All operations go directly to the underlying Node.js filesystem.
 * Paths are relative to the configured root directory.
 *
 * Security: Symlink targets are validated and transformed to stay within root,
 * preventing symlink-based sandbox escape attacks.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import {
  type FileContent,
  fromBuffer,
  getEncoding,
  toBuffer,
} from "../encoding.js";
import type {
  CpOptions,
  DirentEntry,
  FsStat,
  IFileSystem,
  MkdirOptions,
  ReadFileOptions,
  RmOptions,
  WriteFileOptions,
} from "../interface.js";

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
}

export class ReadWriteFs implements IFileSystem {
  private readonly root: string;
  private readonly canonicalRoot: string;
  private readonly maxFileReadSize: number;

  constructor(options: ReadWriteFsOptions) {
    this.root = nodePath.resolve(options.root);
    this.maxFileReadSize = options.maxFileReadSize ?? 10485760;

    // Verify root exists and is a directory
    if (!fs.existsSync(this.root)) {
      throw new Error(`ReadWriteFs root does not exist: ${this.root}`);
    }
    const stat = fs.statSync(this.root);
    if (!stat.isDirectory()) {
      throw new Error(`ReadWriteFs root is not a directory: ${this.root}`);
    }

    // Compute canonical root (resolves symlinks like /var -> /private/var on macOS)
    this.canonicalRoot = fs.realpathSync(this.root);
  }

  /**
   * Validate that a resolved real path stays within the sandbox root.
   * Resolves all symlinks to detect escape attempts via OS-level symlinks.
   * Throws EACCES if the path escapes the root.
   */
  private async resolveAndValidate(
    realPath: string,
    virtualPath: string,
  ): Promise<void> {
    try {
      const resolved = await fs.promises.realpath(realPath);
      if (
        resolved !== this.canonicalRoot &&
        !resolved.startsWith(`${this.canonicalRoot}/`)
      ) {
        throw new Error(
          `EACCES: permission denied, '${virtualPath}' resolves outside sandbox`,
        );
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        // File doesn't exist yet (e.g., new file being created).
        // Validate the parent directory instead.
        const parent = nodePath.dirname(realPath);
        if (parent === realPath) {
          // Reached filesystem root without finding a valid parent
          throw new Error(
            `EACCES: permission denied, '${virtualPath}' resolves outside sandbox`,
          );
        }
        await this.resolveAndValidate(parent, virtualPath);
      } else if (
        err.message?.includes("EACCES") ||
        err.message?.includes("resolves outside sandbox")
      ) {
        throw e;
      } else {
        throw e;
      }
    }
  }

  /**
   * Validate the parent directory of a path (for operations like lstat/readlink
   * that should not follow the final component's symlink).
   */
  private async validateParent(
    realPath: string,
    virtualPath: string,
  ): Promise<void> {
    const parent = nodePath.dirname(realPath);
    await this.resolveAndValidate(parent, virtualPath);
  }

  /**
   * Convert a virtual path to a real filesystem path.
   */
  private toRealPath(virtualPath: string): string {
    const normalized = this.normalizePath(virtualPath);
    const realPath = nodePath.join(this.root, normalized);
    return nodePath.resolve(realPath);
  }

  /**
   * Normalize a virtual path (resolve . and .., ensure starts with /)
   */
  private normalizePath(path: string): string {
    if (!path || path === "/") return "/";

    let normalized =
      path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;

    if (!normalized.startsWith("/")) {
      normalized = `/${normalized}`;
    }

    const parts = normalized.split("/").filter((p) => p && p !== ".");
    const resolved: string[] = [];

    for (const part of parts) {
      if (part === "..") {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }

    return `/${resolved.join("/")}` || "/";
  }

  async readFile(
    path: string,
    options?: ReadFileOptions | BufferEncoding,
  ): Promise<string> {
    const buffer = await this.readFileBuffer(path);
    const encoding = getEncoding(options);
    return fromBuffer(buffer, encoding);
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const realPath = this.toRealPath(path);
    await this.resolveAndValidate(realPath, path);

    try {
      if (this.maxFileReadSize > 0) {
        // Use stat (not lstat) so that symlinks resolve to the target's actual
        // size. lstat would return the symlink's target path length, bypassing
        // the size limit for symlinks pointing to large files.
        // resolveAndValidate already confirmed the resolved path is within sandbox.
        const stat = await fs.promises.stat(realPath);
        if (stat.size > this.maxFileReadSize) {
          throw new Error(
            `EFBIG: file too large, read '${path}' (${stat.size} bytes, max ${this.maxFileReadSize})`,
          );
        }
      }
      const content = await fs.promises.readFile(realPath);
      return new Uint8Array(content);
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
      throw e;
    }
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    const realPath = this.toRealPath(path);
    await this.resolveAndValidate(realPath, path);
    const encoding = getEncoding(options);
    const buffer = toBuffer(content, encoding);

    // Ensure parent directory exists
    const dir = nodePath.dirname(realPath);
    await fs.promises.mkdir(dir, { recursive: true });

    await fs.promises.writeFile(realPath, buffer);
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    const realPath = this.toRealPath(path);
    await this.resolveAndValidate(realPath, path);
    const encoding = getEncoding(options);
    const buffer = toBuffer(content, encoding);

    // Ensure parent directory exists
    const dir = nodePath.dirname(realPath);
    await fs.promises.mkdir(dir, { recursive: true });

    await fs.promises.appendFile(realPath, buffer);
  }

  async exists(path: string): Promise<boolean> {
    const realPath = this.toRealPath(path);
    try {
      await this.resolveAndValidate(realPath, path);
      await fs.promises.access(realPath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FsStat> {
    const realPath = this.toRealPath(path);
    await this.resolveAndValidate(realPath, path);

    try {
      const stat = await fs.promises.stat(realPath);
      return {
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymbolicLink: false, // stat follows symlinks
        mode: stat.mode,
        size: stat.size,
        mtime: stat.mtime,
      };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
      }
      throw e;
    }
  }

  async lstat(path: string): Promise<FsStat> {
    const realPath = this.toRealPath(path);
    await this.validateParent(realPath, path);

    try {
      const stat = await fs.promises.lstat(realPath);
      return {
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymbolicLink: stat.isSymbolicLink(),
        mode: stat.mode,
        size: stat.size,
        mtime: stat.mtime,
      };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, lstat '${path}'`);
      }
      throw e;
    }
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const realPath = this.toRealPath(path);
    await this.resolveAndValidate(realPath, path);

    try {
      await fs.promises.mkdir(realPath, { recursive: options?.recursive });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EEXIST") {
        throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
      }
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
      }
      throw e;
    }
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.readdirWithFileTypes(path);
    return entries.map((e) => e.name);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const realPath = this.toRealPath(path);
    await this.resolveAndValidate(realPath, path);

    try {
      const entries = await fs.promises.readdir(realPath, {
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
      throw e;
    }
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const realPath = this.toRealPath(path);
    await this.resolveAndValidate(realPath, path);

    try {
      await fs.promises.rm(realPath, {
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
      });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT" && !options?.force) {
        throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
      }
      if (err.code === "ENOTEMPTY") {
        throw new Error(`ENOTEMPTY: directory not empty, rm '${path}'`);
      }
      throw e;
    }
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const srcReal = this.toRealPath(src);
    const destReal = this.toRealPath(dest);
    await this.resolveAndValidate(srcReal, src);
    await this.resolveAndValidate(destReal, dest);

    try {
      await fs.promises.cp(srcReal, destReal, {
        recursive: options?.recursive ?? false,
        // Validate each entry during recursive copy to prevent:
        // 1. Following symlinks that point outside the sandbox
        // 2. Creating raw symlinks that bypass target transformation
        filter: async (source: string) => {
          try {
            const stat = fs.lstatSync(source);
            if (stat.isSymbolicLink()) {
              // Validate the symlink's resolved target stays within sandbox
              const resolved = await fs.promises
                .realpath(source)
                .catch(() => null);
              if (resolved === null) return false;
              return (
                resolved === this.canonicalRoot ||
                resolved.startsWith(`${this.canonicalRoot}/`)
              );
            }
            return true;
          } catch {
            return true;
          }
        },
      });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, cp '${src}'`);
      }
      if (err.code === "EISDIR") {
        throw new Error(`EISDIR: is a directory, cp '${src}'`);
      }
      throw e;
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    const srcReal = this.toRealPath(src);
    const destReal = this.toRealPath(dest);
    await this.resolveAndValidate(srcReal, src);
    await this.resolveAndValidate(destReal, dest);

    // Check if source is a symlink - if so, validate that its target
    // will still be valid after the move (prevents mv+symlink escape)
    try {
      const srcStat = await fs.promises.lstat(srcReal);
      if (srcStat.isSymbolicLink()) {
        const target = await fs.promises.readlink(srcReal);
        // Resolve the target relative to the destination location
        const resolvedTarget = nodePath.resolve(
          nodePath.dirname(destReal),
          target,
        );
        const canonicalTarget = await fs.promises
          .realpath(resolvedTarget)
          .catch(() => resolvedTarget);
        if (
          canonicalTarget !== this.canonicalRoot &&
          !canonicalTarget.startsWith(`${this.canonicalRoot}/`)
        ) {
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
    const destDir = nodePath.dirname(destReal);
    await fs.promises.mkdir(destDir, { recursive: true });

    try {
      await fs.promises.rename(srcReal, destReal);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, mv '${src}'`);
      }
      // If rename fails across devices, fall back to copy + delete
      if (err.code === "EXDEV") {
        await this.cp(src, dest, { recursive: true });
        await this.rm(src, { recursive: true });
        return;
      }
      throw e;
    }
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith("/")) {
      return this.normalizePath(path);
    }
    const combined = base === "/" ? `/${path}` : `${base}/${path}`;
    return this.normalizePath(combined);
  }

  getAllPaths(): string[] {
    // Recursively scan the filesystem
    const paths: string[] = [];
    this.scanDir("/", paths);
    return paths;
  }

  private scanDir(virtualDir: string, paths: string[]): void {
    const realPath = this.toRealPath(virtualDir);

    try {
      const entries = fs.readdirSync(realPath);
      for (const entry of entries) {
        const virtualPath =
          virtualDir === "/" ? `/${entry}` : `${virtualDir}/${entry}`;
        paths.push(virtualPath);

        const entryRealPath = nodePath.join(realPath, entry);
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
    const realPath = this.toRealPath(path);
    await this.resolveAndValidate(realPath, path);

    try {
      await fs.promises.chmod(realPath, mode);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, chmod '${path}'`);
      }
      throw e;
    }
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    const realLinkPath = this.toRealPath(linkPath);
    // Validate that the link path's parent stays within sandbox
    // (prevents creating symlinks outside via pre-existing OS symlinks in parent path)
    await this.validateParent(realLinkPath, linkPath);

    // Validate and transform symlink target to prevent sandbox escape.
    // Resolve the target: if absolute, treat as virtual path; if relative, resolve from link's dir
    const normalizedLinkPath = this.normalizePath(linkPath);
    const linkDir = this.normalizePath(nodePath.dirname(normalizedLinkPath));
    const resolvedVirtualTarget = target.startsWith("/")
      ? this.normalizePath(target)
      : this.normalizePath(
          linkDir === "/" ? `/${target}` : `${linkDir}/${target}`,
        );

    // Convert to real path - this is where the symlink should actually point
    const resolvedRealTarget = nodePath.join(this.root, resolvedVirtualTarget);

    // For relative symlinks, compute the correct relative path from link to target within root
    // For absolute symlinks, use the absolute path within root
    const realLinkDir = nodePath.dirname(realLinkPath);
    const safeTarget = target.startsWith("/")
      ? resolvedRealTarget
      : nodePath.relative(realLinkDir, resolvedRealTarget);

    try {
      await fs.promises.symlink(safeTarget, realLinkPath);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EEXIST") {
        throw new Error(`EEXIST: file already exists, symlink '${linkPath}'`);
      }
      throw e;
    }
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    const realExisting = this.toRealPath(existingPath);
    const realNew = this.toRealPath(newPath);
    await this.resolveAndValidate(realExisting, existingPath);
    await this.resolveAndValidate(realNew, newPath);

    try {
      await fs.promises.link(realExisting, realNew);
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
      throw e;
    }
  }

  async readlink(path: string): Promise<string> {
    const realPath = this.toRealPath(path);
    await this.validateParent(realPath, path);

    try {
      const rawTarget = await fs.promises.readlink(realPath);

      // Convert the raw OS target to a virtual path to prevent
      // leaking real filesystem paths outside the sandbox.
      const normalizedVirtual = this.normalizePath(path);
      const linkDir = nodePath.dirname(normalizedVirtual);

      // Resolve the raw target to an absolute real path
      const resolvedRealTarget = nodePath.isAbsolute(rawTarget)
        ? rawTarget
        : nodePath.resolve(nodePath.dirname(realPath), rawTarget);
      const canonicalTarget = await fs.promises
        .realpath(resolvedRealTarget)
        .catch(() => resolvedRealTarget);

      if (
        canonicalTarget === this.canonicalRoot ||
        canonicalTarget.startsWith(`${this.canonicalRoot}/`)
      ) {
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
      // unsanitized targets. Return a relative version of the raw target
      // to avoid leaking real OS paths, but only if it's relative.
      // For absolute targets, return just the basename to avoid path leaks.
      if (nodePath.isAbsolute(rawTarget)) {
        return nodePath.basename(rawTarget);
      }
      return rawTarget;
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
      throw e;
    }
  }

  /**
   * Resolve all symlinks in a path to get the canonical physical path.
   * This is equivalent to POSIX realpath().
   */
  async realpath(path: string): Promise<string> {
    const realPath = this.toRealPath(path);

    try {
      const resolved = await fs.promises.realpath(realPath);
      // Convert back to virtual path (relative to root)
      // Use canonicalRoot (computed at construction) for consistent comparison
      // with resolveAndValidate. Use boundary-safe prefix check to prevent
      // /data matching /datastore.
      if (
        resolved === this.canonicalRoot ||
        resolved.startsWith(`${this.canonicalRoot}/`)
      ) {
        const relative = resolved.slice(this.canonicalRoot.length);
        return relative || "/";
      }
      // Resolved path is outside root - reject it to prevent sandbox escape
      throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
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
      throw e;
    }
  }

  /**
   * Set access and modification times of a file
   * @param path - The file path
   * @param atime - Access time
   * @param mtime - Modification time
   */
  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    const realPath = this.toRealPath(path);
    await this.resolveAndValidate(realPath, path);

    try {
      await fs.promises.utimes(realPath, atime, mtime);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, utimes '${path}'`);
      }
      throw e;
    }
  }
}

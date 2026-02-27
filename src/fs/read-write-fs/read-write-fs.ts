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
import {
  isPathWithinRoot,
  normalizePath,
  resolveCanonicalPath,
  resolveCanonicalPathNoSymlinks,
  validatePath,
  validateRootDirectory,
} from "../real-fs-utils.js";

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
   * Whether to allow following and creating symlinks.
   * When false (default), any path traversing a symlink is rejected
   * and symlink() throws EPERM.
   */
  allowSymlinks?: boolean;
}

export class ReadWriteFs implements IFileSystem {
  private readonly root: string;
  private readonly canonicalRoot: string;
  private readonly maxFileReadSize: number;
  private readonly allowSymlinks: boolean;

  constructor(options: ReadWriteFsOptions) {
    this.root = nodePath.resolve(options.root);
    this.maxFileReadSize = options.maxFileReadSize ?? 10485760;
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

  async readFileBuffer(path: string): Promise<Uint8Array> {
    validatePath(path, "open");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);

    try {
      if (this.maxFileReadSize > 0) {
        // Use stat (not lstat) so that symlinks resolve to the target's actual
        // size. lstat would return the symlink's target path length, bypassing
        // the size limit for symlinks pointing to large files.
        // resolveAndValidate already confirmed the resolved path is within sandbox.
        const stat = await fs.promises.stat(canonical);
        if (stat.size > this.maxFileReadSize) {
          throw new Error(
            `EFBIG: file too large, read '${path}' (${stat.size} bytes, max ${this.maxFileReadSize})`,
          );
        }
      }
      const content = await fs.promises.readFile(canonical);
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
      this.sanitizeError(e, path, "open");
    }
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    validatePath(path, "write");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);
    const encoding = getEncoding(options);
    const buffer = toBuffer(content, encoding);

    // Ensure parent directory exists
    const dir = nodePath.dirname(canonical);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(canonical, buffer);
    } catch (e) {
      this.sanitizeError(e, path, "write");
    }
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    validatePath(path, "append");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);
    const encoding = getEncoding(options);
    const buffer = toBuffer(content, encoding);

    // Ensure parent directory exists
    const dir = nodePath.dirname(canonical);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.appendFile(canonical, buffer);
    } catch (e) {
      this.sanitizeError(e, path, "append");
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
      const stat = await fs.promises.stat(canonical);
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
    validatePath(path, "mkdir");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);

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
    validatePath(path, "rm");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);

    try {
      await fs.promises.rm(canonical, {
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
      this.sanitizeError(e, path, "rm");
    }
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    validatePath(src, "cp");
    validatePath(dest, "cp");
    const srcReal = this.toRealPath(src);
    const destReal = this.toRealPath(dest);
    const srcCanonical = this.resolveAndValidate(srcReal, src);
    const destCanonical = this.resolveAndValidate(destReal, dest);

    try {
      await fs.promises.cp(srcCanonical, destCanonical, {
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
              return isPathWithinRoot(resolved, this.canonicalRoot);
            }
            return true;
          } catch (filterErr) {
            // ENOENT: file disappeared between readdir and filter — let cp
            // handle the error naturally (it will throw or skip as expected).
            if ((filterErr as NodeJS.ErrnoException).code === "ENOENT") {
              return true;
            }
            // Other errors (EPERM, EIO, etc.): fail-closed — skip the entry
            // since we can't determine if it's an escaping symlink.
            return false;
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
      this.sanitizeError(e, src, "cp");
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    validatePath(src, "mv");
    validatePath(dest, "mv");
    const srcReal = this.toRealPath(src);
    const destReal = this.toRealPath(dest);
    // Use validateParent (not resolveAndValidate) because rename() operates on
    // directory entries — it does NOT follow the final symlink component.
    // resolveAndValidate would resolve through symlinks, breaking symlink moves.
    const srcCanonical = this.validateParent(srcReal, src);
    const destCanonical = this.validateParent(destReal, dest);

    // Check if source is a symlink - if so, validate that its target
    // will still be valid after the move (prevents mv+symlink escape)
    try {
      const srcStat = await fs.promises.lstat(srcCanonical);
      if (srcStat.isSymbolicLink()) {
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
        await this.cp(src, dest, { recursive: true });
        await this.rm(src, { recursive: true });
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
      // Ignore stat errors (e.g., dest is a file not a directory)
    }
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith("/")) {
      return normalizePath(path);
    }
    const combined = base === "/" ? `/${path}` : `${base}/${path}`;
    return normalizePath(combined);
  }

  getAllPaths(): string[] {
    // Recursively scan the filesystem
    const paths: string[] = [];
    this.scanDir("/", paths);
    return paths;
  }

  /**
   * Sanitize an error to prevent leaking real OS paths in error messages.
   * Replaces the original error with one containing only the virtual path.
   */
  private sanitizeError(
    e: unknown,
    virtualPath: string,
    operation: string,
  ): never {
    const err = e as NodeJS.ErrnoException;
    // Node.js ErrnoException objects from fs.promises have a .path property
    // containing the real OS path. Never pass these through — always sanitize.
    // Our own errors (constructed with new Error(...)) don't have .path.
    // Use strict === undefined check (not !err.path) so that an error with
    // .path = "" (empty string) is still sanitized rather than passed through.
    if (err.path === undefined) {
      if (
        err.message?.includes("EACCES") ||
        err.message?.includes("escaping sandbox") ||
        err.message?.includes("EFBIG")
      ) {
        // Our own errors with virtual paths — rethrow as-is
        throw e;
      }
    }
    const code = err.code || "EIO";
    throw new Error(`${code}: ${operation} '${virtualPath}'`);
  }

  /**
   * Recursively scan a directory for symlinks whose targets escape the sandbox.
   * Returns an array of paths (real OS paths) for any escaping symlinks found.
   */
  private findEscapingSymlinks(dir: string): string[] {
    const escaping: string[] = [];
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const entryPath = nodePath.join(dir, entry);
        try {
          const stat = fs.lstatSync(entryPath);
          if (stat.isSymbolicLink()) {
            const target = fs.readlinkSync(entryPath);
            const resolvedTarget = nodePath.resolve(dir, target);
            let canonicalTarget: string;
            try {
              canonicalTarget = fs.realpathSync(resolvedTarget);
            } catch {
              canonicalTarget = resolvedTarget;
            }
            if (!isPathWithinRoot(canonicalTarget, this.canonicalRoot)) {
              escaping.push(entryPath);
            }
          } else if (stat.isDirectory()) {
            escaping.push(...this.findEscapingSymlinks(entryPath));
          }
        } catch {
          // Skip entries we can't stat
        }
      }
    } catch {
      // Skip directories we can't read
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
    validatePath(path, "chmod");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);

    try {
      await fs.promises.chmod(canonical, mode);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, chmod '${path}'`);
      }
      this.sanitizeError(e, path, "chmod");
    }
  }

  async symlink(target: string, linkPath: string): Promise<void> {
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
      : nodePath.relative(canonicalLinkDir, resolvedRealTarget);

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
    validatePath(existingPath, "link");
    validatePath(newPath, "link");
    const realExisting = this.toRealPath(existingPath);
    const realNew = this.toRealPath(newPath);
    const canonicalExisting = this.resolveAndValidate(
      realExisting,
      existingPath,
    );
    const canonicalNew = this.resolveAndValidate(realNew, newPath);

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
    validatePath(path, "utimes");
    const realPath = this.toRealPath(path);
    const canonical = this.resolveAndValidate(realPath, path);

    try {
      await fs.promises.utimes(canonical, atime, mtime);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, utimes '${path}'`);
      }
      this.sanitizeError(e, path, "utimes");
    }
  }
}

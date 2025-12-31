/**
 * OverlayFs - Copy-on-write filesystem backed by a real directory
 *
 * Reads come from the real filesystem, writes go to an in-memory layer.
 * Changes don't persist to disk and can't escape the root directory.
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import type {
  CpOptions,
  FsStat,
  IFileSystem,
  MkdirOptions,
  ReadFileOptions,
  RmOptions,
  WriteFileOptions,
} from "../interface.js";
import {
  type FileContent,
  fromBuffer,
  getEncoding,
  toBuffer,
} from "../utils.js";

interface MemoryFileEntry {
  type: "file";
  content: Uint8Array;
  mode: number;
  mtime: Date;
}

interface MemoryDirEntry {
  type: "directory";
  mode: number;
  mtime: Date;
}

interface MemorySymlinkEntry {
  type: "symlink";
  target: string;
  mode: number;
  mtime: Date;
}

type MemoryEntry = MemoryFileEntry | MemoryDirEntry | MemorySymlinkEntry;

export interface OverlayFsOptions {
  /**
   * The root directory on the real filesystem.
   * All paths are relative to this root and cannot escape it.
   */
  root: string;

  /**
   * The virtual mount point where the root directory appears.
   * Defaults to "/home/user/project".
   */
  mountPoint?: string;

  /**
   * If true, all write operations will throw an error.
   * Useful for truly read-only access to the filesystem.
   * Defaults to false.
   */
  readOnly?: boolean;
}

/** Default mount point for OverlayFs */
const DEFAULT_MOUNT_POINT = "/home/user/project";

export class OverlayFs implements IFileSystem {
  private readonly root: string;
  private readonly mountPoint: string;
  private readonly readOnly: boolean;
  private readonly memory: Map<string, MemoryEntry> = new Map();
  private readonly deleted: Set<string> = new Set();

  constructor(options: OverlayFsOptions) {
    // Resolve to absolute path
    this.root = nodePath.resolve(options.root);

    // Normalize mount point (ensure it starts with / and has no trailing /)
    const mp = options.mountPoint ?? DEFAULT_MOUNT_POINT;
    this.mountPoint = mp === "/" ? "/" : mp.replace(/\/+$/, "");
    if (!this.mountPoint.startsWith("/")) {
      throw new Error(`Mount point must be an absolute path: ${mp}`);
    }

    // Set read-only mode
    this.readOnly = options.readOnly ?? false;

    // Verify root exists and is a directory
    if (!fs.existsSync(this.root)) {
      throw new Error(`OverlayFs root does not exist: ${this.root}`);
    }
    const stat = fs.statSync(this.root);
    if (!stat.isDirectory()) {
      throw new Error(`OverlayFs root is not a directory: ${this.root}`);
    }

    // Create mount point directory structure in memory layer
    this.createMountPointDirs();
  }

  /**
   * Throws an error if the filesystem is in read-only mode.
   */
  private assertWritable(operation: string): void {
    if (this.readOnly) {
      throw new Error(`EROFS: read-only file system, ${operation}`);
    }
  }

  /**
   * Create directory entries for the mount point path
   */
  private createMountPointDirs(): void {
    const parts = this.mountPoint.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      if (!this.memory.has(current)) {
        this.memory.set(current, {
          type: "directory",
          mode: 0o755,
          mtime: new Date(),
        });
      }
    }
    // Also ensure root exists
    if (!this.memory.has("/")) {
      this.memory.set("/", {
        type: "directory",
        mode: 0o755,
        mtime: new Date(),
      });
    }
  }

  /**
   * Get the mount point for this overlay
   */
  getMountPoint(): string {
    return this.mountPoint;
  }

  /**
   * Create a virtual directory in memory (sync, for initialization)
   */
  mkdirSync(path: string, _options?: MkdirOptions): void {
    const normalized = this.normalizePath(path);
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      if (!this.memory.has(current)) {
        this.memory.set(current, {
          type: "directory",
          mode: 0o755,
          mtime: new Date(),
        });
      }
    }
  }

  /**
   * Create a virtual file in memory (sync, for initialization)
   */
  writeFileSync(path: string, content: string | Uint8Array): void {
    const normalized = this.normalizePath(path);
    // Ensure parent directories exist
    const parent = this.getDirname(normalized);
    if (parent !== "/") {
      this.mkdirSync(parent);
    }
    const buffer =
      content instanceof Uint8Array
        ? content
        : new TextEncoder().encode(content);
    this.memory.set(normalized, {
      type: "file",
      content: buffer,
      mode: 0o644,
      mtime: new Date(),
    });
  }

  private getDirname(path: string): string {
    const lastSlash = path.lastIndexOf("/");
    return lastSlash === 0 ? "/" : path.slice(0, lastSlash);
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

  /**
   * Check if a normalized virtual path is under the mount point.
   * Returns the relative path within the mount point, or null if not under it.
   */
  private getRelativeToMount(normalizedPath: string): string | null {
    if (this.mountPoint === "/") {
      // Mount at root - all paths are relative to mount
      return normalizedPath;
    }

    if (normalizedPath === this.mountPoint) {
      return "/";
    }

    if (normalizedPath.startsWith(`${this.mountPoint}/`)) {
      return normalizedPath.slice(this.mountPoint.length);
    }

    return null;
  }

  /**
   * Convert a virtual path to a real filesystem path.
   * Returns null if the path is not under the mount point or would escape the root.
   */
  private toRealPath(virtualPath: string): string | null {
    const normalized = this.normalizePath(virtualPath);

    // Check if path is under the mount point
    const relativePath = this.getRelativeToMount(normalized);
    if (relativePath === null) {
      return null;
    }

    const realPath = nodePath.join(this.root, relativePath);

    // Security check: ensure path doesn't escape root
    const resolvedReal = nodePath.resolve(realPath);
    if (
      !resolvedReal.startsWith(this.root) &&
      resolvedReal !== this.root.replace(/\/$/, "")
    ) {
      return null;
    }

    return resolvedReal;
  }

  private dirname(path: string): string {
    const normalized = this.normalizePath(path);
    if (normalized === "/") return "/";
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === 0 ? "/" : normalized.slice(0, lastSlash);
  }

  private ensureParentDirs(path: string): void {
    const dir = this.dirname(path);
    if (dir === "/") return;

    if (!this.memory.has(dir)) {
      this.ensureParentDirs(dir);
      this.memory.set(dir, {
        type: "directory",
        mode: 0o755,
        mtime: new Date(),
      });
    }
    // Remove from deleted set if it was there
    this.deleted.delete(dir);
  }

  /**
   * Check if a path exists in the overlay (memory + real fs - deleted)
   */
  private async existsInOverlay(virtualPath: string): Promise<boolean> {
    const normalized = this.normalizePath(virtualPath);

    // Deleted in memory layer?
    if (this.deleted.has(normalized)) {
      return false;
    }

    // Exists in memory layer?
    if (this.memory.has(normalized)) {
      return true;
    }

    // Check real filesystem
    const realPath = this.toRealPath(normalized);
    if (!realPath) {
      return false;
    }

    try {
      await fs.promises.access(realPath);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(
    path: string,
    options?: ReadFileOptions | BufferEncoding,
  ): Promise<string> {
    const buffer = await this.readFileBuffer(path);
    const encoding = getEncoding(options);
    return fromBuffer(buffer, encoding);
  }

  async readFileBuffer(
    path: string,
    seen: Set<string> = new Set(),
  ): Promise<Uint8Array> {
    const normalized = this.normalizePath(path);

    // Detect symlink loops
    if (seen.has(normalized)) {
      throw new Error(
        `ELOOP: too many levels of symbolic links, open '${path}'`,
      );
    }
    seen.add(normalized);

    // Check if deleted
    if (this.deleted.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    // Check memory layer first
    const memEntry = this.memory.get(normalized);
    if (memEntry) {
      if (memEntry.type === "symlink") {
        const target = this.resolveSymlink(normalized, memEntry.target);
        return this.readFileBuffer(target, seen);
      }
      if (memEntry.type !== "file") {
        throw new Error(
          `EISDIR: illegal operation on a directory, read '${path}'`,
        );
      }
      return memEntry.content;
    }

    // Fall back to real filesystem
    const realPath = this.toRealPath(normalized);
    if (!realPath) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    try {
      const stat = await fs.promises.lstat(realPath);
      if (stat.isSymbolicLink()) {
        const target = await fs.promises.readlink(realPath);
        const resolvedTarget = this.resolveSymlink(normalized, target);
        return this.readFileBuffer(resolvedTarget, seen);
      }
      if (stat.isDirectory()) {
        throw new Error(
          `EISDIR: illegal operation on a directory, read '${path}'`,
        );
      }
      const content = await fs.promises.readFile(realPath);
      return new Uint8Array(content);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      throw e;
    }
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    this.assertWritable(`write '${path}'`);
    const normalized = this.normalizePath(path);
    this.ensureParentDirs(normalized);

    const encoding = getEncoding(options);
    const buffer = toBuffer(content, encoding);

    this.memory.set(normalized, {
      type: "file",
      content: buffer,
      mode: 0o644,
      mtime: new Date(),
    });
    this.deleted.delete(normalized);
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    this.assertWritable(`append '${path}'`);
    const normalized = this.normalizePath(path);
    const encoding = getEncoding(options);
    const newBuffer = toBuffer(content, encoding);

    // Try to read existing content
    let existingBuffer: Uint8Array;
    try {
      existingBuffer = await this.readFileBuffer(normalized);
    } catch {
      existingBuffer = new Uint8Array(0);
    }

    const combined = new Uint8Array(existingBuffer.length + newBuffer.length);
    combined.set(existingBuffer);
    combined.set(newBuffer, existingBuffer.length);

    this.ensureParentDirs(normalized);
    this.memory.set(normalized, {
      type: "file",
      content: combined,
      mode: 0o644,
      mtime: new Date(),
    });
    this.deleted.delete(normalized);
  }

  async exists(path: string): Promise<boolean> {
    return this.existsInOverlay(path);
  }

  async stat(path: string, seen: Set<string> = new Set()): Promise<FsStat> {
    const normalized = this.normalizePath(path);

    // Detect symlink loops
    if (seen.has(normalized)) {
      throw new Error(
        `ELOOP: too many levels of symbolic links, stat '${path}'`,
      );
    }
    seen.add(normalized);

    if (this.deleted.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }

    // Check memory layer first
    const entry = this.memory.get(normalized);
    if (entry) {
      // Follow symlinks
      if (entry.type === "symlink") {
        const target = this.resolveSymlink(normalized, entry.target);
        return this.stat(target, seen);
      }

      let size = 0;
      if (entry.type === "file") {
        size = entry.content.length;
      }

      return {
        isFile: entry.type === "file",
        isDirectory: entry.type === "directory",
        isSymbolicLink: false,
        mode: entry.mode,
        size,
        mtime: entry.mtime,
      };
    }

    // Fall back to real filesystem
    const realPath = this.toRealPath(normalized);
    if (!realPath) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }

    try {
      const stat = await fs.promises.stat(realPath);
      return {
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymbolicLink: false,
        mode: stat.mode,
        size: stat.size,
        mtime: stat.mtime,
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
      }
      throw e;
    }
  }

  async lstat(path: string): Promise<FsStat> {
    const normalized = this.normalizePath(path);

    if (this.deleted.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, lstat '${path}'`);
    }

    // Check memory layer first
    const entry = this.memory.get(normalized);
    if (entry) {
      if (entry.type === "symlink") {
        return {
          isFile: false,
          isDirectory: false,
          isSymbolicLink: true,
          mode: entry.mode,
          size: entry.target.length,
          mtime: entry.mtime,
        };
      }

      let size = 0;
      if (entry.type === "file") {
        size = entry.content.length;
      }

      return {
        isFile: entry.type === "file",
        isDirectory: entry.type === "directory",
        isSymbolicLink: false,
        mode: entry.mode,
        size,
        mtime: entry.mtime,
      };
    }

    // Fall back to real filesystem
    const realPath = this.toRealPath(normalized);
    if (!realPath) {
      throw new Error(`ENOENT: no such file or directory, lstat '${path}'`);
    }

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
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`ENOENT: no such file or directory, lstat '${path}'`);
      }
      throw e;
    }
  }

  private resolveSymlink(symlinkPath: string, target: string): string {
    if (target.startsWith("/")) {
      return this.normalizePath(target);
    }
    const dir = this.dirname(symlinkPath);
    return this.normalizePath(dir === "/" ? `/${target}` : `${dir}/${target}`);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    this.assertWritable(`mkdir '${path}'`);
    const normalized = this.normalizePath(path);

    // Check if it exists (in memory or real fs)
    const exists = await this.existsInOverlay(normalized);
    if (exists) {
      if (!options?.recursive) {
        throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
      }
      return;
    }

    // Check parent exists
    const parent = this.dirname(normalized);
    if (parent !== "/") {
      const parentExists = await this.existsInOverlay(parent);
      if (!parentExists) {
        if (options?.recursive) {
          await this.mkdir(parent, { recursive: true });
        } else {
          throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
        }
      }
    }

    this.memory.set(normalized, {
      type: "directory",
      mode: 0o755,
      mtime: new Date(),
    });
    this.deleted.delete(normalized);
  }

  async readdir(path: string): Promise<string[]> {
    const normalized = this.normalizePath(path);

    if (this.deleted.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    const entries = new Set<string>();
    const deletedChildren = new Set<string>();

    // Collect deleted entries that are direct children of this path
    const prefix = normalized === "/" ? "/" : `${normalized}/`;
    for (const deletedPath of this.deleted) {
      if (deletedPath.startsWith(prefix)) {
        const rest = deletedPath.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !rest.includes("/", name.length)) {
          deletedChildren.add(name);
        }
      }
    }

    // Add entries from memory layer
    for (const memPath of this.memory.keys()) {
      if (memPath === normalized) continue;
      if (memPath.startsWith(prefix)) {
        const rest = memPath.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !deletedChildren.has(name)) {
          entries.add(name);
        }
      }
    }

    // Add entries from real filesystem
    const realPath = this.toRealPath(normalized);
    if (realPath) {
      try {
        const realEntries = await fs.promises.readdir(realPath);
        for (const name of realEntries) {
          if (!deletedChildren.has(name)) {
            entries.add(name);
          }
        }
      } catch (e) {
        // If it's ENOENT and we don't have it in memory, throw
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          if (!this.memory.has(normalized)) {
            throw new Error(
              `ENOENT: no such file or directory, scandir '${path}'`,
            );
          }
        } else if ((e as NodeJS.ErrnoException).code !== "ENOTDIR") {
          throw e;
        }
      }
    }

    return Array.from(entries).sort();
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    this.assertWritable(`rm '${path}'`);
    const normalized = this.normalizePath(path);

    const exists = await this.existsInOverlay(normalized);
    if (!exists) {
      if (options?.force) return;
      throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
    }

    // Check if it's a directory
    try {
      const stat = await this.stat(normalized);
      if (stat.isDirectory) {
        const children = await this.readdir(normalized);
        if (children.length > 0) {
          if (!options?.recursive) {
            throw new Error(`ENOTEMPTY: directory not empty, rm '${path}'`);
          }
          for (const child of children) {
            const childPath =
              normalized === "/" ? `/${child}` : `${normalized}/${child}`;
            await this.rm(childPath, options);
          }
        }
      }
    } catch {
      // If stat fails, we'll just mark it as deleted
    }

    // Mark as deleted and remove from memory
    this.deleted.add(normalized);
    this.memory.delete(normalized);
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    this.assertWritable(`cp '${dest}'`);
    const srcNorm = this.normalizePath(src);
    const destNorm = this.normalizePath(dest);

    const srcExists = await this.existsInOverlay(srcNorm);
    if (!srcExists) {
      throw new Error(`ENOENT: no such file or directory, cp '${src}'`);
    }

    const srcStat = await this.stat(srcNorm);

    if (srcStat.isFile) {
      const content = await this.readFileBuffer(srcNorm);
      await this.writeFile(destNorm, content);
    } else if (srcStat.isDirectory) {
      if (!options?.recursive) {
        throw new Error(`EISDIR: is a directory, cp '${src}'`);
      }
      await this.mkdir(destNorm, { recursive: true });
      const children = await this.readdir(srcNorm);
      for (const child of children) {
        const srcChild = srcNorm === "/" ? `/${child}` : `${srcNorm}/${child}`;
        const destChild =
          destNorm === "/" ? `/${child}` : `${destNorm}/${child}`;
        await this.cp(srcChild, destChild, options);
      }
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    this.assertWritable(`mv '${dest}'`);
    await this.cp(src, dest, { recursive: true });
    await this.rm(src, { recursive: true });
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith("/")) {
      return this.normalizePath(path);
    }
    const combined = base === "/" ? `/${path}` : `${base}/${path}`;
    return this.normalizePath(combined);
  }

  getAllPaths(): string[] {
    // This is expensive for overlay fs, but we can return what's in memory
    // plus scan the real filesystem
    const paths = new Set<string>(this.memory.keys());

    // Remove deleted paths
    for (const deleted of this.deleted) {
      paths.delete(deleted);
    }

    // Add paths from real filesystem (this is a sync operation, be careful)
    this.scanRealFs("/", paths);

    return Array.from(paths);
  }

  private scanRealFs(virtualDir: string, paths: Set<string>): void {
    if (this.deleted.has(virtualDir)) return;

    const realPath = this.toRealPath(virtualDir);
    if (!realPath) return;

    try {
      const entries = fs.readdirSync(realPath);
      for (const entry of entries) {
        const virtualPath =
          virtualDir === "/" ? `/${entry}` : `${virtualDir}/${entry}`;
        if (this.deleted.has(virtualPath)) continue;
        paths.add(virtualPath);

        const entryRealPath = nodePath.join(realPath, entry);
        const stat = fs.statSync(entryRealPath);
        if (stat.isDirectory()) {
          this.scanRealFs(virtualPath, paths);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  async chmod(path: string, mode: number): Promise<void> {
    this.assertWritable(`chmod '${path}'`);
    const normalized = this.normalizePath(path);

    const exists = await this.existsInOverlay(normalized);
    if (!exists) {
      throw new Error(`ENOENT: no such file or directory, chmod '${path}'`);
    }

    // If in memory, update there
    const entry = this.memory.get(normalized);
    if (entry) {
      entry.mode = mode;
      return;
    }

    // If from real fs, we need to copy to memory layer first
    const stat = await this.stat(normalized);
    if (stat.isFile) {
      const content = await this.readFileBuffer(normalized);
      this.memory.set(normalized, {
        type: "file",
        content,
        mode,
        mtime: new Date(),
      });
    } else if (stat.isDirectory) {
      this.memory.set(normalized, {
        type: "directory",
        mode,
        mtime: new Date(),
      });
    }
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    this.assertWritable(`symlink '${linkPath}'`);
    const normalized = this.normalizePath(linkPath);

    const exists = await this.existsInOverlay(normalized);
    if (exists) {
      throw new Error(`EEXIST: file already exists, symlink '${linkPath}'`);
    }

    this.ensureParentDirs(normalized);
    this.memory.set(normalized, {
      type: "symlink",
      target,
      mode: 0o777,
      mtime: new Date(),
    });
    this.deleted.delete(normalized);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    this.assertWritable(`link '${newPath}'`);
    const existingNorm = this.normalizePath(existingPath);
    const newNorm = this.normalizePath(newPath);

    const existingExists = await this.existsInOverlay(existingNorm);
    if (!existingExists) {
      throw new Error(
        `ENOENT: no such file or directory, link '${existingPath}'`,
      );
    }

    const existingStat = await this.stat(existingNorm);
    if (!existingStat.isFile) {
      throw new Error(`EPERM: operation not permitted, link '${existingPath}'`);
    }

    const newExists = await this.existsInOverlay(newNorm);
    if (newExists) {
      throw new Error(`EEXIST: file already exists, link '${newPath}'`);
    }

    // Copy content to new location
    const content = await this.readFileBuffer(existingNorm);
    this.ensureParentDirs(newNorm);
    this.memory.set(newNorm, {
      type: "file",
      content,
      mode: existingStat.mode,
      mtime: new Date(),
    });
    this.deleted.delete(newNorm);
  }

  async readlink(path: string): Promise<string> {
    const normalized = this.normalizePath(path);

    if (this.deleted.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, readlink '${path}'`);
    }

    // Check memory layer first
    const entry = this.memory.get(normalized);
    if (entry) {
      if (entry.type !== "symlink") {
        throw new Error(`EINVAL: invalid argument, readlink '${path}'`);
      }
      return entry.target;
    }

    // Fall back to real filesystem
    const realPath = this.toRealPath(normalized);
    if (!realPath) {
      throw new Error(`ENOENT: no such file or directory, readlink '${path}'`);
    }

    try {
      return await fs.promises.readlink(realPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `ENOENT: no such file or directory, readlink '${path}'`,
        );
      }
      if ((e as NodeJS.ErrnoException).code === "EINVAL") {
        throw new Error(`EINVAL: invalid argument, readlink '${path}'`);
      }
      throw e;
    }
  }
}

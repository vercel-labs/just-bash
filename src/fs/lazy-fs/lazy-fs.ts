/**
 * LazyFs - Lazy-loading filesystem backed by user-provided loader functions
 *
 * Content is loaded on-demand and cached in an InMemoryFs backing store.
 * Designed for AI agents needing lazy access to remote or virtual content.
 */

import {
  type FileContent,
  fromBuffer,
  getEncoding,
  toBuffer,
} from "../encoding.js";
import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
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

/**
 * Entry type in directory listing
 */
export interface LazyDirEntry {
  name: string;
  type: "file" | "directory" | "symlink";
}

/**
 * Result from listDir - array of entries or null if dir doesn't exist
 */
export type LazyDirListing = LazyDirEntry[] | null;

/**
 * Function to list directory contents
 */
export type LazyListDir = (dirPath: string) => Promise<LazyDirListing>;

/**
 * Result from loadFile
 */
export interface LazyFileContent {
  content: string | Uint8Array;
  mode?: number; // Default: 0o644
  mtime?: Date;
  isSymlink?: boolean; // If true, content is treated as symlink target
}

/**
 * Function to load file content - returns content or null if doesn't exist
 */
export type LazyLoadFile = (
  filePath: string,
) => Promise<LazyFileContent | null>;

export interface LazyFsOptions {
  listDir: LazyListDir;
  loadFile: LazyLoadFile;
  allowWrites?: boolean; // Default: true
}

export class LazyFs implements IFileSystem {
  private readonly cache: InMemoryFs;
  private readonly listDir: LazyListDir;
  private readonly loadFile: LazyLoadFile;
  private readonly allowWrites: boolean;

  // Tracking state
  private readonly loadedFiles: Set<string> = new Set();
  private readonly loadedDirs: Set<string> = new Set();
  private readonly notExistsAsFile: Set<string> = new Set(); // Path is not a file
  private readonly notExistsAsDir: Set<string> = new Set(); // Path is not a directory
  private readonly modified: Set<string> = new Set();
  private readonly deleted: Set<string> = new Set();

  constructor(options: LazyFsOptions) {
    this.cache = new InMemoryFs();
    this.listDir = options.listDir;
    this.loadFile = options.loadFile;
    this.allowWrites = options.allowWrites ?? true;
  }

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

  private dirname(path: string): string {
    const normalized = this.normalizePath(path);
    if (normalized === "/") return "/";
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === 0 ? "/" : normalized.slice(0, lastSlash);
  }

  private assertWritable(operation: string): void {
    if (!this.allowWrites) {
      throw new Error(`EROFS: read-only file system, ${operation}`);
    }
  }

  /**
   * Ensure a file has been loaded from the lazy loader
   */
  private async ensureFileLoaded(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);

    // If deleted locally, it doesn't exist
    if (this.deleted.has(normalized)) {
      return false;
    }

    // If modified locally, use cached version
    if (this.modified.has(normalized)) {
      return true;
    }

    // If already loaded or known not to exist as a file
    if (this.loadedFiles.has(normalized)) {
      return true;
    }
    if (this.notExistsAsFile.has(normalized)) {
      return false;
    }

    // Try to load
    const result = await this.loadFile(normalized);
    if (result === null) {
      this.notExistsAsFile.add(normalized);
      return false;
    }

    // Store in cache
    this.loadedFiles.add(normalized);

    if (result.isSymlink) {
      // Content is symlink target
      const target =
        typeof result.content === "string"
          ? result.content
          : new TextDecoder().decode(result.content);
      await this.cache.symlink(target, normalized);
    } else {
      // Regular file
      const buffer = toBuffer(result.content);
      await this.cache.writeFile(normalized, buffer);

      // Set metadata if provided
      if (result.mode !== undefined) {
        await this.cache.chmod(normalized, result.mode);
      }
      if (result.mtime !== undefined) {
        await this.cache.utimes(normalized, result.mtime, result.mtime);
      }
    }

    return true;
  }

  /**
   * Ensure a directory listing has been loaded
   */
  private async ensureDirLoaded(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);

    // If deleted locally, it doesn't exist
    if (this.deleted.has(normalized)) {
      return false;
    }

    // If modified locally (created as dir), use cached version
    if (this.modified.has(normalized)) {
      return true;
    }

    // If already loaded or known not to exist as a directory
    if (this.loadedDirs.has(normalized)) {
      return true;
    }
    if (this.notExistsAsDir.has(normalized)) {
      return false;
    }

    // Try to load
    const entries = await this.listDir(normalized);
    if (entries === null) {
      this.notExistsAsDir.add(normalized);
      return false;
    }

    // Create directory in cache if needed
    try {
      const exists = await this.cache.exists(normalized);
      if (!exists) {
        await this.cache.mkdir(normalized, { recursive: true });
      }
    } catch {
      // Directory might already exist
    }

    // Store entries as placeholders (will be loaded on demand)
    for (const entry of entries) {
      const childPath =
        normalized === "/" ? `/${entry.name}` : `${normalized}/${entry.name}`;

      // Don't overwrite locally modified/loaded entries
      if (
        this.modified.has(childPath) ||
        this.loadedFiles.has(childPath) ||
        this.loadedDirs.has(childPath)
      ) {
        continue;
      }

      // Create placeholder based on type
      if (entry.type === "directory") {
        try {
          const exists = await this.cache.exists(childPath);
          if (!exists) {
            await this.cache.mkdir(childPath, { recursive: true });
          }
        } catch {
          // Directory might already exist
        }
      } else if (entry.type === "symlink") {
        // For symlinks, we need to load the actual file to get the target
        // Just mark it as needing load
      } else {
        // For files, create an empty placeholder that will be replaced on read
        // We don't create files here - they'll be loaded on demand
      }
    }

    this.loadedDirs.add(normalized);
    return true;
  }

  /**
   * Get entries for a directory from the loaded listing
   */
  private async getDirEntries(path: string): Promise<LazyDirEntry[] | null> {
    const normalized = this.normalizePath(path);

    // First ensure the directory is loaded
    const exists = await this.ensureDirLoaded(normalized);
    if (!exists) {
      return null;
    }

    // Re-fetch from loader to get accurate entries
    const entries = await this.listDir(normalized);
    return entries;
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
    const normalized = this.normalizePath(path);

    // Check if deleted
    if (this.deleted.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    // If modified locally, read from cache directly
    if (this.modified.has(normalized)) {
      return this.cache.readFileBuffer(normalized);
    }

    // Ensure file is loaded
    const loaded = await this.ensureFileLoaded(normalized);
    if (!loaded) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    // Check if it's a symlink and load the target
    const stat = await this.cache.lstat(normalized);
    if (stat.isSymbolicLink) {
      const target = await this.cache.readlink(normalized);
      const resolvedTarget = target.startsWith("/")
        ? target
        : this.resolvePath(this.dirname(normalized), target);
      // Recursively read the target
      return this.readFileBuffer(resolvedTarget);
    }

    // Read from cache
    return this.cache.readFileBuffer(normalized);
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    this.assertWritable(`write '${path}'`);
    const normalized = this.normalizePath(path);

    // Ensure parent directory exists
    const parent = this.dirname(normalized);
    if (parent !== "/") {
      await this.ensureDirLoaded(parent);
    }

    // Write to cache
    await this.cache.writeFile(normalized, content, options);

    // Mark as modified
    this.modified.add(normalized);
    this.deleted.delete(normalized);
    this.notExistsAsFile.delete(normalized);
    this.notExistsAsDir.delete(normalized);
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    this.assertWritable(`append '${path}'`);
    const normalized = this.normalizePath(path);

    // Try to load existing content first
    if (!this.modified.has(normalized)) {
      await this.ensureFileLoaded(normalized);
    }

    // Append to cache
    await this.cache.appendFile(normalized, content, options);

    // Mark as modified
    this.modified.add(normalized);
    this.deleted.delete(normalized);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);

    // If deleted locally
    if (this.deleted.has(normalized)) {
      return false;
    }

    // If modified locally, check cache
    if (this.modified.has(normalized)) {
      return this.cache.exists(normalized);
    }

    // If loaded, check cache
    if (this.loadedFiles.has(normalized) || this.loadedDirs.has(normalized)) {
      return this.cache.exists(normalized);
    }

    // If known not to exist (checked both file and dir)
    if (
      this.notExistsAsFile.has(normalized) &&
      this.notExistsAsDir.has(normalized)
    ) {
      return false;
    }

    // Try loading as file first
    const fileLoaded = await this.ensureFileLoaded(normalized);
    if (fileLoaded) {
      return true;
    }

    // Try loading as directory
    const dirLoaded = await this.ensureDirLoaded(normalized);
    return dirLoaded;
  }

  async stat(path: string): Promise<FsStat> {
    const normalized = this.normalizePath(path);

    // If deleted locally
    if (this.deleted.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
    }

    // If modified locally or already loaded, use cache
    if (
      this.modified.has(normalized) ||
      this.loadedFiles.has(normalized) ||
      this.loadedDirs.has(normalized)
    ) {
      return this.cache.stat(normalized);
    }

    // Try to load file first
    const fileLoaded = await this.ensureFileLoaded(normalized);
    if (fileLoaded) {
      return this.cache.stat(normalized);
    }

    // Try to load as directory
    const dirLoaded = await this.ensureDirLoaded(normalized);
    if (dirLoaded) {
      return this.cache.stat(normalized);
    }

    throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
  }

  async lstat(path: string): Promise<FsStat> {
    const normalized = this.normalizePath(path);

    // If deleted locally
    if (this.deleted.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, lstat '${path}'`);
    }

    // If modified locally or already loaded, use cache
    if (
      this.modified.has(normalized) ||
      this.loadedFiles.has(normalized) ||
      this.loadedDirs.has(normalized)
    ) {
      return this.cache.lstat(normalized);
    }

    // Try to load file first
    const fileLoaded = await this.ensureFileLoaded(normalized);
    if (fileLoaded) {
      return this.cache.lstat(normalized);
    }

    // Try to load as directory
    const dirLoaded = await this.ensureDirLoaded(normalized);
    if (dirLoaded) {
      return this.cache.lstat(normalized);
    }

    throw new Error(`ENOENT: no such file or directory, lstat '${path}'`);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    this.assertWritable(`mkdir '${path}'`);
    const normalized = this.normalizePath(path);

    // Check if already exists
    const exists = await this.exists(normalized);
    if (exists) {
      if (!options?.recursive) {
        throw new Error(`EEXIST: directory already exists, mkdir '${path}'`);
      }
      return;
    }

    // Ensure parent exists (or create recursively)
    const parent = this.dirname(normalized);
    if (parent !== "/") {
      if (options?.recursive) {
        // Recursively create parent directories
        await this.mkdir(parent, { recursive: true });
      } else {
        const parentExists = await this.exists(parent);
        if (!parentExists) {
          throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
        }
      }
    }

    // Create in cache (not recursive since we handle it above)
    await this.cache.mkdir(normalized);

    // Mark as modified
    this.modified.add(normalized);
    this.loadedDirs.add(normalized);
    this.deleted.delete(normalized);
    this.notExistsAsFile.delete(normalized);
    this.notExistsAsDir.delete(normalized);
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.readdirWithFileTypes(path);
    return entries.map((e) => e.name);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const normalized = this.normalizePath(path);

    // If deleted locally
    if (this.deleted.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    // Ensure directory is loaded
    const loaded = await this.ensureDirLoaded(normalized);
    if (!loaded) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    // Get entries from loader
    const lazyEntries = await this.getDirEntries(normalized);
    if (!lazyEntries) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    // Build result from lazy entries plus any locally added files
    const entriesMap = new Map<string, DirentEntry>();

    // Add lazy entries
    for (const entry of lazyEntries) {
      const childPath =
        normalized === "/" ? `/${entry.name}` : `${normalized}/${entry.name}`;

      // Skip if deleted locally
      if (this.deleted.has(childPath)) {
        continue;
      }

      entriesMap.set(entry.name, {
        name: entry.name,
        isFile: entry.type === "file",
        isDirectory: entry.type === "directory",
        isSymbolicLink: entry.type === "symlink",
      });
    }

    // Add locally modified entries that are direct children
    const prefix = normalized === "/" ? "/" : `${normalized}/`;
    for (const modPath of this.modified) {
      if (modPath.startsWith(prefix)) {
        const rest = modPath.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name && !rest.includes("/", 1) && !entriesMap.has(name)) {
          // Get type from cache
          try {
            const stat = await this.cache.lstat(modPath);
            entriesMap.set(name, {
              name,
              isFile: stat.isFile,
              isDirectory: stat.isDirectory,
              isSymbolicLink: stat.isSymbolicLink,
            });
          } catch {
            // Entry doesn't exist in cache
          }
        }
      }
    }

    // Sort and return
    return Array.from(entriesMap.values()).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    this.assertWritable(`rm '${path}'`);
    const normalized = this.normalizePath(path);

    // Check if exists
    const exists = await this.exists(normalized);
    if (!exists) {
      if (options?.force) return;
      throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
    }

    // Check if it's a directory
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

    // Mark as deleted
    this.deleted.add(normalized);
    this.modified.delete(normalized);
    this.loadedFiles.delete(normalized);
    this.loadedDirs.delete(normalized);

    // Remove from cache
    try {
      await this.cache.rm(normalized, { force: true });
    } catch {
      // Ignore errors
    }
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    this.assertWritable(`cp '${dest}'`);
    const srcNorm = this.normalizePath(src);
    const destNorm = this.normalizePath(dest);

    // Ensure source exists
    const srcExists = await this.exists(srcNorm);
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
    // Return all paths we know about
    const paths = new Set<string>();

    // Add loaded files
    for (const p of this.loadedFiles) {
      if (!this.deleted.has(p)) {
        paths.add(p);
      }
    }

    // Add loaded directories
    for (const p of this.loadedDirs) {
      if (!this.deleted.has(p)) {
        paths.add(p);
      }
    }

    // Add modified paths
    for (const p of this.modified) {
      if (!this.deleted.has(p)) {
        paths.add(p);
      }
    }

    return Array.from(paths);
  }

  async chmod(path: string, mode: number): Promise<void> {
    this.assertWritable(`chmod '${path}'`);
    const normalized = this.normalizePath(path);

    // Ensure file/dir is loaded
    const exists = await this.exists(normalized);
    if (!exists) {
      throw new Error(`ENOENT: no such file or directory, chmod '${path}'`);
    }

    // Load into cache if needed
    if (
      !this.modified.has(normalized) &&
      !this.loadedFiles.has(normalized) &&
      !this.loadedDirs.has(normalized)
    ) {
      await this.ensureFileLoaded(normalized);
    }

    await this.cache.chmod(normalized, mode);
    this.modified.add(normalized);
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    this.assertWritable(`symlink '${linkPath}'`);
    const normalized = this.normalizePath(linkPath);

    // Check if already exists
    const exists = await this.exists(normalized);
    if (exists) {
      throw new Error(`EEXIST: file already exists, symlink '${linkPath}'`);
    }

    // Ensure parent exists
    const parent = this.dirname(normalized);
    if (parent !== "/") {
      await this.ensureDirLoaded(parent);
    }

    await this.cache.symlink(target, normalized);
    this.modified.add(normalized);
    this.loadedFiles.add(normalized);
    this.deleted.delete(normalized);
    this.notExistsAsFile.delete(normalized);
    this.notExistsAsDir.delete(normalized);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    this.assertWritable(`link '${newPath}'`);
    const existingNorm = this.normalizePath(existingPath);
    const newNorm = this.normalizePath(newPath);

    // Ensure source exists and is a file
    const srcExists = await this.exists(existingNorm);
    if (!srcExists) {
      throw new Error(
        `ENOENT: no such file or directory, link '${existingPath}'`,
      );
    }

    const srcStat = await this.stat(existingNorm);
    if (!srcStat.isFile) {
      throw new Error(`EPERM: operation not permitted, link '${existingPath}'`);
    }

    // Check dest doesn't exist
    const destExists = await this.exists(newNorm);
    if (destExists) {
      throw new Error(`EEXIST: file already exists, link '${newPath}'`);
    }

    // Ensure parent of dest exists
    const parent = this.dirname(newNorm);
    if (parent !== "/") {
      await this.ensureDirLoaded(parent);
    }

    // Load source content and create hard link
    await this.ensureFileLoaded(existingNorm);
    await this.cache.link(existingNorm, newNorm);

    this.modified.add(newNorm);
    this.loadedFiles.add(newNorm);
    this.deleted.delete(newNorm);
    this.notExistsAsFile.delete(newNorm);
    this.notExistsAsDir.delete(newNorm);
  }

  async readlink(path: string): Promise<string> {
    const normalized = this.normalizePath(path);

    // If deleted
    if (this.deleted.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, readlink '${path}'`);
    }

    // Ensure file is loaded
    if (!this.modified.has(normalized) && !this.loadedFiles.has(normalized)) {
      const loaded = await this.ensureFileLoaded(normalized);
      if (!loaded) {
        throw new Error(
          `ENOENT: no such file or directory, readlink '${path}'`,
        );
      }
    }

    return this.cache.readlink(normalized);
  }

  async realpath(path: string): Promise<string> {
    const normalized = this.normalizePath(path);

    // Check if exists
    const exists = await this.exists(normalized);
    if (!exists) {
      throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
    }

    // Load into cache if needed
    if (
      !this.modified.has(normalized) &&
      !this.loadedFiles.has(normalized) &&
      !this.loadedDirs.has(normalized)
    ) {
      await this.ensureFileLoaded(normalized);
    }

    // Check if it's a symlink and resolve it
    const stat = await this.cache.lstat(normalized);
    if (stat.isSymbolicLink) {
      const target = await this.cache.readlink(normalized);
      const resolvedTarget = target.startsWith("/")
        ? target
        : this.resolvePath(this.dirname(normalized), target);

      // Make sure the target is loaded
      const targetExists = await this.exists(resolvedTarget);
      if (!targetExists) {
        throw new Error(
          `ENOENT: no such file or directory, realpath '${path}'`,
        );
      }

      // Recursively resolve
      return this.realpath(resolvedTarget);
    }

    return normalized;
  }

  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    this.assertWritable(`utimes '${path}'`);
    const normalized = this.normalizePath(path);

    // Ensure file/dir is loaded
    const exists = await this.exists(normalized);
    if (!exists) {
      throw new Error(`ENOENT: no such file or directory, utimes '${path}'`);
    }

    // Load into cache if needed
    if (
      !this.modified.has(normalized) &&
      !this.loadedFiles.has(normalized) &&
      !this.loadedDirs.has(normalized)
    ) {
      await this.ensureFileLoaded(normalized);
    }

    await this.cache.utimes(normalized, atime, mtime);
    this.modified.add(normalized);
  }
}

// Re-export type alias
export type BufferEncoding = import("../interface.js").BufferEncoding;

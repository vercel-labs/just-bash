import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import type {
  BufferEncoding,
  CpOptions,
  FileContent,
  FsStat,
  IFileSystem,
  MkdirOptions,
  ReadFileOptions,
  RmOptions,
  WriteFileOptions,
} from "../interface.js";

/**
 * Configuration for a mount point
 */
export interface MountConfig {
  /** Virtual path where the filesystem is mounted */
  mountPoint: string;
  /** The filesystem to mount at this path */
  filesystem: IFileSystem;
}

/**
 * Options for creating a MountableFs
 */
export interface MountableFsOptions {
  /** Base filesystem used for unmounted paths (defaults to InMemoryFs) */
  base?: IFileSystem;
  /** Initial mounts to configure */
  mounts?: MountConfig[];
}

/**
 * Internal mount entry with normalized mount point
 */
interface MountEntry {
  mountPoint: string;
  filesystem: IFileSystem;
}

/**
 * A filesystem that supports mounting other filesystems at specific paths.
 *
 * This allows combining multiple filesystem backends into a unified namespace.
 * For example, mounting a read-only knowledge base at /mnt/knowledge and a
 * read-write workspace at /home/agent.
 *
 * @example
 * ```typescript
 * const fs = new MountableFs({ base: new InMemoryFs() });
 * fs.mount('/mnt/knowledge', new OverlayFs({ root: "/path/to/knowledge", readOnly: true }));
 * fs.mount('/home/agent', new ReadWriteFs({ root: "/path/to/workspace" }));
 * ```
 */
export class MountableFs implements IFileSystem {
  private baseFs: IFileSystem;
  private mounts: Map<string, MountEntry> = new Map();

  constructor(options?: MountableFsOptions) {
    this.baseFs = options?.base ?? new InMemoryFs();

    // Add initial mounts
    if (options?.mounts) {
      for (const { mountPoint, filesystem } of options.mounts) {
        this.mount(mountPoint, filesystem);
      }
    }
  }

  /**
   * Mount a filesystem at the specified virtual path.
   *
   * @param mountPoint - The virtual path where the filesystem will be accessible
   * @param filesystem - The filesystem to mount
   * @throws Error if mounting at root '/' or inside an existing mount
   */
  mount(mountPoint: string, filesystem: IFileSystem): void {
    // Validate original path first (before normalization)
    this.validateMountPath(mountPoint);

    const normalized = this.normalizePath(mountPoint);

    // Validate mount point constraints
    this.validateMount(normalized);

    this.mounts.set(normalized, {
      mountPoint: normalized,
      filesystem,
    });
  }

  /**
   * Unmount the filesystem at the specified path.
   *
   * @param mountPoint - The virtual path to unmount
   * @throws Error if no filesystem is mounted at this path
   */
  unmount(mountPoint: string): void {
    const normalized = this.normalizePath(mountPoint);

    if (!this.mounts.has(normalized)) {
      throw new Error(`No filesystem mounted at '${mountPoint}'`);
    }

    this.mounts.delete(normalized);
  }

  /**
   * Get all current mounts.
   */
  getMounts(): ReadonlyArray<{ mountPoint: string; filesystem: IFileSystem }> {
    return Array.from(this.mounts.values()).map((entry) => ({
      mountPoint: entry.mountPoint,
      filesystem: entry.filesystem,
    }));
  }

  /**
   * Check if a path is exactly a mount point.
   */
  isMountPoint(path: string): boolean {
    const normalized = this.normalizePath(path);
    return this.mounts.has(normalized);
  }

  /**
   * Validate mount path format before normalization.
   * Rejects paths containing . or .. segments.
   */
  private validateMountPath(mountPoint: string): void {
    const segments = mountPoint.split("/");
    for (const segment of segments) {
      if (segment === "." || segment === "..") {
        throw new Error(
          `Invalid mount point '${mountPoint}': contains '.' or '..' segments`,
        );
      }
    }
  }

  /**
   * Validate that a mount point is allowed.
   */
  private validateMount(mountPoint: string): void {
    // Cannot mount at root
    if (mountPoint === "/") {
      throw new Error("Cannot mount at root '/'");
    }

    // Check for nested mounts (but allow remounting at same path)
    for (const existingMount of this.mounts.keys()) {
      if (existingMount === mountPoint) {
        // Remounting at same path is allowed (will replace)
        continue;
      }

      // Check if new mount is inside existing mount
      if (mountPoint.startsWith(`${existingMount}/`)) {
        throw new Error(
          `Cannot mount at '${mountPoint}': inside existing mount '${existingMount}'`,
        );
      }

      // Check if existing mount is inside new mount
      if (existingMount.startsWith(`${mountPoint}/`)) {
        throw new Error(
          `Cannot mount at '${mountPoint}': would contain existing mount '${existingMount}'`,
        );
      }
    }
  }

  /**
   * Normalize a path to a consistent format.
   */
  private normalizePath(path: string): string {
    // Handle empty or just slash
    if (!path || path === "/") return "/";

    // Remove trailing slash
    let normalized =
      path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;

    // Ensure starts with /
    if (!normalized.startsWith("/")) {
      normalized = `/${normalized}`;
    }

    // Resolve . and ..
    const parts = normalized.split("/").filter((p) => p && p !== ".");
    const resolved: string[] = [];

    for (const part of parts) {
      if (part === "..") {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }

    return `/${resolved.join("/")}`;
  }

  /**
   * Route a path to the appropriate filesystem.
   * Returns the filesystem and the relative path within that filesystem.
   */
  private routePath(path: string): { fs: IFileSystem; relativePath: string } {
    const normalized = this.normalizePath(path);

    // Check for exact or prefix mount match
    // We need to find the longest matching mount point
    let bestMatch: MountEntry | null = null;
    let bestMatchLength = 0;

    for (const entry of this.mounts.values()) {
      const mp = entry.mountPoint;

      if (normalized === mp) {
        // Exact match - return root of mounted filesystem
        return { fs: entry.filesystem, relativePath: "/" };
      }

      if (normalized.startsWith(`${mp}/`)) {
        // Prefix match - check if it's longer than previous best
        if (mp.length > bestMatchLength) {
          bestMatch = entry;
          bestMatchLength = mp.length;
        }
      }
    }

    if (bestMatch) {
      const relativePath = normalized.slice(bestMatchLength);
      return {
        fs: bestMatch.filesystem,
        relativePath: relativePath || "/",
      };
    }

    // No mount found - use base filesystem
    return { fs: this.baseFs, relativePath: normalized };
  }

  /**
   * Get mount points that are immediate children of a directory.
   */
  private getChildMountPoints(dirPath: string): string[] {
    const normalized = this.normalizePath(dirPath);
    const prefix = normalized === "/" ? "/" : `${normalized}/`;
    const children: string[] = [];

    for (const mountPoint of this.mounts.keys()) {
      if (mountPoint.startsWith(prefix)) {
        const remainder = mountPoint.slice(prefix.length);
        const childName = remainder.split("/")[0];
        if (childName && !children.includes(childName)) {
          children.push(childName);
        }
      }
    }

    return children;
  }

  // ==================== IFileSystem Implementation ====================

  async readFile(
    path: string,
    options?: ReadFileOptions | BufferEncoding,
  ): Promise<string> {
    const { fs, relativePath } = this.routePath(path);
    return fs.readFile(relativePath, options);
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const { fs, relativePath } = this.routePath(path);
    return fs.readFileBuffer(relativePath);
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    const { fs, relativePath } = this.routePath(path);
    return fs.writeFile(relativePath, content, options);
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    const { fs, relativePath } = this.routePath(path);
    return fs.appendFile(relativePath, content, options);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);

    // Check if this is exactly a mount point
    if (this.mounts.has(normalized)) {
      return true;
    }

    // Check if there are child mount points (making this a virtual directory)
    const childMounts = this.getChildMountPoints(normalized);
    if (childMounts.length > 0) {
      return true;
    }

    // Route to the appropriate filesystem
    const { fs, relativePath } = this.routePath(path);
    return fs.exists(relativePath);
  }

  async stat(path: string): Promise<FsStat> {
    const normalized = this.normalizePath(path);

    // Check if this is exactly a mount point
    const mountEntry = this.mounts.get(normalized);
    if (mountEntry) {
      // Return stats from the root of the mounted filesystem
      try {
        return await mountEntry.filesystem.stat("/");
      } catch {
        // Fallback to synthetic directory stats
        return {
          isFile: false,
          isDirectory: true,
          isSymbolicLink: false,
          mode: 0o755,
          size: 0,
          mtime: new Date(),
        };
      }
    }

    // Check if there are child mount points (making this a virtual directory)
    const childMounts = this.getChildMountPoints(normalized);
    if (childMounts.length > 0) {
      // Check if directory also exists in base fs
      try {
        const baseStat = await this.baseFs.stat(normalized);
        return baseStat;
      } catch {
        // Virtual directory from mount points only
        return {
          isFile: false,
          isDirectory: true,
          isSymbolicLink: false,
          mode: 0o755,
          size: 0,
          mtime: new Date(),
        };
      }
    }

    // Route to the appropriate filesystem
    const { fs, relativePath } = this.routePath(path);
    return fs.stat(relativePath);
  }

  async lstat(path: string): Promise<FsStat> {
    const normalized = this.normalizePath(path);

    // Check if this is exactly a mount point
    const mountEntry = this.mounts.get(normalized);
    if (mountEntry) {
      // Return stats from the root of the mounted filesystem
      try {
        return await mountEntry.filesystem.lstat("/");
      } catch {
        // Fallback to synthetic directory stats
        return {
          isFile: false,
          isDirectory: true,
          isSymbolicLink: false,
          mode: 0o755,
          size: 0,
          mtime: new Date(),
        };
      }
    }

    // Check if there are child mount points (making this a virtual directory)
    const childMounts = this.getChildMountPoints(normalized);
    if (childMounts.length > 0) {
      try {
        return await this.baseFs.lstat(normalized);
      } catch {
        return {
          isFile: false,
          isDirectory: true,
          isSymbolicLink: false,
          mode: 0o755,
          size: 0,
          mtime: new Date(),
        };
      }
    }

    // Route to the appropriate filesystem
    const { fs, relativePath } = this.routePath(path);
    return fs.lstat(relativePath);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const normalized = this.normalizePath(path);

    // Cannot create directory at mount point
    if (this.mounts.has(normalized)) {
      if (options?.recursive) {
        return; // Silently succeed like mkdir -p
      }
      throw new Error(`EEXIST: directory already exists, mkdir '${path}'`);
    }

    // Check if this would be a parent of a mount point
    const childMounts = this.getChildMountPoints(normalized);
    if (childMounts.length > 0 && options?.recursive) {
      // Virtual parent directory of mounts - consider it exists
      return;
    }

    const { fs, relativePath } = this.routePath(path);
    return fs.mkdir(relativePath, options);
  }

  async readdir(path: string): Promise<string[]> {
    const normalized = this.normalizePath(path);
    const entries = new Set<string>();
    let readdirError: Error | null = null;

    // Get entries from the owning filesystem
    const { fs, relativePath } = this.routePath(path);
    try {
      const fsEntries = await fs.readdir(relativePath);
      for (const entry of fsEntries) {
        entries.add(entry);
      }
    } catch (err) {
      // Path might not exist in base FS if only mount points are there
      const code = (err as { code?: string }).code;
      const message = (err as { message?: string }).message || "";

      if (code !== "ENOENT" && !message.includes("ENOENT")) {
        throw err;
      }
      // Save error to throw later if no mount points provide entries
      readdirError = err as Error;
    }

    // Add mount points that are immediate children
    const childMounts = this.getChildMountPoints(normalized);
    for (const child of childMounts) {
      entries.add(child);
    }

    // If no entries found and we had an error, throw the original error
    if (entries.size === 0 && readdirError && !this.mounts.has(normalized)) {
      throw readdirError;
    }

    return Array.from(entries).sort();
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const normalized = this.normalizePath(path);

    // Cannot remove mount points
    if (this.mounts.has(normalized)) {
      throw new Error(`EBUSY: mount point, cannot remove '${path}'`);
    }

    // Check if this contains mount points
    const childMounts = this.getChildMountPoints(normalized);
    if (childMounts.length > 0) {
      throw new Error(`EBUSY: contains mount points, cannot remove '${path}'`);
    }

    const { fs, relativePath } = this.routePath(path);
    return fs.rm(relativePath, options);
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const srcRoute = this.routePath(src);
    const destRoute = this.routePath(dest);

    // If same filesystem, delegate directly
    if (srcRoute.fs === destRoute.fs) {
      return srcRoute.fs.cp(
        srcRoute.relativePath,
        destRoute.relativePath,
        options,
      );
    }

    // Cross-mount copy
    return this.crossMountCopy(src, dest, options);
  }

  async mv(src: string, dest: string): Promise<void> {
    const normalized = this.normalizePath(src);

    // Cannot move mount points
    if (this.mounts.has(normalized)) {
      throw new Error(`EBUSY: mount point, cannot move '${src}'`);
    }

    const srcRoute = this.routePath(src);
    const destRoute = this.routePath(dest);

    // If same filesystem, delegate directly
    if (srcRoute.fs === destRoute.fs) {
      return srcRoute.fs.mv(srcRoute.relativePath, destRoute.relativePath);
    }

    // Cross-mount move: copy then delete
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
    const allPaths = new Set<string>();

    // Get paths from base filesystem
    for (const p of this.baseFs.getAllPaths()) {
      allPaths.add(p);
    }

    // Add mount point directories and their parent paths
    for (const mountPoint of this.mounts.keys()) {
      // Add all parent directories of the mount point
      const parts = mountPoint.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current = `${current}/${part}`;
        allPaths.add(current);
      }

      // Get paths from mounted filesystem, prefixed with mount point
      const entry = this.mounts.get(mountPoint);
      if (!entry) continue;
      for (const p of entry.filesystem.getAllPaths()) {
        if (p === "/") {
          allPaths.add(mountPoint);
        } else {
          allPaths.add(`${mountPoint}${p}`);
        }
      }
    }

    return Array.from(allPaths).sort();
  }

  async chmod(path: string, mode: number): Promise<void> {
    const normalized = this.normalizePath(path);

    // Cannot chmod mount points directly
    const mountEntry = this.mounts.get(normalized);
    if (mountEntry) {
      return mountEntry.filesystem.chmod("/", mode);
    }

    const { fs, relativePath } = this.routePath(path);
    return fs.chmod(relativePath, mode);
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    const { fs, relativePath } = this.routePath(linkPath);
    return fs.symlink(target, relativePath);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    const existingRoute = this.routePath(existingPath);
    const newRoute = this.routePath(newPath);

    // Hard links must be within the same filesystem
    if (existingRoute.fs !== newRoute.fs) {
      throw new Error(
        `EXDEV: cross-device link not permitted, link '${existingPath}' -> '${newPath}'`,
      );
    }

    return existingRoute.fs.link(
      existingRoute.relativePath,
      newRoute.relativePath,
    );
  }

  async readlink(path: string): Promise<string> {
    const { fs, relativePath } = this.routePath(path);
    return fs.readlink(relativePath);
  }

  /**
   * Resolve all symlinks in a path to get the canonical physical path.
   * This is equivalent to POSIX realpath().
   */
  async realpath(path: string): Promise<string> {
    const normalized = this.normalizePath(path);

    // Check if this is exactly a mount point
    const mountEntry = this.mounts.get(normalized);
    if (mountEntry) {
      // Mount point itself - return the mount point path
      return normalized;
    }

    // Route to the appropriate filesystem
    const { fs, relativePath } = this.routePath(path);

    // Get realpath from the underlying filesystem
    const resolvedRelative = await fs.realpath(relativePath);

    // Find the mount point for this path
    for (const [mp, _entry] of this.mounts) {
      if (normalized === mp || normalized.startsWith(`${mp}/`)) {
        // Path is within this mount - reconstruct full path
        if (resolvedRelative === "/") {
          return mp;
        }
        return `${mp}${resolvedRelative}`;
      }
    }

    // Path is in the base filesystem
    return resolvedRelative;
  }

  /**
   * Perform a cross-mount copy operation.
   */
  private async crossMountCopy(
    src: string,
    dest: string,
    options?: CpOptions,
  ): Promise<void> {
    const srcStat = await this.lstat(src);

    if (srcStat.isFile) {
      const content = await this.readFileBuffer(src);
      await this.writeFile(dest, content);
      await this.chmod(dest, srcStat.mode);
    } else if (srcStat.isDirectory) {
      if (!options?.recursive) {
        throw new Error(`cp: ${src} is a directory (not copied)`);
      }
      await this.mkdir(dest, { recursive: true });
      const children = await this.readdir(src);
      for (const child of children) {
        const srcChild = src === "/" ? `/${child}` : `${src}/${child}`;
        const destChild = dest === "/" ? `/${child}` : `${dest}/${child}`;
        await this.crossMountCopy(srcChild, destChild, options);
      }
    } else if (srcStat.isSymbolicLink) {
      const target = await this.readlink(src);
      await this.symlink(target, dest);
    }
  }

  /**
   * Set access and modification times of a file
   * @param path - The file path
   * @param atime - Access time
   * @param mtime - Modification time
   */
  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    const { fs, relativePath } = this.routePath(path);
    return fs.utimes(relativePath, atime, mtime);
  }
}

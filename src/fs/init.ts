/**
 * Filesystem Initialization
 *
 * Sets up the default filesystem structure for the bash environment
 * including /dev, /proc, and common directories.
 */

import { formatProcStatus, KERNEL_VERSION } from "../shell-metadata.js";
import type { IFileSystem } from "./interface.js";

/**
 * Interface for filesystems that support sync initialization
 * (both InMemoryFs and OverlayFs implement these)
 */
interface SyncInitFs {
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  writeFileSync(path: string, content: string | Uint8Array): void;
}

/**
 * Check if filesystem supports sync initialization
 */
function isSyncInitFs(fs: IFileSystem): fs is IFileSystem & SyncInitFs {
  const maybeFs = fs as unknown as Partial<SyncInitFs>;
  return (
    typeof maybeFs.mkdirSync === "function" &&
    typeof maybeFs.writeFileSync === "function"
  );
}

/**
 * Initialize common directories like /home/user and /tmp
 */
function initCommonDirectories(
  fs: SyncInitFs,
  useDefaultLayout: boolean,
): void {
  // Always create /bin for PATH-based command resolution
  fs.mkdirSync("/bin", { recursive: true });
  fs.mkdirSync("/usr/bin", { recursive: true });

  // Create additional directories only for default layout
  if (useDefaultLayout) {
    fs.mkdirSync("/home/user", { recursive: true });
    fs.mkdirSync("/tmp", { recursive: true });
  }
}

/**
 * Initialize /dev with common device files
 */
function initDevFiles(fs: SyncInitFs): void {
  fs.mkdirSync("/dev", { recursive: true });
  fs.writeFileSync("/dev/null", "");
  fs.writeFileSync("/dev/zero", new Uint8Array(0));
  fs.writeFileSync("/dev/stdin", "");
  fs.writeFileSync("/dev/stdout", "");
  fs.writeFileSync("/dev/stderr", "");
}

/**
 * Initialize /proc with simulated process information
 */
function initProcFiles(fs: SyncInitFs): void {
  fs.mkdirSync("/proc/self/fd", { recursive: true });

  // Kernel version (from shared metadata)
  fs.writeFileSync("/proc/version", `${KERNEL_VERSION}\n`);

  // Process info (from shared metadata)
  fs.writeFileSync("/proc/self/exe", "/bin/bash");
  fs.writeFileSync("/proc/self/cmdline", "bash\0");
  fs.writeFileSync("/proc/self/comm", "bash\n");
  fs.writeFileSync("/proc/self/status", formatProcStatus());

  // File descriptors
  fs.writeFileSync("/proc/self/fd/0", "/dev/stdin");
  fs.writeFileSync("/proc/self/fd/1", "/dev/stdout");
  fs.writeFileSync("/proc/self/fd/2", "/dev/stderr");
}

/**
 * Initialize the filesystem with standard directories and files
 * Works with both InMemoryFs and OverlayFs (both write to memory)
 */
export function initFilesystem(
  fs: IFileSystem,
  useDefaultLayout: boolean,
): void {
  // Initialize for filesystems that support sync methods (InMemoryFs and OverlayFs)
  if (isSyncInitFs(fs)) {
    initCommonDirectories(fs, useDefaultLayout);
    initDevFiles(fs);
    initProcFiles(fs);
  }
}

/**
 * Shell Metadata
 *
 * Shared source of truth for shell version and process information.
 * Used by both variable expansion ($BASH_VERSION, $PPID, etc.)
 * and /proc filesystem initialization.
 */

/**
 * Simulated bash version string
 */
export const BASH_VERSION = "5.1.0(1)-release";

/**
 * Simulated kernel version for /proc/version
 */
export const KERNEL_VERSION =
  "Linux version 5.15.0-generic (just-bash) #1 SMP PREEMPT";

/**
 * Get process metadata (values that come from the running Node process)
 */
export function getProcessInfo(): {
  pid: number;
  ppid: number;
  uid: number;
  gid: number;
} {
  return {
    pid: process.pid,
    ppid: process.ppid,
    uid: process.getuid?.() ?? 1000,
    gid: process.getgid?.() ?? 1000,
  };
}

/**
 * Format /proc/self/status content
 */
export function formatProcStatus(): string {
  const { pid, ppid, uid, gid } = getProcessInfo();
  return `Name:\tbash
State:\tR (running)
Pid:\t${pid}
PPid:\t${ppid}
Uid:\t${uid}\t${uid}\t${uid}\t${uid}
Gid:\t${gid}\t${gid}\t${gid}\t${gid}
`;
}

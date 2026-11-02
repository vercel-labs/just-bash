import type { FsStat } from "../fs/interface.js";
import type { VirtualFileMetadata } from "../types.js";

/** Filesystems without allocation metadata use one shared block estimate. */
export function allocatedFileBytes(
  stat: FsStat,
  metadata?: VirtualFileMetadata,
): number {
  if (stat.isSymbolicLink) return 0;
  if (stat.isDirectory) return metadata?.directorySize ?? stat.size;
  const unit = metadata?.allocationBlockSize ?? 4096;
  return Math.ceil(stat.size / unit) * unit;
}

/** GNU ls/du -h: base 1024, round upward, one decimal below ten units. */
export function formatHumanSize(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  const units = "KMGTPEZY";
  let divisor = 1024;
  let unit = 0;
  while (bytes / divisor >= 1024 && unit < units.length - 1) {
    divisor *= 1024;
    unit++;
  }
  let value = bytes / divisor;
  value = value < 10 ? Math.ceil(value * 10) / 10 : Math.ceil(value);
  if (value >= 1024 && unit < units.length - 1) {
    value = 1;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : value}${units[unit]}`;
}

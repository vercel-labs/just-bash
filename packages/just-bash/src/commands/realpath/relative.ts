/** True when `path` is `base` itself or below it. */
export function isUnder(base: string, path: string): boolean {
  return base === "/" || path === base || path.startsWith(`${base}/`);
}

/**
 * Express canonical `path` relative to canonical `base`, as GNU
 * `realpath --relative-to` does: `.` when they are the same, and `..` hops
 * when `path` is outside `base`.
 */
export function relativeTo(base: string, path: string): string {
  if (path === base) return ".";

  const baseParts = base.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);

  let shared = 0;
  while (
    shared < baseParts.length &&
    shared < pathParts.length &&
    baseParts[shared] === pathParts[shared]
  ) {
    shared++;
  }

  const hops = baseParts.slice(shared).fill("..");
  const parts = [...hops, ...pathParts.slice(shared)];
  return parts.length === 0 ? "." : parts.join("/");
}

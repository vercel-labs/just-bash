import * as fs from "node:fs";
import * as nodePath from "node:path";
import { type Lookup, PathError } from "./physical-path.js";
import * as paths from "./real-fs-utils.js";

type Request = { path: string; parent: boolean };
type Resolver = (options: { path: string }) => string | null;
type ResolverKey = "resolvePath" | "resolveParent";
type HostPathAccess = Record<ResolverKey, Resolver> & { lookup: Lookup };
type Options = {
  root: string;
  canonicalRoot: string;
  virtualRoot: string;
  allowSymlinks: boolean;
};
export function createHostPathAccess(options: Options): HostPathAccess {
  const { root, canonicalRoot, virtualRoot, allowSymlinks } = options;
  const resolve = ({ path, parent }: Request): string | null => {
    const normalized = paths.normalizePath(path);
    const relative = nodePath.posix.relative(virtualRoot, normalized);
    if (relative === ".." || relative.startsWith("../")) return null;
    const host = nodePath.resolve(root, relative);
    if (!paths.isPathWithinRoot(host, root)) return null;
    const leaf = parent && relative ? nodePath.basename(host) : "";
    const candidate = leaf ? nodePath.dirname(host) : host;
    const canonical = allowSymlinks
      ? paths.resolveCanonicalPath(candidate, canonicalRoot)
      : paths.resolveCanonicalPathNoSymlinks(candidate, root, canonicalRoot);
    return canonical && leaf ? nodePath.join(canonical, leaf) : canonical;
  };
  const resolvePath = ({ path }: { path: string }): string | null =>
    resolve({ path, parent: false });
  const resolveParent = ({ path }: { path: string }): string | null =>
    resolve({ path, parent: true });
  const lookup: Lookup = async ({ path }) => {
    const host = resolveParent({ path });
    if (!host) return { kind: "blocked" };
    try {
      const stat = await fs.promises.lstat(host);
      if (!stat.isSymbolicLink())
        return { kind: stat.isDirectory() ? "directory" : "file" };
      if (!allowSymlinks) return { kind: "blocked" };
      const raw = await fs.promises.readlink(host);
      if (!raw || raw.includes("\0")) return { kind: "blocked" };
      let target = raw;
      if (nodePath.isAbsolute(target)) {
        const base = [root, canonicalRoot].find((candidate) =>
          paths.isPathWithinRoot(target, candidate),
        );
        if (!base) return { kind: "blocked" };
        const relative = nodePath.relative(base, target).replaceAll("\\", "/");
        target = relative
          ? `${virtualRoot === "/" ? "" : virtualRoot}/${relative}`
          : virtualRoot;
      }
      return { kind: "symlink", target, root: virtualRoot, reject: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new PathError((error as NodeJS.ErrnoException).code ?? "EIO");
    }
  };
  return { resolvePath, resolveParent, lookup };
}

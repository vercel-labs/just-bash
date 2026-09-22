import * as fs from "node:fs";
import * as nodePath from "node:path";
import type { Lookup, ResolveFsPathOptions } from "./physical-path.js";
import { PathError } from "./physical-path.js";
import * as paths from "./real-fs-utils.js";

type ResolveRequest = Pick<ResolveFsPathOptions, "path"> & { parent: boolean };
type HostPathResolver = (
  options: Pick<ResolveFsPathOptions, "path">,
) => string | null;

type HostPathAccess = {
  resolvePath: HostPathResolver;
  resolveParent: HostPathResolver;
  lookup: Lookup;
};

/**
 * Configures translation between one virtual root and one host directory.
 *
 * `root` preserves the configured host spelling, while `canonicalRoot` is
 * that directory after OS-level symbolic-link resolution. `virtualRoot` is
 * the directory's location in the virtual filesystem. `allowSymlinks`
 * selects whether canonicalization may follow links inside the host root.
 */
export type CreateHostPathAccessOptions = {
  root: string;
  canonicalRoot: string;
  virtualRoot: string;
  allowSymlinks: boolean;
};

/**
 * Creates contained host-path resolvers and a physical-path lookup adapter.
 *
 * `resolvePath` canonicalizes the complete path, including its nearest
 * existing parent when the leaf is missing. `resolveParent` preserves the
 * final component for operations such as `lstat` and `readlink`. Every host
 * result is validated against the configured root before it is returned.
 */
export function createHostPathAccess(
  options: CreateHostPathAccessOptions,
): HostPathAccess {
  const { root, canonicalRoot, virtualRoot, allowSymlinks } = options;

  const resolve = ({ path, parent }: ResolveRequest): string | null => {
    const normalized = paths.normalizePath(path);
    const relative = nodePath.posix.relative(virtualRoot, normalized);

    if (relative === ".." || relative.startsWith("../")) {
      return null;
    }

    const host = nodePath.resolve(root, relative);
    if (!paths.isPathWithinRoot(host, root)) {
      return null;
    }

    const leaf = parent && relative ? nodePath.basename(host) : "";
    const candidate = leaf ? nodePath.dirname(host) : host;

    const canonical = allowSymlinks
      ? paths.resolveCanonicalPath(candidate, canonicalRoot)
      : paths.resolveCanonicalPathNoSymlinks(candidate, root, canonicalRoot);

    return canonical && leaf ? nodePath.join(canonical, leaf) : canonical;
  };

  const resolvePath: HostPathResolver = ({ path }) =>
    resolve({ path, parent: false });

  const resolveParent: HostPathResolver = ({ path }) =>
    resolve({ path, parent: true });

  const lookup: Lookup = async ({ path }) => {
    const host = resolveParent({ path });

    if (!host) {
      return { kind: "blocked" };
    }

    try {
      const stat = await fs.promises.lstat(host);

      if (!stat.isSymbolicLink()) {
        return { kind: stat.isDirectory() ? "directory" : "file" };
      }

      if (!allowSymlinks) {
        return { kind: "blocked" };
      }

      const rawTarget = await fs.promises.readlink(host);
      if (!rawTarget || rawTarget.includes("\0")) {
        return { kind: "blocked" };
      }

      let target = rawTarget;

      if (nodePath.isAbsolute(target)) {
        const containingRoot = [root, canonicalRoot].find((candidate) =>
          paths.isPathWithinRoot(target, candidate),
        );

        if (!containingRoot) {
          return { kind: "blocked" };
        }

        const relative = nodePath
          .relative(containingRoot, target)
          .replaceAll("\\", "/");

        target = relative
          ? `${virtualRoot === "/" ? "" : virtualRoot}/${relative}`
          : virtualRoot;
      }

      return { kind: "symlink", target, root: virtualRoot, reject: true };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === "ENOENT") {
        return null;
      }

      throw new PathError(code ?? "EIO");
    }
  };

  return { resolvePath, resolveParent, lookup };
}

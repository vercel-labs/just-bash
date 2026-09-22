import { rethrowFatalExecutionError } from "../fatal-execution-error.js";
import * as execution from "../interpreter/errors.js";
import type { IFileSystem } from "./interface.js";
import { MAX_SYMLINK_DEPTH } from "./path-utils.js";

const MAX_WORK = 100_000;
const CHECKPOINT = 4096;
const messages = new Map([
  ["ENOENT", "no such file or directory"],
  ["ENOTDIR", "not a directory"],
  ["ELOOP", "too many levels of symbolic links"],
  ["EACCES", "permission denied"],
  ["EPERM", "operation not permitted"],
  ["EIO", "input/output error"],
]);
const BLOCKED = { kind: "blocked" } as const;
const DIRECTORY = { kind: "directory" } as const;
const FILE = { kind: "file" } as const;
export type Entry =
  | { kind: "directory" | "file" | "blocked" }
  | { kind: "symlink"; target: string; root: string; reject: boolean };
export type Lookup = (options: { path: string }) => Promise<Entry | null>;
export class PathError extends Error {}
type Stored = { type: "file" | "directory" | "symlink"; target?: string };
type Mount = { mountPoint: string; filesystem: IFileSystem };
type Registration = { fs: IFileSystem; lookup?: Lookup } & {
  entries?: ReadonlyMap<string, Stored>;
  deleted?: ReadonlySet<string>;
  fallback?: Lookup;
  base?: IFileSystem;
  mounts?: () => readonly Mount[];
};
const adapters = new WeakMap<IFileSystem, Registration>();
type LookupOptions = { fs: IFileSystem; path: string };
async function lookupFs({ fs, path }: LookupOptions): Promise<Entry | null> {
  const a = adapters.get(fs);
  if (a?.lookup) return a.lookup({ path });
  if (a?.entries) {
    if (a.deleted?.has(path)) return null;
    const entry = a.entries.get(path);
    if (!entry) return a.fallback?.({ path }) ?? null;
    if (entry.type !== "symlink")
      return entry.type === "directory" ? DIRECTORY : FILE;
    if (!entry.target) return BLOCKED;
    return { kind: "symlink", target: entry.target, root: "/", reject: false };
  }
  if (a?.base) {
    let mount: Mount | undefined;
    const prefix = path === "/" ? "/" : `${path}/`;
    for (const entry of a.mounts?.() ?? []) {
      const { mountPoint } = entry;
      if (path === mountPoint || mountPoint.startsWith(prefix))
        return DIRECTORY;
      if (path.startsWith(`${mountPoint}/`)) mount = entry;
    }
    const result = await lookupFs({
      fs: mount?.filesystem ?? a.base,
      path: mount ? path.slice(mount.mountPoint.length) || "/" : path,
    });
    if (!mount || !result || result.kind !== "symlink") return result;
    const addMount = (value: string): string =>
      value === "/" ? mount.mountPoint : `${mount.mountPoint}${value}`;
    const target = result.target.startsWith("/")
      ? addMount(result.target)
      : result.target;
    return { ...result, target, root: addMount(result.root) };
  }
  try {
    const stat = await fs.lstat(path);
    if (typeof stat?.isDirectory !== "boolean" || stat.isSymbolicLink !== false)
      return BLOCKED;
    return stat.isDirectory ? DIRECTORY : FILE;
  } catch (error) {
    rethrowFatalExecutionError(error);
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || /ENOENT|no such file/i.test(String(error)))
      return null;
    return BLOCKED;
  }
}
export const registerAdapter = (options: Registration): void =>
  void adapters.set(options.fs, options);
type Work = [part: string, root: string, reject: boolean];
type Target = { path: string; root: string; reject: boolean };
export async function resolvePhysicalPath(options: {
  path: string;
  mode: "existing" | "all-but-last";
  lookup: Lookup;
  signal?: AbortSignal;
}): Promise<string> {
  const { path, mode, lookup, signal } = options;
  if (!path || path.includes("\0")) throw new PathError("ENOENT");
  if (signal?.aborted) throw new execution.ExecutionAbortedError();
  const pending: Work[] = [];
  let work = 0;
  const push = ({ path: targetPath, root, reject }: Target): void => {
    const parts = targetPath.replace(/^\//, "").split("/");
    if (work + pending.length + parts.length > MAX_WORK) {
      throw new execution.ExecutionLimitError("realpath limit", "iterations");
    }
    for (let index = parts.length - 1; index >= 0; index--) {
      pending.push([parts[index], root, reject]);
    }
  };
  const initial = path.startsWith("/") ? path : `/${path}`;
  push({ path: initial, root: "", reject: false });
  let resolved = "";
  let links = 0;
  while (pending.length) {
    const [part, itemRoot, reject] = pending.pop() as Work;
    if (++work % CHECKPOINT === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) throw new execution.ExecutionAbortedError();
    }
    if (!part || part === ".") continue;
    if (part === "..") {
      if (resolved !== itemRoot) {
        resolved = resolved.slice(0, resolved.lastIndexOf("/"));
      } else if (reject) throw new PathError("ENOENT");
      continue;
    }
    const candidate = `${resolved}/${part}`;
    const entry = await lookup({ path: candidate });
    if (!entry) {
      const hasSuffix = pending.some(([part]) => part !== "");
      if (mode === "existing" || hasSuffix) throw new PathError("ENOENT");
      resolved = candidate;
      continue;
    }
    if (entry.kind === "blocked") throw new PathError("ENOENT");
    if (entry.kind !== "symlink") {
      if (entry.kind === "file" && pending.length)
        throw new PathError("ENOTDIR");
      resolved = candidate;
      continue;
    }
    if (++links >= MAX_SYMLINK_DEPTH) throw new PathError("ELOOP");
    const root = entry.root === "/" ? "" : entry.root;
    let target = entry.target;
    if (target.startsWith("/")) {
      resolved = root;
      target = target.slice(resolved.length);
    }
    push({ path: target, root, reject: entry.reject });
  }
  return resolved || "/";
}
export async function resolveFsPath(options: {
  fs: IFileSystem;
  path: string;
  cwd?: string;
  op?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { fs, path, cwd, op = "realpath", signal } = options;
  const unresolved =
    cwd === undefined || path.startsWith("/")
      ? path
      : `${cwd === "/" ? "" : cwd}/${path}`;
  try {
    if (!path) throw new PathError("ENOENT");
    return await resolvePhysicalPath({
      path: unresolved,
      lookup: ({ path }) => lookupFs({ fs, path }),
      signal,
      mode: cwd === undefined ? "existing" : "all-but-last",
    });
  } catch (error) {
    if (!(error instanceof PathError)) throw error;
    const code = messages.has(error.message) ? error.message : "EIO";
    throw new Error(`${code}: ${messages.get(code)}, ${op} '${path}'`);
  }
}

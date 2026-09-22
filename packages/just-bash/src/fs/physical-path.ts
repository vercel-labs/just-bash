import { rethrowFatalExecutionError } from "../fatal-execution-error.js";
import * as execution from "../interpreter/errors.js";
import type { IFileSystem } from "./interface.js";
import { MAX_SYMLINK_DEPTH } from "./path-utils.js";

const MAX_COMPONENT_WORK = 100_000;
const CANCELLATION_CHECKPOINT_INTERVAL = 4096;

const ERROR_MESSAGES = new Map([
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

/**
 * Describes one component without following a final symbolic link.
 *
 * Symbolic links carry the virtual root they are confined to. When `reject`
 * is set, parent traversal in the link target must not escape that root.
 */
export type Entry =
  | { kind: "directory" | "file" | "blocked" }
  | { kind: "symlink"; target: string; root: string; reject: boolean };

/**
 * Looks up one absolute virtual path for component-by-component resolution.
 */
export type Lookup = (
  options: Pick<ResolveFsPathOptions, "path">,
) => Promise<Entry | null>;

/**
 * Carries an errno-style path failure from traversal to the public formatter.
 */
export class PathError extends Error {}

type StoredEntry = {
  type: "file" | "directory" | "symlink";
  target?: string;
};

type MountedFileSystem = {
  mountPoint: string;
  filesystem: IFileSystem;
};

/**
 * Registers trusted lookup capabilities for a filesystem implementation.
 *
 * A filesystem provides either a direct `lookup`, an `entries` collection
 * with an optional fallback, or a `base` filesystem plus mount enumeration.
 * Registrations are held by object identity so script-controlled objects
 * cannot spoof access to an internal adapter.
 */
export type RegisterAdapterOptions = {
  fs: IFileSystem;
  lookup?: Lookup;
  entries?: ReadonlyMap<string, StoredEntry>;
  deleted?: ReadonlySet<string>;
  fallback?: Lookup;
  base?: IFileSystem;
  mounts?: () => readonly MountedFileSystem[];
};

const adapters = new WeakMap<IFileSystem, RegisterAdapterOptions>();

type LookupOptions = Pick<ResolveFsPathOptions, "fs" | "path">;

async function lookupFs({ fs, path }: LookupOptions): Promise<Entry | null> {
  const adapter = adapters.get(fs);

  if (adapter?.lookup) {
    return adapter.lookup({ path });
  }

  if (adapter?.entries) {
    if (adapter.deleted?.has(path)) {
      return null;
    }

    const entry = adapter.entries.get(path);
    if (!entry) {
      return adapter.fallback?.({ path }) ?? null;
    }

    if (entry.type !== "symlink") {
      return entry.type === "directory" ? DIRECTORY : FILE;
    }

    if (!entry.target) {
      return BLOCKED;
    }

    return { kind: "symlink", target: entry.target, root: "/", reject: false };
  }

  if (adapter?.base) {
    let mount: MountedFileSystem | undefined;
    const prefix = path === "/" ? "/" : `${path}/`;

    for (const entry of adapter.mounts?.() ?? []) {
      const { mountPoint } = entry;

      if (path === mountPoint || mountPoint.startsWith(prefix)) {
        return DIRECTORY;
      }

      if (path.startsWith(`${mountPoint}/`)) {
        mount = entry;
      }
    }

    const result = await lookupFs({
      fs: mount?.filesystem ?? adapter.base,
      path: mount ? path.slice(mount.mountPoint.length) || "/" : path,
    });

    if (!mount || !result || result.kind !== "symlink") {
      return result;
    }

    const toMountedPath = (value: string): string =>
      value === "/" ? mount.mountPoint : `${mount.mountPoint}${value}`;

    const target = result.target.startsWith("/")
      ? toMountedPath(result.target)
      : result.target;

    return { ...result, target, root: toMountedPath(result.root) };
  }

  /*
   * An unregistered custom filesystem may expose ordinary file and directory
   * metadata, but its symbolic links cannot be resolved safely without a
   * trusted adapter. Malformed results and unknown failures therefore fail
   * closed instead of entering the shared traversal.
   */
  try {
    const stat = await fs.lstat(path);

    if (
      typeof stat?.isDirectory !== "boolean" ||
      stat.isSymbolicLink !== false
    ) {
      return BLOCKED;
    }

    return stat.isDirectory ? DIRECTORY : FILE;
  } catch (error) {
    rethrowFatalExecutionError(error);

    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || /ENOENT|no such file/i.test(String(error))) {
      return null;
    }

    return BLOCKED;
  }
}

/**
 * Associates trusted resolver capabilities with a filesystem instance.
 */
export function registerAdapter(options: RegisterAdapterOptions): void {
  adapters.set(options.fs, options);
}

type PendingComponent = [part: string, root: string, rejectEscape: boolean];

type PendingTarget = {
  path: string;
  root: string;
  rejectEscape: boolean;
};

/**
 * Resolves a virtual path one component at a time without lexical
 * normalization before symbolic-link expansion.
 *
 * `existing` requires every component to exist. `all-but-last` additionally
 * permits one missing final component, matching GNU realpath's default mode.
 * Component work is bounded, and traversal periodically yields so abort
 * signals and the host event loop remain responsive for adversarial inputs.
 */
export async function resolvePhysicalPath(options: {
  path: string;
  mode: "existing" | "all-but-last";
  lookup: Lookup;
  signal?: AbortSignal;
}): Promise<string> {
  const { path, mode, lookup, signal } = options;

  if (!path || path.includes("\0")) {
    throw new PathError("ENOENT");
  }

  if (signal?.aborted) {
    throw new execution.ExecutionAbortedError();
  }

  const pending: PendingComponent[] = [];
  let work = 0;

  const pushTarget = ({
    path: targetPath,
    root,
    rejectEscape,
  }: PendingTarget): void => {
    const parts = targetPath.replace(/^\//, "").split("/");

    /*
     * Queued components count toward the limit immediately so one symbolic
     * link cannot enqueue unbounded work before the next loop iteration.
     */
    if (work + pending.length + parts.length > MAX_COMPONENT_WORK) {
      throw new execution.ExecutionLimitError("realpath limit", "iterations");
    }

    for (let index = parts.length - 1; index >= 0; index--) {
      pending.push([parts[index], root, rejectEscape]);
    }
  };

  const initial = path.startsWith("/") ? path : `/${path}`;
  pushTarget({ path: initial, root: "", rejectEscape: false });

  let resolved = "";
  let links = 0;

  while (pending.length) {
    const [part, itemRoot, rejectEscape] = pending.pop() as PendingComponent;

    if (++work % CANCELLATION_CHECKPOINT_INTERVAL === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      if (signal?.aborted) {
        throw new execution.ExecutionAbortedError();
      }
    }

    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (resolved !== itemRoot) {
        resolved = resolved.slice(0, resolved.lastIndexOf("/"));
      } else if (rejectEscape) {
        throw new PathError("ENOENT");
      }

      continue;
    }

    const candidate = `${resolved}/${part}`;
    const entry = await lookup({ path: candidate });

    if (!entry) {
      const hasSuffix = pending.some(([part]) => part !== "");

      if (mode === "existing" || hasSuffix) {
        throw new PathError("ENOENT");
      }

      resolved = candidate;
      continue;
    }

    if (entry.kind === "blocked") {
      throw new PathError("ENOENT");
    }

    if (entry.kind !== "symlink") {
      if (entry.kind === "file" && pending.length) {
        throw new PathError("ENOTDIR");
      }

      resolved = candidate;
      continue;
    }

    if (++links >= MAX_SYMLINK_DEPTH) {
      throw new PathError("ELOOP");
    }

    const root = entry.root === "/" ? "" : entry.root;
    let target = entry.target;

    if (target.startsWith("/")) {
      resolved = root;
      target = target.slice(resolved.length);
    }

    pushTarget({ path: target, root, rejectEscape: entry.reject });
  }

  return resolved || "/";
}

/**
 * Options for resolving a path through an `IFileSystem` adapter.
 *
 * Without `cwd`, the complete path must exist. Supplying `cwd` resolves a
 * relative path from that directory and permits a missing final component.
 * `op` affects only the operation name included in formatted errors.
 */
export type ResolveFsPathOptions = {
  fs: IFileSystem;
  path: string;
  cwd?: string;
  op?: string;
  signal?: AbortSignal;
};

/**
 * Resolves a filesystem path and formats traversal failures as virtual
 * filesystem errors without exposing adapter or host-path details.
 */
export async function resolveFsPath(
  options: ResolveFsPathOptions,
): Promise<string> {
  const { fs, path, cwd, op = "realpath", signal } = options;

  const unresolved =
    cwd === undefined || path.startsWith("/")
      ? path
      : `${cwd === "/" ? "" : cwd}/${path}`;

  try {
    if (!path) {
      throw new PathError("ENOENT");
    }

    return await resolvePhysicalPath({
      path: unresolved,
      lookup: ({ path }) => lookupFs({ fs, path }),
      signal,
      mode: cwd === undefined ? "existing" : "all-but-last",
    });
  } catch (error) {
    if (!(error instanceof PathError)) {
      throw error;
    }

    const code = ERROR_MESSAGES.has(error.message) ? error.message : "EIO";
    throw new Error(`${code}: ${ERROR_MESSAGES.get(code)}, ${op} '${path}'`);
  }
}

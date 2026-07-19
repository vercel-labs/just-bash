import type { ExecutionScope } from "../execution-scope.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../interpreter/errors.js";
import type { ExecutionLimits } from "../limits.js";
import type { FsStat, IFileSystem } from "./interface.js";
import {
  dirname,
  isSameOrDescendantPath,
  joinPath,
  normalizePath,
} from "./path-utils.js";
import { sanitizeErrorMessage } from "./sanitize-error.js";

declare const canonicalPathBrand: unique symbol;

/** A canonical virtual path proven to be inside a particular validation root. */
export type CanonicalPath<Policy extends string = string> = string & {
  readonly [canonicalPathBrand]: Policy;
};

export interface CanonicalPathPolicy<Policy extends string> {
  readonly name: Policy;
  readonly root: string;
}

export async function canonicalizePath<Policy extends string>(
  fs: IFileSystem,
  path: string,
  policy: CanonicalPathPolicy<Policy>,
): Promise<CanonicalPath<Policy>> {
  const canonical = normalizePath(await fs.realpath(path));
  if (!isSameOrDescendantPath(policy.root, canonical)) {
    throw new FileSystemPolicyError(
      "canonicalize",
      path,
      "path resolves outside the permitted root",
    );
  }
  return canonical as CanonicalPath<Policy>;
}

export class FileSystemPolicyError extends Error {
  readonly name = "FileSystemPolicyError";

  constructor(
    readonly operation: string,
    readonly virtualPath: string,
    message: string,
  ) {
    super(`${operation}: ${sanitizeErrorMessage(message)}`);
  }
}

export type SameFileResult = "same" | "different" | "unknown";
export type PathContainmentResult = "inside" | "outside" | "unknown";

function statIdentity(stat: FsStat): string | undefined {
  if (stat.identity !== undefined) return `identity:${stat.identity}`;
  if (stat.dev !== undefined && stat.ino !== undefined) {
    return `inode:${String(stat.dev)}:${String(stat.ino)}`;
  }
  return undefined;
}

/**
 * Conservatively compare two paths. `unknown` forces destructive callers to
 * stage work instead of treating an inability to prove identity as inequality.
 */
export async function compareFileIdentity(
  fs: IFileSystem,
  left: string,
  right: string,
): Promise<SameFileResult> {
  try {
    const [leftStat, rightStat] = await Promise.all([
      fs.stat(left),
      fs.stat(right),
    ]);
    const leftIdentity = statIdentity(leftStat);
    const rightIdentity = statIdentity(rightStat);
    if (leftIdentity !== undefined && rightIdentity !== undefined) {
      return leftIdentity === rightIdentity ? "same" : "different";
    }
  } catch {
    return "unknown";
  }

  try {
    const [leftReal, rightReal] = await Promise.all([
      fs.realpath(left),
      fs.realpath(right),
    ]);
    return normalizePath(leftReal) === normalizePath(rightReal)
      ? "same"
      : "different";
  } catch {
    return "unknown";
  }
}

/**
 * Resolve an existing destination or its nearest existing parent before a
 * recursive copy/move. This closes lexical-prefix gaps created by directory
 * aliases while retaining `unknown` for backends that cannot prove it.
 */
export async function compareCanonicalContainment(
  fs: IFileSystem,
  sourceDirectory: string,
  destination: string,
  budget?: FileTraversalBudget,
): Promise<PathContainmentResult> {
  let canonicalSource: string;
  try {
    canonicalSource = normalizePath(await fs.realpath(sourceDirectory));
  } catch {
    return "unknown";
  }

  let candidate = normalizePath(destination);
  while (true) {
    budget?.checkpoint();
    try {
      const canonicalCandidate = normalizePath(await fs.realpath(candidate));
      return isSameOrDescendantPath(canonicalSource, canonicalCandidate)
        ? "inside"
        : "outside";
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) return "unknown";
      candidate = parent;
    }
  }
}

export type SymlinkTraversalPolicy = "never" | "follow";

export interface TraversalBudgetOptions {
  readonly limits: Required<ExecutionLimits>;
  readonly signal?: AbortSignal;
  readonly executionScope?: ExecutionScope;
  readonly site: string;
  /** User-facing resource name for commands with established diagnostics. */
  readonly label?: string;
}

/** One shared, command-local view over the top-level execution work budget. */
export class FileTraversalBudget {
  private entries = 0;
  private work = 0;

  constructor(private readonly options: TraversalBudgetOptions) {}

  checkpoint(work = 1): void {
    if (this.options.signal?.aborted) throw new ExecutionAbortedError();
    this.options.executionScope?.throwIfAborted(this.options.site);
    if (
      !Number.isSafeInteger(work) ||
      work < 0 ||
      work > this.options.limits.maxTraversalWork - this.work
    ) {
      throw new ExecutionLimitError(
        `${this.options.site}: ${this.options.label ?? "filesystem traversal work"} limit exceeded (${this.options.limits.maxTraversalWork})`,
        "iterations",
      );
    }
    this.work += work;
    this.options.executionScope?.consumeWork(
      work,
      `${this.options.site} filesystem traversal`,
    );
  }

  visit(depth: number): void {
    this.checkpoint();
    if (depth > this.options.limits.maxTraversalDepth) {
      throw new ExecutionLimitError(
        `${this.options.site}: ${this.options.label ?? "filesystem traversal"} depth limit exceeded (${this.options.limits.maxTraversalDepth})`,
        "recursion",
      );
    }
    if (++this.entries > this.options.limits.maxTraversalEntries) {
      throw new ExecutionLimitError(
        `${this.options.site}: ${this.options.label ?? "filesystem traversal"} entry limit exceeded (${this.options.limits.maxTraversalEntries})`,
        "iterations",
      );
    }
  }
}

export interface TraversalEntry {
  readonly path: string;
  readonly depth: number;
  readonly stat: FsStat;
  readonly isSymlink: boolean;
  readonly phase: "enter" | "leave";
}

export interface TraverseFileTreeOptions extends TraversalBudgetOptions {
  readonly fs: IFileSystem;
  readonly root: string;
  readonly symlinks?: SymlinkTraversalPolicy;
  readonly includeLeave?: boolean;
  readonly budget?: FileTraversalBudget;
}

type StackItem =
  | { readonly kind: "enter"; readonly path: string; readonly depth: number }
  | {
      readonly kind: "leave";
      readonly path: string;
      readonly depth: number;
      readonly stat: FsStat;
      readonly isSymlink: boolean;
      readonly identity?: string;
    };

/**
 * Iterative, deterministic DFS. Directory identities stay active until their
 * leave marker, detecting ancestor symlink cycles without suppressing valid
 * aliases in separate branches.
 */
export async function traverseFileTree(
  options: TraverseFileTreeOptions,
  visitor: (entry: TraversalEntry) => void | Promise<void>,
): Promise<void> {
  const budget = options.budget ?? new FileTraversalBudget(options);
  const stack: StackItem[] = [
    { kind: "enter", path: normalizePath(options.root), depth: 0 },
  ];
  const activeDirectories = new Set<string>();

  while (stack.length > 0) {
    budget.checkpoint(0);
    const item = stack.pop();
    if (!item) break;

    if (item.kind === "leave") {
      if (options.includeLeave) {
        await visitor({
          path: item.path,
          depth: item.depth,
          stat: item.stat,
          isSymlink: item.isSymlink,
          phase: "leave",
        });
      }
      if (item.identity) activeDirectories.delete(item.identity);
      continue;
    }

    budget.visit(item.depth);
    const lstat = await options.fs.lstat(item.path);
    const isSymlink = lstat.isSymbolicLink;
    const stat =
      isSymlink && options.symlinks === "follow"
        ? await options.fs.stat(item.path)
        : lstat;

    await visitor({
      path: item.path,
      depth: item.depth,
      stat,
      isSymlink,
      phase: "enter",
    });

    if (!stat.isDirectory || (isSymlink && options.symlinks !== "follow")) {
      continue;
    }

    const identity =
      statIdentity(stat) ??
      (await options.fs
        .realpath(item.path)
        .then(normalizePath)
        .catch(() => undefined));
    if (identity !== undefined) {
      if (activeDirectories.has(identity)) {
        throw new FileSystemPolicyError(
          options.site,
          item.path,
          "symbolic-link directory cycle detected",
        );
      }
      activeDirectories.add(identity);
    }

    stack.push({
      kind: "leave",
      path: item.path,
      depth: item.depth,
      stat,
      isSymlink,
      identity,
    });
    const names = await options.fs.readdir(item.path);
    budget.checkpoint();
    names.sort((a, b) => a.localeCompare(b));
    for (let index = names.length - 1; index >= 0; index--) {
      stack.push({
        kind: "enter",
        path: joinPath(item.path, names[index]),
        depth: item.depth + 1,
      });
    }
  }
}

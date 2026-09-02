/**
 * Redirection Handling
 *
 * Handles output redirections:
 * - > : Write stdout to file
 * - >> : Append stdout to file
 * - 2> : Write stderr to file
 * - &> : Write both stdout and stderr to file
 * - >& : Redirect fd to another fd
 * - {fd}>file : Allocate FD and store in variable
 */

import type { HereDocNode, RedirectionNode, WordNode } from "../ast/types.js";
import {
  encodeUtf8ToBytes,
  latin1FromBytes,
  readBytesFrom,
  utf8ByteLength,
} from "../encoding.js";
import type { WritableFile } from "../fs/interface.js";
import type { ExecResult } from "../types.js";
import {
  ControlFlowError,
  ErrexitError,
  ExecutionLimitError,
  ExitError,
  ReturnError,
} from "./errors.js";
import {
  expandRedirectTarget,
  expandWord,
  hasQuotedMultiValueAt,
} from "./expansion.js";
import {
  closeFd,
  closeUnusedWritables,
  dupFd,
  type FdEntry,
  type FdSnapshot,
  FIRST_USER_FD,
  getFdAliasMembers,
  getFdEntry,
  isFdOpen,
  moveFd,
  readFd,
  rememberFd,
  restoreFds,
  setFdEntry,
  writeFdEntry,
} from "./fd-table.js";
import { checkReadonlyError } from "./helpers/readonly.js";
import { result as makeResult } from "./helpers/result.js";
import {
  effectiveRedirectFd,
  isNumericFdRedirection,
} from "./numeric-fd-redirects.js";
import type { InterpreterContext } from "./types.js";

/**
 * Check if a redirect target is valid for output (not a directory, respects noclobber).
 * Returns an error message string if invalid, null if valid.
 */
async function checkOutputRedirectTarget(
  ctx: InterpreterContext,
  filePath: string,
  target: string,
  options: { checkNoclobber?: boolean; isClobber?: boolean },
): Promise<string | null> {
  try {
    if (!(await ctx.fs.exists(filePath))) return null;
    const stat = await ctx.fs.stat(filePath);
    if (stat.isDirectory) {
      return `bash: ${target}: Is a directory\n`;
    }
    if (
      options.checkNoclobber &&
      ctx.state.options.noclobber &&
      !options.isClobber &&
      target !== "/dev/null"
    ) {
      return `bash: ${target}: cannot overwrite existing file\n`;
    }
  } catch {
    return `bash: ${target}: cannot open redirect target\n`;
  }
  return null;
}

/**
 * Determine the encoding to use for file I/O.
 * If all character codes are <= 127 (ASCII), use binary encoding (byte data).
 * Otherwise, use UTF-8 encoding (text with non-ASCII characters).
 * For performance, only check the first 8KB of large strings.
 *
 * Characters in the 128-255 range (e.g. Latin-1: Ü Ö Ä é è) need UTF-8
 * encoding because their multi-byte UTF-8 representation would be lost
 * if stored as single bytes via binary encoding.
 */
function getFileEncoding(content: string): "binary" | "utf8" {
  const SAMPLE_SIZE = 8192; // 8KB

  // For large strings, only check the first 8KB
  // This is sufficient since UTF-8 files typically have Unicode chars early
  const checkLength = Math.min(content.length, SAMPLE_SIZE);

  for (let i = 0; i < checkLength; i++) {
    if (content.charCodeAt(i) > 127) {
      return "utf8";
    }
  }
  return "binary";
}

/** Expanded targets keyed by their position in the original redirection list. */
export type ExpandedRedirectTargets = Map<number, string>;

type PreparedDupSource =
  | { kind: "standard"; fd: number }
  | { kind: "entry"; entry: FdEntry; descriptors: number[] };

export type PreparedDupSources = Map<number, PreparedDupSource>;

export type PreparedRedirections = {
  targets: ExpandedRedirectTargets;
  outputEntries: Map<number, FdEntry>;
  dupSources: PreparedDupSources;
  standardRoutes: Map<number, FdEntry>;
  stdin: string | undefined;
  stdinSourceFd: number;
  error: ExecResult | null;
  errorCause?: ExitError | ExecutionLimitError;
};

export type RedirectionPolicy = "scoped" | "bare" | "persistent";

export const SIMPLE_REDIRECTION_POLICY: RedirectionPolicy = "scoped";
export const BARE_REDIRECTION_POLICY: RedirectionPolicy = "bare";
export const EXEC_REDIRECTION_POLICY: RedirectionPolicy = "persistent";

type RedirectionTransactionState = {
  numericSnapshot: FdSnapshot;
  outputEntries: Map<number, FdEntry>;
  openedWritables: WritableFile[];
  fdVariableSnapshot: FdSnapshot;
  standardSnapshot: FdSnapshot;
  standardClosedSnapshot: Map<number, boolean>;
  fdVariableEnv: Map<string, string | undefined>;
  nextFd: number | undefined;
  policy: RedirectionPolicy;
};

export type RedirectionTransaction = {
  prepare: (inheritedStdin?: string) => Promise<PreparedRedirections>;
  finish: () => Promise<void>;
};

const fdLimitError = (ctx: InterpreterContext): ExecutionLimitError =>
  new ExecutionLimitError(
    `too many open file descriptors (max ${ctx.limits.maxFileDescriptors})`,
    "file_descriptors",
  );

const hasFdCapacity = (ctx: InterpreterContext, fd: number): boolean =>
  isFdOpen(ctx, fd) ||
  (ctx.state.fileDescriptors?.size ?? 0) < ctx.limits.maxFileDescriptors;

const nextFdVariable = (ctx: InterpreterContext): number => {
  let fd = Math.max(ctx.state.nextFd ?? 10, 10);
  while (isFdOpen(ctx, fd)) fd += 1;
  return fd;
};

const parseDupTarget = (
  target: string,
): { sourceFd: number; move: boolean } | null => {
  const move = target.endsWith("-");
  const sourceText = move ? target.slice(0, -1) : target;
  if (!/^\d+$/.test(sourceText)) return null;
  return { sourceFd: Number.parseInt(sourceText, 10), move };
};

const getDupSource = (
  ctx: InterpreterContext,
  sourceFd: number,
  input: boolean,
): PreparedDupSource | null => {
  const entry = getFdEntry(ctx, sourceFd);
  if (sourceFd < FIRST_USER_FD) {
    return entry
      ? { kind: "entry", entry, descriptors: getFdAliasMembers(ctx, sourceFd) }
      : { kind: "standard", fd: sourceFd };
  }
  if (!entry) return null;
  if (input) {
    return entry.kind === "input" ||
      entry.kind === "readwrite" ||
      entry.kind === "dup-in"
      ? { kind: "entry", entry, descriptors: getFdAliasMembers(ctx, sourceFd) }
      : null;
  }
  return entry.kind === "output" ||
    entry.kind === "readwrite" ||
    entry.kind === "dup-out"
    ? { kind: "entry", entry, descriptors: getFdAliasMembers(ctx, sourceFd) }
    : null;
};

function manageWritable(
  ctx: InterpreterContext,
  writable: WritableFile,
): WritableFile {
  let closePromise: Promise<void> | undefined;
  let unregisterCleanup = (): void => undefined;
  const managed: WritableFile = {
    write: (content, options) => {
      if (closePromise) {
        return Promise.reject(new Error("cannot write to a closed file"));
      }
      return writable.write(content, options);
    },
    close: () => {
      if (!closePromise) {
        unregisterCleanup();
        try {
          closePromise = Promise.resolve(writable.close());
        } catch (error) {
          closePromise = Promise.reject(error);
        }
      }
      return closePromise;
    },
  };
  unregisterCleanup = ctx.executionScope.registerCleanup(() => managed.close());
  return managed;
}

async function openOutputEntry(
  ctx: InterpreterContext,
  transaction: RedirectionTransactionState,
  index: number,
  target: string,
  append: boolean,
  isClobber: boolean,
  handleWriteError = true,
): Promise<{ entry?: FdEntry; error?: ExecResult }> {
  const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
  const error = await checkOutputRedirectTarget(ctx, filePath, target, {
    checkNoclobber: !append,
    isClobber,
  });
  if (error) return { error: makeResult("", error, 1) };
  if (target === "/dev/full") {
    return {
      error: makeResult("", "bash: /dev/full: No space left on device\n", 1),
    };
  }
  const opened = (entry: FdEntry): { entry: FdEntry } => {
    transaction.outputEntries.set(index, entry);
    return { entry };
  };
  if (target === "/dev/stdout") {
    return opened({ kind: "dup-out", sourceFd: 1 });
  }
  if (target === "/dev/stderr") {
    return opened({ kind: "dup-out", sourceFd: 2 });
  }
  try {
    if (ctx.fs.openWritable) {
      const writable = manageWritable(
        ctx,
        await ctx.fs.openWritable(filePath, {
          mode: append ? "append" : "truncate",
        }),
      );
      transaction.openedWritables.push(writable);
      return opened({ kind: "output", path: filePath, append, writable });
    }
    if (append) await ctx.fs.appendFile(filePath, "", "binary");
    else await ctx.fs.writeFile(filePath, "", "binary");
  } catch (error) {
    if (!handleWriteError) throw error;
    return {
      error: makeResult(
        "",
        `bash: ${target}: cannot open redirect target\n`,
        1,
      ),
    };
  }
  return opened({ kind: "output", path: filePath, append });
}

async function readInputEntry(
  ctx: InterpreterContext,
  target: string,
  readwrite: boolean,
): Promise<{ entry?: FdEntry; error?: ExecResult }> {
  const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
  try {
    const content = await ctx.fs.readFile(filePath);
    return readwrite
      ? {
          entry: {
            kind: "readwrite",
            path: filePath,
            position: 0,
            content,
          },
        }
      : { entry: { kind: "input", content } };
  } catch {
    if (!readwrite) {
      return {
        error: makeResult(
          "",
          `bash: ${target}: No such file or directory\n`,
          1,
        ),
      };
    }
    try {
      await ctx.fs.writeFile(filePath, "", "binary");
      return {
        entry: {
          kind: "readwrite",
          path: filePath,
          position: 0,
          content: "",
        },
      };
    } catch {
      return {
        error: makeResult(
          "",
          `bash: ${target}: No such file or directory\n`,
          1,
        ),
      };
    }
  }
}

const hereDocContent = async (
  ctx: InterpreterContext,
  hereDoc: HereDocNode,
): Promise<string> => {
  const content = await expandWord(ctx, hereDoc.content);
  return hereDoc.stripTabs
    ? content
        .split("\n")
        .map((line) => line.replace(/^\t+/, ""))
        .join("\n")
    : content;
};

/**
 * Expand and install one command's redirections in source order.
 *
 * Each redirect is fully prepared before the next begins. A later failure
 * therefore preserves earlier file effects and descriptor allocations, while
 * the failing redirect itself cannot mutate the descriptor table after an
 * unsuccessful open.
 */
async function prepareRedirectionsWithState(
  ctx: InterpreterContext,
  redirections: RedirectionNode[],
  inheritedStdin: string,
  transaction: RedirectionTransactionState,
): Promise<PreparedRedirections> {
  const targets: ExpandedRedirectTargets = new Map();
  const dupSources: PreparedDupSources = new Map();
  const standardRoute = (fd: number, fallback: FdEntry): FdEntry =>
    ctx.state.closedStandardFds?.has(fd)
      ? { kind: "closed" }
      : (getFdEntry(ctx, fd) ?? fallback);
  const standardRoutes = new Map<number, FdEntry>([
    [0, standardRoute(0, { kind: "dup-in", sourceFd: 0 })],
    [1, standardRoute(1, { kind: "dup-out", sourceFd: 1 })],
    [2, standardRoute(2, { kind: "dup-out", sourceFd: 2 })],
  ]);
  const snapshot = transaction.numericSnapshot;
  let stdin: string | undefined;
  let stdinSourceFd = -1;
  const initialStdin = standardRoutes.get(0);
  if (initialStdin?.kind === "input") {
    stdin = initialStdin.content;
    stdinSourceFd = 0;
  } else if (initialStdin?.kind === "readwrite") {
    stdin = initialStdin.content.slice(initialStdin.position);
    stdinSourceFd = 0;
  }
  const base = (): PreparedRedirections => ({
    targets,
    outputEntries: transaction.outputEntries,
    dupSources,
    standardRoutes,
    stdin,
    stdinSourceFd,
    error: null,
  });
  const fail = async (
    error: ExecResult,
    index: number,
    errorCause?: ExitError | ExecutionLimitError,
  ): Promise<PreparedRedirections> => {
    const prepared = {
      ...base(),
      error: await applyRedirections(
        ctx,
        error,
        redirections.slice(0, index),
        targets,
        transaction.outputEntries,
        dupSources,
        standardRoutes,
      ),
    };
    if (errorCause) {
      return { ...prepared, errorCause };
    }
    return prepared;
  };
  const requireCapacity = async (
    fd: number,
    index: number,
  ): Promise<PreparedRedirections | null> => {
    if (hasFdCapacity(ctx, fd)) return null;
    const cause = fdLimitError(ctx);
    return fail(
      makeResult("", cause.stderr, ExecutionLimitError.EXIT_CODE),
      index,
      cause,
    );
  };
  const persistStandard = (fd: number | null, entry: FdEntry): void => {
    if (fd !== null && fd < FIRST_USER_FD) standardRoutes.set(fd, entry);
    if (
      transaction.policy === "persistent" &&
      fd !== null &&
      fd < FIRST_USER_FD
    ) {
      ctx.state.closedStandardFds?.delete(fd);
      setFdEntry(ctx, fd, entry);
    }
  };
  const bindTemporaryStandard = (fd: number, entry: FdEntry): void => {
    standardRoutes.set(fd, entry);
    rememberFd(ctx, transaction.standardSnapshot, fd);
    if (!transaction.standardClosedSnapshot.has(fd)) {
      transaction.standardClosedSnapshot.set(
        fd,
        ctx.state.closedStandardFds?.has(fd) === true,
      );
    }
    ctx.state.closedStandardFds?.delete(fd);
    setFdEntry(ctx, fd, entry);
  };
  const getPreparedDupSource = (
    sourceFd: number,
    input: boolean,
  ): PreparedDupSource | null => {
    if (sourceFd < FIRST_USER_FD) {
      const entry = standardRoutes.get(sourceFd);
      if (entry?.kind === "closed") return null;
      return entry
        ? {
            kind: "entry",
            entry,
            descriptors: getFdAliasMembers(ctx, sourceFd),
          }
        : { kind: "standard", fd: sourceFd };
    }
    return getDupSource(ctx, sourceFd, input);
  };

  for (let index = 0; index < redirections.length; index++) {
    const redir = redirections[index];
    const effectiveFd = effectiveRedirectFd(redir);

    if (redir.target.type === "HereDoc") {
      const content = await hereDocContent(ctx, redir.target);
      if (redir.fdVariable) {
        try {
          checkReadonlyError(ctx, redir.fdVariable);
        } catch (error) {
          if (!(error instanceof ExitError)) throw error;
          return fail(
            makeResult(error.stdout, error.stderr, error.exitCode),
            index,
            error,
          );
        }
        const fd = nextFdVariable(ctx);
        const capacityError = await requireCapacity(fd, index);
        if (capacityError) return capacityError;
        rememberFd(ctx, transaction.fdVariableSnapshot, fd);
        if (!transaction.fdVariableEnv.has(redir.fdVariable)) {
          transaction.fdVariableEnv.set(
            redir.fdVariable,
            ctx.state.env.get(redir.fdVariable),
          );
        }
        setFdEntry(ctx, fd, { kind: "input", content });
        ctx.state.env.set(redir.fdVariable, String(fd));
        ctx.state.nextFd = fd + 1;
      } else if (effectiveFd !== null && effectiveFd >= FIRST_USER_FD) {
        const capacityError = await requireCapacity(effectiveFd, index);
        if (capacityError) return capacityError;
        rememberFd(ctx, snapshot, effectiveFd);
        setFdEntry(ctx, effectiveFd, { kind: "input", content });
      } else if (effectiveFd === 0 || effectiveFd === null) {
        stdin = latin1FromBytes(encodeUtf8ToBytes(content));
        stdinSourceFd = -1;
        persistStandard(effectiveFd, { kind: "input", content: stdin });
      } else {
        const entry: FdEntry = { kind: "input", content };
        if (transaction.policy === "persistent") {
          persistStandard(effectiveFd, entry);
        } else {
          bindTemporaryStandard(effectiveFd, entry);
        }
      }
      continue;
    }

    let target: string;
    const isDup = redir.operator === ">&" || redir.operator === "<&";
    if (isDup) {
      if (hasQuotedMultiValueAt(ctx, redir.target as WordNode)) {
        return fail(makeResult("", "bash: $@: ambiguous redirect\n", 1), index);
      }
      target = await expandWord(ctx, redir.target as WordNode);
    } else if (redir.operator === "<<<") {
      target = await expandWord(ctx, redir.target as WordNode);
    } else {
      const expanded = await expandRedirectTarget(
        ctx,
        redir.target as WordNode,
      );
      if ("error" in expanded) {
        return fail(makeResult("", expanded.error, 1), index);
      }
      target = expanded.target;
    }
    targets.set(index, target);

    if (target.includes("\0")) {
      return fail(
        makeResult(
          "",
          `bash: ${target.replace(/\0/g, "")}: No such file or directory\n`,
          1,
        ),
        index,
      );
    }

    if (redir.fdVariable) {
      try {
        checkReadonlyError(ctx, redir.fdVariable);
      } catch (error) {
        if (!(error instanceof ExitError)) throw error;
        return fail(
          makeResult(error.stdout, error.stderr, error.exitCode),
          index,
          error,
        );
      }

      if (isDup && target === "-") {
        const existingFd = Number.parseInt(
          ctx.state.env.get(redir.fdVariable) ?? "",
          10,
        );
        if (!Number.isNaN(existingFd)) {
          rememberFd(ctx, transaction.fdVariableSnapshot, existingFd);
          closeFd(ctx, existingFd);
        }
        continue;
      }

      const fd = nextFdVariable(ctx);
      const plannedDuplicate = isDup ? parseDupTarget(target) : null;
      if (plannedDuplicate) {
        const source = getPreparedDupSource(
          plannedDuplicate.sourceFd,
          redir.operator === "<&",
        );
        if (!source) {
          return fail(
            makeResult(
              "",
              `bash: ${plannedDuplicate.sourceFd}: Bad file descriptor\n`,
              1,
            ),
            index,
          );
        }
      }
      const netNeutralMove =
        plannedDuplicate?.move === true &&
        plannedDuplicate.sourceFd >= FIRST_USER_FD;
      if (!netNeutralMove) {
        const capacityError = await requireCapacity(fd, index);
        if (capacityError) return capacityError;
      }
      rememberFd(ctx, transaction.fdVariableSnapshot, fd);
      if (!transaction.fdVariableEnv.has(redir.fdVariable)) {
        transaction.fdVariableEnv.set(
          redir.fdVariable,
          ctx.state.env.get(redir.fdVariable),
        );
      }
      let entry: FdEntry | undefined;
      let duplicate: { sourceFd: number; move: boolean } | undefined;

      if (isDup) {
        const parsed = plannedDuplicate;
        if (!parsed) {
          if (redir.operator === "<&") {
            return fail(
              makeResult("", `bash: ${target}: ambiguous redirect\n`, 1),
              index,
            );
          }
          const opened = await openOutputEntry(
            ctx,
            transaction,
            index,
            target,
            false,
            false,
          );
          if (opened.error) return fail(opened.error, index);
          entry = opened.entry;
        } else {
          const source = getPreparedDupSource(
            parsed.sourceFd,
            redir.operator === "<&",
          );
          if (!source) {
            return fail(
              makeResult(
                "",
                `bash: ${parsed.sourceFd}: Bad file descriptor\n`,
                1,
              ),
              index,
            );
          }
          duplicate = parsed;
          if (source.kind === "standard") {
            entry = {
              kind: redir.operator === "<&" ? "dup-in" : "dup-out",
              sourceFd: source.fd,
            };
          } else if (parsed.sourceFd < FIRST_USER_FD) {
            entry = source.entry;
          }
        }
      } else if (
        redir.operator === ">" ||
        redir.operator === ">|" ||
        redir.operator === ">>" ||
        redir.operator === "&>" ||
        redir.operator === "&>>"
      ) {
        const append = redir.operator === ">>" || redir.operator === "&>>";
        const opened = await openOutputEntry(
          ctx,
          transaction,
          index,
          target,
          append,
          redir.operator === ">|",
        );
        if (opened.error) return fail(opened.error, index);
        entry = opened.entry;
      } else if (redir.operator === "<<<") {
        entry = { kind: "input", content: `${target}\n` };
      } else if (redir.operator === "<" || redir.operator === "<>") {
        const opened = await readInputEntry(
          ctx,
          target,
          redir.operator === "<>",
        );
        if (opened.error) return fail(opened.error, index);
        entry = opened.entry;
      }

      if (duplicate && duplicate.sourceFd >= FIRST_USER_FD) {
        const duplicated = duplicate.move
          ? moveFd(ctx, fd, duplicate.sourceFd)
          : dupFd(ctx, fd, duplicate.sourceFd);
        if (!duplicated) {
          return fail(
            makeResult(
              "",
              `bash: ${duplicate.sourceFd}: Bad file descriptor\n`,
              1,
            ),
            index,
          );
        }
      } else if (entry) {
        setFdEntry(ctx, fd, entry);
      }
      if (
        duplicate?.move &&
        duplicate.sourceFd !== fd &&
        duplicate.sourceFd < FIRST_USER_FD
      ) {
        closeFd(ctx, duplicate.sourceFd);
      }
      ctx.state.env.set(redir.fdVariable, String(fd));
      ctx.state.nextFd = fd + 1;
      continue;
    }

    if (isNumericFdRedirection(redir)) {
      const fd = effectiveFd as number;
      if (isDup && target === "-") {
        rememberFd(ctx, snapshot, fd);
        closeFd(ctx, fd);
        continue;
      }
      const plannedDuplicate = isDup ? parseDupTarget(target) : null;
      if (plannedDuplicate) {
        const source = getPreparedDupSource(
          plannedDuplicate.sourceFd,
          redir.operator === "<&",
        );
        if (!source) {
          return fail(
            makeResult(
              "",
              `bash: ${plannedDuplicate.sourceFd}: Bad file descriptor\n`,
              1,
            ),
            index,
          );
        }
      }
      const netNeutralMove =
        plannedDuplicate?.move === true &&
        plannedDuplicate.sourceFd >= FIRST_USER_FD;
      if (!netNeutralMove) {
        const capacityError = await requireCapacity(fd, index);
        if (capacityError) return capacityError;
      }
      rememberFd(ctx, snapshot, fd);

      if (isDup) {
        const parsed = plannedDuplicate;
        if (!parsed) {
          if (redir.operator === "<&") {
            return fail(
              makeResult("", `bash: ${target}: ambiguous redirect\n`, 1),
              index,
            );
          }
          const opened = await openOutputEntry(
            ctx,
            transaction,
            index,
            target,
            false,
            false,
          );
          if (opened.error) return fail(opened.error, index);
          setFdEntry(ctx, fd, opened.entry as FdEntry);
          continue;
        }
        const source = getPreparedDupSource(
          parsed.sourceFd,
          redir.operator === "<&",
        );
        if (!source) {
          return fail(
            makeResult(
              "",
              `bash: ${parsed.sourceFd}: Bad file descriptor\n`,
              1,
            ),
            index,
          );
        }
        if (source.kind === "standard") {
          setFdEntry(ctx, fd, {
            kind: redir.operator === "<&" ? "dup-in" : "dup-out",
            sourceFd: source.fd,
          });
        } else if (parsed.sourceFd < FIRST_USER_FD) {
          setFdEntry(ctx, fd, source.entry);
        } else if (
          !(parsed.move
            ? moveFd(ctx, fd, parsed.sourceFd)
            : dupFd(ctx, fd, parsed.sourceFd))
        ) {
          return fail(
            makeResult(
              "",
              `bash: ${parsed.sourceFd}: Bad file descriptor\n`,
              1,
            ),
            index,
          );
        }
        if (
          parsed.move &&
          parsed.sourceFd !== fd &&
          parsed.sourceFd < FIRST_USER_FD
        )
          closeFd(ctx, parsed.sourceFd);
        continue;
      }

      if (
        redir.operator === ">" ||
        redir.operator === ">|" ||
        redir.operator === ">>"
      ) {
        const opened = await openOutputEntry(
          ctx,
          transaction,
          index,
          target,
          redir.operator === ">>",
          redir.operator === ">|",
        );
        if (opened.error) return fail(opened.error, index);
        setFdEntry(ctx, fd, opened.entry as FdEntry);
      } else if (redir.operator === "<<<") {
        setFdEntry(ctx, fd, { kind: "input", content: `${target}\n` });
      } else if (redir.operator === "<" || redir.operator === "<>") {
        const opened = await readInputEntry(
          ctx,
          target,
          redir.operator === "<>",
        );
        if (opened.error) return fail(opened.error, index);
        setFdEntry(ctx, fd, opened.entry as FdEntry);
      }
      continue;
    }

    if (isDup) {
      if (target === "-") {
        if (effectiveFd === 0) {
          stdin = "";
          stdinSourceFd = -1;
        }
        if (effectiveFd !== null && effectiveFd < FIRST_USER_FD) {
          standardRoutes.set(effectiveFd, { kind: "closed" });
          if (transaction.policy === "persistent") {
            closeFd(ctx, effectiveFd);
            ctx.state.closedStandardFds ??= new Set();
            ctx.state.closedStandardFds.add(effectiveFd);
          }
        }
        continue;
      }
      const parsed = parseDupTarget(target);
      if (!parsed) {
        if (redir.operator === "<&") {
          return fail(
            makeResult("", `bash: ${target}: ambiguous redirect\n`, 1),
            index,
          );
        }
        const opened = await openOutputEntry(
          ctx,
          transaction,
          index,
          target,
          false,
          false,
          false,
        );
        if (opened.error) return fail(opened.error, index);
        const entry = opened.entry as FdEntry;
        dupSources.set(index, {
          kind: "entry",
          entry,
          descriptors: [],
        });
        if (redir.fd == null) {
          persistStandard(1, entry);
          persistStandard(2, entry);
        } else {
          persistStandard(effectiveFd, entry);
        }
        continue;
      }
      const source = getPreparedDupSource(
        parsed.sourceFd,
        redir.operator === "<&",
      );
      if (!source) {
        return fail(
          makeResult("", `bash: ${parsed.sourceFd}: Bad file descriptor\n`, 1),
          index,
        );
      }
      dupSources.set(index, source);
      if (
        source.kind === "entry" &&
        transaction.policy === "persistent" &&
        effectiveFd !== null &&
        effectiveFd < FIRST_USER_FD &&
        parsed.sourceFd >= FIRST_USER_FD
      ) {
        if (!dupFd(ctx, effectiveFd, parsed.sourceFd)) {
          return fail(
            makeResult(
              "",
              `bash: ${parsed.sourceFd}: Bad file descriptor\n`,
              1,
            ),
            index,
          );
        }
        standardRoutes.set(
          effectiveFd,
          getFdEntry(ctx, effectiveFd) as FdEntry,
        );
        ctx.state.closedStandardFds?.delete(effectiveFd);
      } else if (source.kind === "standard") {
        persistStandard(effectiveFd, {
          kind: redir.operator === "<&" ? "dup-in" : "dup-out",
          sourceFd: source.fd,
        });
      } else {
        persistStandard(effectiveFd, source.entry);
      }
      if (redir.operator === "<&" && effectiveFd === 0) {
        if (source.kind === "standard") {
          stdin = source.fd === 0 ? inheritedStdin : "";
          stdinSourceFd = -1;
        } else if (
          source.entry.kind === "input" ||
          source.entry.kind === "readwrite"
        ) {
          const readable =
            parsed.sourceFd < FIRST_USER_FD && !isFdOpen(ctx, parsed.sourceFd)
              ? {
                  content:
                    source.entry.kind === "input"
                      ? source.entry.content
                      : source.entry.content.slice(source.entry.position),
                }
              : readFd(ctx, parsed.sourceFd);
          if ("error" in readable) {
            return fail(
              makeResult(
                "",
                `bash: ${parsed.sourceFd}: Bad file descriptor\n`,
                1,
              ),
              index,
            );
          }
          stdin = readable.content;
          stdinSourceFd = isFdOpen(ctx, parsed.sourceFd) ? parsed.sourceFd : -1;
        } else {
          stdin = inheritedStdin;
          stdinSourceFd = -1;
        }
      }
      if (parsed.move) {
        if (parsed.sourceFd >= FIRST_USER_FD) {
          closeFd(ctx, parsed.sourceFd);
        } else {
          standardRoutes.set(parsed.sourceFd, { kind: "closed" });
          if (transaction.policy === "persistent") {
            closeFd(ctx, parsed.sourceFd);
            ctx.state.closedStandardFds ??= new Set();
            ctx.state.closedStandardFds.add(parsed.sourceFd);
          }
        }
      }
      continue;
    }

    if (
      redir.operator === ">" ||
      redir.operator === ">|" ||
      redir.operator === ">>" ||
      redir.operator === "&>" ||
      redir.operator === "&>>"
    ) {
      const opened = await openOutputEntry(
        ctx,
        transaction,
        index,
        target,
        redir.operator === ">>" || redir.operator === "&>>",
        redir.operator === ">|",
        false,
      );
      if (opened.error) return fail(opened.error, index);
      const entry = opened.entry as FdEntry;
      if (redir.operator === "&>" || redir.operator === "&>>") {
        persistStandard(1, entry);
        persistStandard(2, entry);
      } else {
        persistStandard(effectiveFd, entry);
      }
      continue;
    }

    if (redir.operator === "<<<") {
      stdin = latin1FromBytes(encodeUtf8ToBytes(`${target}\n`));
      stdinSourceFd = -1;
      persistStandard(effectiveFd, { kind: "input", content: stdin });
    } else if (redir.operator === "<") {
      const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
      try {
        stdin = (await readBytesFrom(ctx.fs, filePath)) as unknown as string;
        stdinSourceFd = -1;
        persistStandard(effectiveFd, { kind: "input", content: stdin });
      } catch {
        return fail(
          makeResult("", `bash: ${target}: No such file or directory\n`, 1),
          index,
        );
      }
    } else if (redir.operator === "<>") {
      const opened = await readInputEntry(ctx, target, true);
      if (opened.error) return fail(opened.error, index);
      const entry = opened.entry as FdEntry;
      persistStandard(effectiveFd, entry);
      if (effectiveFd === 0 && entry.kind === "readwrite") {
        stdin = entry.content;
        stdinSourceFd = -1;
      }
    }
  }

  return base();
}

export function createRedirectionTransaction(
  ctx: InterpreterContext,
  redirections: RedirectionNode[],
  policy: RedirectionPolicy,
): RedirectionTransaction {
  const state: RedirectionTransactionState = {
    numericSnapshot: new Map(),
    outputEntries: new Map(),
    openedWritables: [],
    fdVariableSnapshot: new Map(),
    standardSnapshot: new Map(),
    standardClosedSnapshot: new Map(),
    fdVariableEnv: new Map(),
    nextFd: ctx.state.nextFd,
    policy,
  };
  let finished = false;
  return {
    prepare: (inheritedStdin = "") =>
      prepareRedirectionsWithState(ctx, redirections, inheritedStdin, state),
    finish: async () => {
      if (finished) return;
      finished = true;
      if (policy !== "persistent") {
        restoreFds(ctx, state.numericSnapshot);
      }
      if (policy !== "persistent") {
        restoreFds(ctx, state.standardSnapshot);
        for (const [fd, wasClosed] of state.standardClosedSnapshot) {
          if (wasClosed) {
            ctx.state.closedStandardFds ??= new Set();
            ctx.state.closedStandardFds.add(fd);
          } else {
            ctx.state.closedStandardFds?.delete(fd);
          }
        }
      }
      if (policy === "bare") {
        restoreFds(ctx, state.fdVariableSnapshot);
        for (const [name, value] of state.fdVariableEnv) {
          if (value === undefined) ctx.state.env.delete(name);
          else ctx.state.env.set(name, value);
        }
        ctx.state.nextFd = state.nextFd;
      }
      await closeUnusedWritables(ctx, state.openedWritables);
    },
  };
}

export function preparedRedirectionError(
  prepared: PreparedRedirections,
): ExecResult {
  if (!prepared.error) throw new Error("Expected a redirection error");
  if (prepared.errorCause) {
    prepared.errorCause.stdout = prepared.error.stdout;
    prepared.errorCause.stderr = prepared.error.stderr;
    throw prepared.errorCause;
  }
  return prepared.error;
}

export async function routeControlFlowError(
  ctx: InterpreterContext,
  error: ControlFlowError,
  redirections: RedirectionNode[],
  prepared: PreparedRedirections,
): Promise<void> {
  const exitCode =
    error instanceof ExitError ||
    error instanceof ReturnError ||
    error instanceof ErrexitError
      ? error.exitCode
      : error instanceof ExecutionLimitError
        ? ExecutionLimitError.EXIT_CODE
        : 0;
  const routed = await applyRedirections(
    ctx,
    makeResult(error.stdout, error.stderr, exitCode),
    redirections,
    prepared.targets,
    prepared.outputEntries,
    prepared.dupSources,
    prepared.standardRoutes,
  );
  error.stdout = routed.stdout;
  error.stderr = routed.stderr;
  error.internalOutputAccounting = routed.internalOutputAccounting ?? {
    stdout: utf8ByteLength(routed.stdout),
    stderr: utf8ByteLength(routed.stderr),
  };
}

export async function withPreparedRedirections(
  ctx: InterpreterContext,
  redirections: RedirectionNode[],
  inheritedStdin: string,
  run: (prepared: PreparedRedirections) => Promise<ExecResult>,
): Promise<ExecResult> {
  const transaction = createRedirectionTransaction(
    ctx,
    redirections,
    SIMPLE_REDIRECTION_POLICY,
  );
  let prepared: PreparedRedirections | undefined;
  try {
    prepared = await transaction.prepare(inheritedStdin);
    if (prepared.error) return preparedRedirectionError(prepared);
    const savedGroupStdin = ctx.state.groupStdin;
    const savedGroupStdinSourceFd = ctx.state.groupStdinSourceFd;
    if (prepared.stdin !== undefined) {
      ctx.state.groupStdin = prepared.stdin;
      ctx.state.groupStdinSourceFd = prepared.stdinSourceFd;
    }
    try {
      const result = await run(prepared);
      return await applyRedirections(
        ctx,
        result,
        redirections,
        prepared.targets,
        prepared.outputEntries,
        prepared.dupSources,
        prepared.standardRoutes,
      );
    } finally {
      if (prepared.stdin !== undefined) {
        ctx.state.groupStdin = savedGroupStdin;
        ctx.state.groupStdinSourceFd = savedGroupStdinSourceFd;
      }
    }
  } catch (error) {
    if (!(error instanceof ControlFlowError) || !prepared) throw error;
    await routeControlFlowError(ctx, error, redirections, prepared);
    throw error;
  } finally {
    await transaction.finish();
  }
}

export async function applyRedirections(
  ctx: InterpreterContext,
  result: ExecResult,
  redirections: RedirectionNode[],
  targets: ExpandedRedirectTargets,
  outputEntries: Map<number, FdEntry> = new Map(),
  dupSources: PreparedDupSources = new Map(),
  standardRoutes: Map<number, FdEntry> = new Map(),
  writeErrorCommand = "bash",
  omitShellPrefix = false,
): Promise<ExecResult> {
  // Output redirected away from the caller still consumes the shared budget.
  // Unredirected pipeline output is charged once at the pipeline boundary.
  if (redirections.length > 0) {
    result = ctx.executionScope.accountResult(result, "redirection");
  }
  let { stdout, stderr, exitCode } = result;

  // Determine encoding for stdout writes from the producer's explicit
  // shape rather than guessing at the bytes:
  //   - `stdoutKind: "bytes"` (or legacy `stdoutEncoding: "binary"` —
  //     cat, gzip, base64 -d, ...): stdout is already a latin1 byte
  //     buffer; write binary so the bytes round-trip verbatim.
  //   - everything else (echo, printf, sed, jq, custom commands that
  //     leave the field unset): stdout is JS Unicode text; write UTF-8.
  //
  // The default is text — never the content-sampling heuristic. The
  // sampler reads only the first 8 KiB and would mis-classify long
  // mostly-ASCII output that happens to have its first non-ASCII char
  // past the window, picking binary and truncating downstream codepoints
  // to their low byte.
  const stdoutIsBytes =
    result.stdoutKind === "bytes" ||
    (result.stdoutKind === undefined && result.stdoutEncoding === "binary");
  const stdoutFileEncoding: "binary" | "utf8" = stdoutIsBytes
    ? "binary"
    : "utf8";
  const getStdoutEncoding = (_content: string): "binary" | "utf8" =>
    stdoutFileEncoding;

  // Where fds 1 and 2 point after replaying the already-prepared redirection
  // list. File targets were opened before command execution; this pass only
  // selects sinks. Duplication operators (`2>&1`, `1>&2`) re-point the fd to a
  // snapshot of the source fd's current sink. Content still held in
  // a stream when the list ends is delivered to that fd's final sink below —
  // so `cmd > file 2>&1` sends stderr to `file`, `cmd 2>&1 > file` sends
  // stderr to the caller's stdout, and `cmd > all 2>&1 2> err` lets the
  // later `2> err` reclaim stderr.
  type OutputEntry = Extract<FdEntry, { kind: "output" }>;
  type RedirectSink =
    | { kind: "live-stdout" }
    | { kind: "live-stderr" }
    | { kind: "file"; entry: OutputEntry }
    | {
        kind: "descriptor";
        source: Extract<PreparedDupSource, { kind: "entry" }>;
      }
    | { kind: "invalid-output"; fd: 1 | 2 }
    | { kind: "discard" };
  let fd1Sink: RedirectSink = { kind: "live-stdout" };
  let fd2Sink: RedirectSink = { kind: "live-stderr" };
  const sinkFromDupSource = (
    source: PreparedDupSource | undefined,
  ): RedirectSink | null => {
    if (!source) return null;
    if (source.kind === "entry") {
      if (source.entry.kind === "dup-out") {
        if (source.entry.sourceFd === 1) return { kind: "live-stdout" };
        if (source.entry.sourceFd === 2) return { kind: "live-stderr" };
      }
      if (source.entry.kind === "output" || source.entry.kind === "readwrite") {
        return { kind: "descriptor", source };
      }
      return null;
    }
    if (source.fd === 1) return fd1Sink;
    if (source.fd === 2) return fd2Sink;
    return null;
  };
  const persistentSink = (fd: 1 | 2): RedirectSink | null => {
    const entry = standardRoutes.get(fd) ?? getFdEntry(ctx, fd);
    if (!entry) return null;
    if (entry.kind === "closed") return { kind: "invalid-output", fd };
    if (entry.kind === "input" || entry.kind === "dup-in") {
      return { kind: "invalid-output", fd };
    }
    if (entry.kind === "dup-out") {
      if (entry.sourceFd === 1) return { kind: "live-stdout" };
      if (entry.sourceFd === 2) return { kind: "live-stderr" };
      return null;
    }
    if (entry.kind === "output" || entry.kind === "readwrite") {
      return {
        kind: "descriptor",
        source: {
          kind: "entry",
          entry,
          descriptors: getFdAliasMembers(ctx, fd),
        },
      };
    }
    return null;
  };
  fd1Sink = persistentSink(1) ?? fd1Sink;
  fd2Sink = persistentSink(2) ?? fd2Sink;

  for (let i = 0; i < redirections.length; i++) {
    const redir = redirections[i];
    if (redir.target.type === "HereDoc") {
      continue;
    }

    // FD variable redirections were expanded, opened, and allocated before
    // command execution. They do not route this command's stdout or stderr.
    if (redir.fdVariable) {
      continue;
    }

    const target = targets.get(i);
    if (target === undefined) continue;

    switch (redir.operator) {
      case ">":
      case ">|":
      case ">>": {
        const fd = redir.fd ?? 1;
        if (fd !== 1 && fd !== 2) {
          break;
        }
        const isAppend = redir.operator === ">>";
        // Opening /dev/stdout or /dev/stderr duplicates the CURRENT target
        // of fd 1 / fd 2, like `N>&1` / `N>&2`: `> /dev/stderr` re-points
        // fd 1 to wherever fd 2 points right now, and the self-referential
        // forms (`> /dev/stdout`, `2> /dev/stderr`) are no-ops — after
        // `> a > /dev/stdout` content still goes to `a`.
        if (target === "/dev/stdout") {
          if (fd === 2) {
            fd2Sink = fd1Sink;
          }
          break;
        }
        if (target === "/dev/stderr") {
          if (fd === 1) {
            fd1Sink = fd2Sink;
          }
          break;
        }
        // /dev/full always returns ENOSPC when written to. The diagnostic
        // stays on live stderr and the fd's sink is left unchanged.
        if (target === "/dev/full") {
          stderr += `bash: echo: write error: No space left on device\n`;
          exitCode = 1;
          if (fd === 1) {
            stdout = "";
          }
          break;
        }
        // /dev/null on fd 2 drops stderr without touching the VFS node.
        // /dev/null on fd 1 intentionally falls through to the generic file
        // path: in this VFS it is a regular file, not a true discard device
        // (see overlay-fs.security.test.ts "/dev file overwrite behavior").
        if (target === "/dev/null" && fd === 2) {
          fd2Sink = { kind: "discard" };
          break;
        }
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        const preparedEntry = outputEntries.get(i);
        const entry: OutputEntry =
          preparedEntry?.kind === "output"
            ? preparedEntry
            : { kind: "output", path: filePath, append: isAppend };
        if (fd === 1) {
          fd1Sink = { kind: "file", entry };
        } else {
          fd2Sink = { kind: "file", entry };
        }
        break;
      }

      case ">&":
      case "<&": {
        const fd = redir.fd ?? (redir.operator === "<&" ? 0 : 1);
        if (fd >= FIRST_USER_FD || fd === 0) break;
        if (target === "-") {
          if (fd === 1) fd1Sink = { kind: "discard" };
          else fd2Sink = { kind: "discard" };
          break;
        }
        const sourceSink = sinkFromDupSource(dupSources.get(i));
        if (!sourceSink) break;
        if (redir.fd == null && parseDupTarget(target) === null) {
          fd1Sink = sourceSink;
          fd2Sink = sourceSink;
        } else if (fd === 1) {
          fd1Sink = sourceSink;
        } else if (fd === 2) {
          fd2Sink = sourceSink;
        }
        break;
      }

      case "&>":
      case "&>>": {
        const append = redir.operator === "&>>";
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        const preparedEntry = outputEntries.get(i);
        const entry: OutputEntry =
          preparedEntry?.kind === "output"
            ? preparedEntry
            : { kind: "output", path: filePath, append };
        fd1Sink = { kind: "file", entry };
        fd2Sink = fd1Sink;
        break;
      }
    }
  }

  // Deliver content still held in the streams to each fd's final sink.
  // "live-stdout" / "live-stderr" mean the caller's own streams as they were
  // before any redirection — a dup snapshot of a live fd keeps pointing
  // there even if a later redirection sends the source fd elsewhere.
  //
  // A duplication (`2>&1`) shares the source fd's sink OBJECT — one open
  // descriptor, so both streams go through it in order. Two independent
  // redirects that happen to name the same path (`> f 2> f`) are separate
  // descriptors, each writing from its own start position, so the later
  // non-empty write clobbers the earlier one — matching bash's
  // independent-open behavior.
  if (stdout !== "" || stderr !== "") {
    let pendingStdout = stdout;
    let pendingStderr = stderr;
    stdout = "";
    stderr = "";
    if (fd1Sink.kind === "invalid-output" && pendingStdout !== "") {
      pendingStdout = "";
      pendingStderr += `${omitShellPrefix ? "" : "bash: "}${writeErrorCommand}: write error: Bad file descriptor\n`;
      exitCode = 1;
    }
    if (fd2Sink.kind === "invalid-output") pendingStderr = "";
    const deliverToFile = async (
      sink: Extract<RedirectSink, { kind: "file" }>,
      content: string,
      encoding: "binary" | "utf8",
    ) => {
      if (sink.entry.writable) {
        await sink.entry.writable.write(content, encoding);
      } else if (sink.entry.append) {
        await ctx.fs.appendFile(sink.entry.path, content, encoding);
      } else {
        await ctx.fs.writeFile(sink.entry.path, content, encoding);
      }
    };
    if (
      fd1Sink === fd2Sink &&
      (fd1Sink.kind === "file" || fd1Sink.kind === "descriptor")
    ) {
      // stdout-then-stderr order, not the command's temporal write order:
      // ExecResult accumulates the two streams separately, so interleaving
      // is not recorded anywhere in the interpreter. This matches the
      // convention of the live-stream merge (`stdout += stderr`) used for a
      // bare `2>&1`.
      const combined = pendingStdout + pendingStderr;
      if (combined !== "") {
        if (fd1Sink.kind === "file") {
          await deliverToFile(fd1Sink, combined, getStdoutEncoding(combined));
        } else {
          await writeFdEntry(
            ctx,
            fd1Sink.source.entry,
            fd1Sink.source.descriptors,
            combined,
            getStdoutEncoding(combined),
          );
        }
      }
    } else {
      for (const [content, sink, isStdout] of [
        [pendingStdout, fd1Sink, true],
        [pendingStderr, fd2Sink, false],
      ] as const) {
        if (content === "") {
          continue;
        }
        switch (sink.kind) {
          case "live-stdout":
            stdout += content;
            break;
          case "live-stderr":
            stderr += content;
            break;
          case "file":
            await deliverToFile(
              sink,
              content,
              isStdout ? getStdoutEncoding(content) : getFileEncoding(content),
            );
            break;
          case "descriptor":
            await writeFdEntry(
              ctx,
              sink.source.entry,
              sink.source.descriptors,
              content,
              isStdout ? getStdoutEncoding(content) : getFileEncoding(content),
            );
            break;
          case "invalid-output":
            break;
          case "discard":
            break;
        }
      }
    }
  }

  const finalResult = makeResult(stdout, stderr, exitCode);
  // Preserve the upstream's stdout shape through the redirection layer so
  // the next stage (pipeline glue, output boundary) can tell bytes-shaped
  // output from text-shaped output. Both the new `stdoutKind` field and
  // the legacy `stdoutEncoding` alias are forwarded.
  if (result.stdoutKind) {
    finalResult.stdoutKind = result.stdoutKind;
  }
  if (result.stdoutEncoding === "binary") {
    finalResult.stdoutEncoding = "binary";
  }
  if (result.internalPipeStatusOverride) {
    finalResult.internalPipeStatusOverride = result.internalPipeStatusOverride;
  }
  const hasOutputRedirection =
    redirections.length > 0 ||
    ctx.state.fileDescriptors?.has(1) === true ||
    ctx.state.fileDescriptors?.has(2) === true;
  if (hasOutputRedirection) {
    const priorTotal =
      (result.internalOutputAccounting?.stdout ?? 0) +
      (result.internalOutputAccounting?.stderr ?? 0);
    const finalStdoutBytes = utf8ByteLength(finalResult.stdout);
    const finalStderrBytes = utf8ByteLength(finalResult.stderr);
    const inheritedStdout = Math.min(finalStdoutBytes, priorTotal);
    finalResult.internalOutputAccounting = {
      stdout: inheritedStdout,
      stderr: Math.min(finalStderrBytes, priorTotal - inheritedStdout),
    };
    ctx.executionScope.accountResult(finalResult, "redirection");
  } else if (result.internalOutputAccounting) {
    finalResult.internalOutputAccounting = result.internalOutputAccounting;
  }
  return finalResult;
}

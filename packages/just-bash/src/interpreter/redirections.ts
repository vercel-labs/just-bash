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

import type { RedirectionNode, WordNode } from "../ast/types.js";
import { utf8ByteLength } from "../encoding.js";
import type { ExecResult, OutputChunk } from "../types.js";
import {
  expandRedirectTarget,
  expandWord,
  hasQuotedMultiValueAt,
} from "./expansion.js";
import {
  closeFd,
  dupFd,
  type FdEntry,
  FIRST_USER_FD,
  getFdEntry,
  setFdEntry,
} from "./fd-table.js";
import { checkReadonlyError } from "./helpers/readonly.js";
import { checkFdLimit, result as makeResult } from "./helpers/result.js";
import { isNumericFdRedirection } from "./numeric-fd-redirects.js";
import type { InterpreterContext } from "./types.js";

class RedirectTargetDoesNotExist extends Error {}

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

/**
 * Pre-expanded redirect targets, keyed by index into the redirections array.
 * This allows us to expand redirect targets (including side effects) before
 * executing a function body, then apply the redirections after.
 */
export type ExpandedRedirectTargets = Map<number, string>;

/**
 * Pre-expand redirect targets for function definitions.
 * This is needed because redirections on function definitions are evaluated
 * each time the function is called, and any side effects (like $((i++)))
 * must occur BEFORE the function body executes.
 */
export async function preExpandRedirectTargets(
  ctx: InterpreterContext,
  redirections: RedirectionNode[],
  alreadyExpanded?: ExpandedRedirectTargets,
): Promise<{ targets: ExpandedRedirectTargets; error?: string }> {
  const targets: ExpandedRedirectTargets = new Map(alreadyExpanded);

  for (let i = 0; i < redirections.length; i++) {
    const redir = redirections[i];
    if (redir.target.type === "HereDoc") {
      continue;
    }
    // Targets the numeric-fd pass already expanded must not be expanded
    // again — a command substitution in a redirect target runs once.
    if (targets.has(i)) {
      continue;
    }

    const isFdRedirect = redir.operator === ">&" || redir.operator === "<&";
    if (isFdRedirect) {
      // Check for "$@" with multiple positional params - this is an ambiguous redirect
      if (hasQuotedMultiValueAt(ctx, redir.target as WordNode)) {
        return { targets, error: "bash: $@: ambiguous redirect\n" };
      }
      targets.set(i, await expandWord(ctx, redir.target as WordNode));
    } else {
      const expandResult = await expandRedirectTarget(
        ctx,
        redir.target as WordNode,
      );
      if ("error" in expandResult) {
        return { targets, error: expandResult.error };
      }
      targets.set(i, expandResult.target);
    }
  }

  return { targets };
}

/**
 * Allocate the next available file descriptor (starting at 10).
 * Returns the allocated FD number.
 */
function allocateFd(ctx: InterpreterContext): number {
  if (ctx.state.nextFd === undefined) {
    ctx.state.nextFd = 10;
  }
  const fd = ctx.state.nextFd;
  const maxFds = ctx.limits.maxFileDescriptors;
  if (fd >= maxFds) {
    throw new Error(
      `bash: cannot allocate file descriptor: too many open files (max ${maxFds})`,
    );
  }
  ctx.state.nextFd++;
  return fd;
}

/**
 * Process FD variable redirections ({varname}>file syntax).
 * This allocates FDs and sets variables before command execution.
 * Returns an error result if there's an issue, or null if successful.
 */
export async function processFdVariableRedirections(
  ctx: InterpreterContext,
  redirections: RedirectionNode[],
  preExpandedTargets?: ExpandedRedirectTargets,
): Promise<ExecResult | null> {
  for (let index = 0; index < redirections.length; index++) {
    const redir = redirections[index];
    if (!redir.fdVariable || redir.target.type !== "Word") continue;
    checkReadonlyError(ctx, redir.fdVariable);

    const isFdRedirect = redir.operator === ">&" || redir.operator === "<&";
    let target = preExpandedTargets?.get(index);
    if (target !== undefined) {
      // Prepared by the compound-command open step; never expand it again.
    } else if (isFdRedirect) {
      if (hasQuotedMultiValueAt(ctx, redir.target as WordNode))
        return makeResult("", "bash: $@: ambiguous redirect\n", 1);
      target = await expandWord(ctx, redir.target as WordNode);
    } else {
      const expanded = await expandRedirectTarget(
        ctx,
        redir.target as WordNode,
      );
      if ("error" in expanded) return makeResult("", expanded.error, 1);
      target = expanded.target;
    }

    if (target.includes("\0"))
      return makeResult(
        "",
        `bash: ${target.replace(/\0/g, "")}: No such file or directory\n`,
        1,
      );

    ctx.state.fileDescriptors ??= new Map();
    if (isFdRedirect && target === "-") {
      const existingFd = ctx.state.env.get(redir.fdVariable);
      if (existingFd !== undefined) {
        const fdNum = Number.parseInt(existingFd, 10);
        if (!Number.isNaN(fdNum)) closeFd(ctx, fdNum);
      }
      continue;
    }

    let fdInfo: FdEntry | undefined;
    if (isFdRedirect) {
      const sourceFd = Number.parseInt(target, 10);
      if (!Number.isNaN(sourceFd)) fdInfo = getFdEntry(ctx, sourceFd);
    } else if (
      redir.operator === ">" ||
      redir.operator === ">>" ||
      redir.operator === ">|" ||
      redir.operator === "&>" ||
      redir.operator === "&>>"
    ) {
      const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
      const append = redir.operator === ">>" || redir.operator === "&>>";
      const redirectOptions = append
        ? { checkNoclobber: false }
        : { checkNoclobber: true, isClobber: redir.operator === ">|" };
      const error = await checkOutputRedirectTarget(
        ctx,
        filePath,
        target,
        redirectOptions,
      );
      if (error) return makeResult("", error, 1);
      checkFdLimit(ctx);
      if (append) await ctx.fs.appendFile(filePath, "", "binary");
      else await ctx.fs.writeFile(filePath, "", "binary");
      fdInfo = { kind: "output", path: filePath, append };
    } else if (redir.operator === "<<<") {
      fdInfo = { kind: "input", content: `${target}\n` };
    } else if (redir.operator === "<" || redir.operator === "<>") {
      try {
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        fdInfo = { kind: "input", content: await ctx.fs.readFile(filePath) };
      } catch {
        return makeResult(
          "",
          `bash: ${target}: No such file or directory\n`,
          1,
        );
      }
    }

    checkFdLimit(ctx);
    const fd = allocateFd(ctx);
    ctx.state.env.set(redir.fdVariable, String(fd));
    if (fdInfo !== undefined) setFdEntry(ctx, fd, fdInfo);
  }

  return null; // Success
}

/**
 * Pre-open (truncate) output redirect files before command execution.
 * This is needed for compound commands (subshell, for, case, [[) where
 * bash opens/truncates the redirect file BEFORE evaluating any words in
 * the command body (including command substitutions).
 *
 * Example: `(echo \`cat FILE\`) > FILE`
 * - Bash first truncates FILE (making it empty)
 * - Then executes the subshell, where `cat FILE` returns empty string
 *
 * Returns an error result if there's an issue (like directory or noclobber),
 * or null if pre-opening succeeded.
 */
export async function preOpenOutputRedirects(
  ctx: InterpreterContext,
  redirections: RedirectionNode[],
  alreadyExpanded?: ExpandedRedirectTargets,
): Promise<{
  targets: ExpandedRedirectTargets;
  error: ExecResult | null;
}> {
  for (const redirection of redirections) {
    if (redirection.fdVariable) checkReadonlyError(ctx, redirection.fdVariable);
  }
  const expanded = await preExpandRedirectTargets(
    ctx,
    redirections,
    alreadyExpanded,
  );
  if (expanded.error)
    return {
      targets: expanded.targets,
      error: makeResult("", expanded.error, 1),
    };

  const targetsToOpen: Array<{ filePath: string; target: string }> = [];
  for (let index = 0; index < redirections.length; index++) {
    const redir = redirections[index];
    if (redir.target.type === "HereDoc") {
      continue;
    }

    // Descriptors named by number are opened (and truncated) by the
    // numeric-fd pass, which runs before this one.
    if (isNumericFdRedirection(redir)) {
      continue;
    }

    // Only handle output truncation redirects (>, >|, &>)
    // Append (>>, &>>) doesn't need pre-truncation
    // >&word needs special handling - it's a file redirect only if word is not a number
    const isGreaterAmpersand = redir.operator === ">&";
    if (
      redir.operator !== ">" &&
      redir.operator !== ">|" &&
      redir.operator !== "&>" &&
      !isGreaterAmpersand
    ) {
      continue;
    }

    // Expand redirect target with glob handling (failglob, ambiguous redirect)
    // For >&, use plain expansion first to check if it's a number
    const target = expanded.targets.get(index);
    if (target === undefined) continue;
    if (isGreaterAmpersand) {
      // If it's a number, -, or has explicit fd, it's an FD redirect, not a file redirect
      if (
        target === "-" ||
        !Number.isNaN(Number.parseInt(target, 10)) ||
        redir.fd != null
      ) {
        continue;
      }
    }
    const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
    const isClobber = redir.operator === ">|";

    // Reject paths containing null bytes - these cause filesystem errors
    // and are never valid in bash
    if (filePath.includes("\0")) {
      return {
        targets: expanded.targets,
        error: makeResult(
          "",
          `bash: ${target}: No such file or directory\n`,
          1,
        ),
      };
    }

    // Check if target is a directory or noclobber prevents overwrite
    try {
      const exists = await ctx.fs.exists(filePath);
      if (!exists) throw new RedirectTargetDoesNotExist();
      const stat = await ctx.fs.stat(filePath);
      if (stat.isDirectory) {
        return {
          targets: expanded.targets,
          error: makeResult("", `bash: ${target}: Is a directory\n`, 1),
        };
      }
      // Check noclobber: if file exists and noclobber is set, refuse to overwrite
      // unless using >| (clobber operator) or writing to /dev/null
      if (
        ctx.state.options.noclobber &&
        !isClobber &&
        !stat.isDirectory &&
        target !== "/dev/null"
      ) {
        return {
          targets: expanded.targets,
          error: makeResult(
            "",
            `bash: ${target}: cannot overwrite existing file\n`,
            1,
          ),
        };
      }
    } catch (error) {
      if (!(error instanceof RedirectTargetDoesNotExist)) {
        return {
          targets: expanded.targets,
          error: makeResult(
            "",
            `bash: ${target}: cannot open redirect target\n`,
            1,
          ),
        };
      }
    }

    // /dev/full always returns ENOSPC when written to
    if (target === "/dev/full") {
      return {
        targets: expanded.targets,
        error: makeResult("", `bash: /dev/full: No space left on device\n`, 1),
      };
    }
    if (
      target !== "/dev/null" &&
      target !== "/dev/stdout" &&
      target !== "/dev/stderr"
    )
      targetsToOpen.push({ filePath, target });
  }

  // Only begin destructive opens after every target has expanded and passed
  // policy validation. This prevents a later directory/noclobber failure from
  // leaving an earlier redirect truncated.
  for (const { filePath, target } of targetsToOpen) {
    try {
      await ctx.fs.writeFile(filePath, "", "binary");
    } catch {
      return {
        targets: expanded.targets,
        error: makeResult(
          "",
          `bash: ${target}: cannot open redirect target\n`,
          1,
        ),
      };
    }
  }

  return { targets: expanded.targets, error: null };
}

/**
 * The two streams merged into one, in the order the interpreter recorded them,
 * so a duplication like `2>&1` splices stderr where it was written instead of
 * appending it after all of stdout.
 *
 * Falls back to stdout-then-stderr whenever the recorded chunks no longer
 * reconstruct both pending strings exactly -- a single command records no
 * order, and the redirection list above may have rewritten a stream (an
 * ambiguous-redirect message, a target that failed to open). Reconstructing
 * rather than trusting the chunks keeps content authoritative: the merge can
 * reorder, never invent or drop.
 */
function mergeInRecordedOrder(
  chunks: OutputChunk[] | undefined,
  pendingStdout: string,
  pendingStderr: string,
): string {
  if (!chunks?.length) {
    return pendingStdout + pendingStderr;
  }
  let recordedStdout = "";
  let recordedStderr = "";
  for (const chunk of chunks) {
    if (chunk.stream === "stdout") recordedStdout += chunk.text;
    else recordedStderr += chunk.text;
  }
  if (recordedStdout !== pendingStdout || recordedStderr !== pendingStderr) {
    return pendingStdout + pendingStderr;
  }
  return chunks.map((chunk) => chunk.text).join("");
}

export async function applyRedirections(
  ctx: InterpreterContext,
  result: ExecResult,
  redirections: RedirectionNode[],
  preExpandedTargets?: ExpandedRedirectTargets,
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

  // Where fds 1 and 2 currently point as the redirection list is processed
  // left to right. File redirections write their stream eagerly and update
  // the fd's sink; duplication operators (`2>&1`, `1>&2`) only re-point the
  // fd to a snapshot of the source fd's current sink. Content still held in
  // a stream when the list ends is delivered to that fd's final sink below —
  // so `cmd > file 2>&1` sends stderr to `file`, `cmd 2>&1 > file` sends
  // stderr to the caller's stdout, and `cmd > all 2>&1 2> err` lets the
  // later `2> err` reclaim stderr.
  type RedirectSink =
    | { kind: "live-stdout" }
    | { kind: "live-stderr" }
    | { kind: "file"; path: string; append: boolean }
    | { kind: "discard" };
  let fd1Sink: RedirectSink = { kind: "live-stdout" };
  let fd2Sink: RedirectSink = { kind: "live-stderr" };

  for (let i = 0; i < redirections.length; i++) {
    const redir = redirections[i];
    if (redir.target.type === "HereDoc") {
      continue;
    }

    // Use pre-expanded target if available, otherwise expand now
    let target: string;
    const preExpanded = preExpandedTargets?.get(i);
    if (preExpanded !== undefined) {
      target = preExpanded;
    } else {
      // For FD-to-FD redirects (>&), use plain expansion without glob handling
      // For file redirects, use glob expansion with failglob/ambiguous redirect handling
      const isFdRedirect = redir.operator === ">&" || redir.operator === "<&";
      if (isFdRedirect) {
        // Check for "$@" with multiple positional params - this is an ambiguous redirect
        if (hasQuotedMultiValueAt(ctx, redir.target as WordNode)) {
          stderr += "bash: $@: ambiguous redirect\n";
          exitCode = 1;
          stdout = "";
          continue;
        }
        target = await expandWord(ctx, redir.target as WordNode);
      } else {
        const expandResult = await expandRedirectTarget(
          ctx,
          redir.target as WordNode,
        );
        if ("error" in expandResult) {
          stderr += expandResult.error;
          exitCode = 1;
          // When redirect fails, discard the output that would have been redirected
          stdout = "";
          continue;
        }
        target = expandResult.target;
      }
    }

    // Skip FD variable redirections in applyRedirections - they're already handled
    // by processFdVariableRedirections and don't affect stdout/stderr directly
    if (redir.fdVariable) {
      continue;
    }

    // Reject paths containing null bytes - these cause filesystem errors
    if (target.includes("\0")) {
      stderr += `bash: ${target.replace(/\0/g, "")}: No such file or directory\n`;
      exitCode = 1;
      stdout = "";
      continue;
    }

    switch (redir.operator) {
      case ">":
      case ">|":
      case ">>": {
        const fd = redir.fd ?? 1;
        if (fd !== 1 && fd !== 2) {
          break;
        }
        const isAppend = redir.operator === ">>";
        const isClobber = redir.operator === ">|";
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
        const error = await checkOutputRedirectTarget(ctx, filePath, target, {
          ...(isAppend ? {} : { checkNoclobber: true, isClobber }),
        });
        if (error) {
          stderr += error;
          exitCode = 1;
          if (fd === 1) {
            stdout = "";
          }
          break;
        }
        // Opening the target is a side effect of processing the redirection
        // list even when the fd is re-pointed again later: `>` truncates and
        // `>>` creates the file if missing. Content is delivered to each
        // fd's FINAL sink after the list is processed, so `cmd > a > b`
        // truncates `a` but writes to `b`.
        if (isAppend) {
          await ctx.fs.appendFile(filePath, "", "binary");
        } else {
          await ctx.fs.writeFile(filePath, "", "binary");
        }
        if (fd === 1) {
          fd1Sink = { kind: "file", path: filePath, append: isAppend };
        } else {
          fd2Sink = { kind: "file", path: filePath, append: isAppend };
        }
        break;
      }

      case ">&":
      case "<&": {
        // In bash, <& and >& are essentially the same for FD duplication
        // 1<&2 and 1>&2 both make fd 1 point to where fd 2 points
        const fd = redir.fd ?? (redir.operator === "<&" ? 0 : 1);
        // Duplications onto a user descriptor (`3>&1`, `3<&4`) and onto
        // stdin (`<&3`) are performed against the fd table before the
        // command runs — see numeric-fd-redirects.ts and the `<&` branch of
        // executeSimpleCommandInner. They never move stdout/stderr, so this
        // stream-routing pass must leave them alone.
        if (fd >= FIRST_USER_FD || fd === 0) {
          break;
        }
        // Handle >&- or <&- close operation
        // NOTE: For command-level redirections, FD close is TEMPORARY - it only
        // affects the command during its execution. By the time applyRedirections
        // is called, the command has already completed, so we should NOT modify
        // the persistent FD state here. The FD will be restored after this command.
        // Permanent FD closes are handled by `exec N>&-` in executeSimpleCommand.
        if (target === "-") {
          // Don't delete the FD - command-level redirections are temporary
          break;
        }
        // Handle FD move operation: N>&M- (duplicate M to N, then close M)
        // Net-neutral on FD count (set + delete), skip checkFdLimit
        if (target.endsWith("-")) {
          const sourceFdStr = target.slice(0, -1);
          const sourceFd = Number.parseInt(sourceFdStr, 10);
          if (!Number.isNaN(sourceFd)) {
            // First, duplicate: point the target at whatever the source is
            if (dupFd(ctx, fd, sourceFd)) {
              // Then close the source FD (only for user FDs 3+)
              if (sourceFd >= FIRST_USER_FD) closeFd(ctx, sourceFd);
            } else if (sourceFd === 1 || sourceFd === 2) {
              // stdout/stderr are not in the table; record which one.
              setFdEntry(ctx, fd, { kind: "dup-out", sourceFd });
            } else if (sourceFd === 0) {
              setFdEntry(ctx, fd, { kind: "dup-in", sourceFd });
            } else if (sourceFd >= FIRST_USER_FD) {
              // Source FD is a user FD (3+) that isn't open - bad file descriptor
              stderr += `bash: ${sourceFd}: Bad file descriptor\n`;
              exitCode = 1;
            }
          }
          break;
        }
        // >&2, 1>&2, 1<&2: duplicate fd 1 from fd 2 — fd 1 now points to a
        // snapshot of wherever fd 2 points at this spot in the list. Content
        // is not moved here: a later redirection may still repoint fd 1, so
        // remaining stdout is delivered once the whole list is processed.
        if (target === "2" || target === "&2") {
          if (fd === 1) {
            fd1Sink = fd2Sink;
          }
        }
        // 2>&1, 2<&1: duplicate fd 2 from fd 1 — same deferred delivery.
        else if (target === "1" || target === "&1") {
          if (fd === 2) {
            fd2Sink = fd1Sink;
          } else {
            // 1>&1 is a no-op, but other fds redirect to stdout
            stdout += stderr;
            stderr = "";
          }
        }
        // Handle writing to a user-allocated FD (>&$fd)
        else {
          const targetFd = Number.parseInt(target, 10);
          if (!Number.isNaN(targetFd)) {
            // Writing through a descriptor the script opened: `>&N`.
            // Every open descriptor already carries its own file position
            // (append semantics), so successive writes accumulate the way
            // they do through a single open file description in bash.
            const writeThrough = async (path: string): Promise<void> => {
              if (fd === 1) {
                await ctx.fs.appendFile(
                  path,
                  stdout,
                  getStdoutEncoding(stdout),
                );
                stdout = "";
              } else if (fd === 2) {
                await ctx.fs.appendFile(path, stderr, getFileEncoding(stderr));
                stderr = "";
              }
            };
            const reportBadFd = (): void => {
              stderr += `bash: ${targetFd}: Bad file descriptor\n`;
              exitCode = 1;
              stdout = "";
            };
            const entry = getFdEntry(ctx, targetFd);
            if (entry?.kind === "output" || entry?.kind === "readwrite") {
              await writeThrough(entry.path);
            } else if (entry?.kind === "dup-out") {
              // __dupout__:N means this FD writes wherever FD N writes.
              if (entry.sourceFd === 1) {
                // Duplicates stdout - output stays on stdout (no-op for 1>&N)
              } else if (entry.sourceFd === 2) {
                // Duplicates stderr - send stdout there instead
                if (fd === 1) {
                  stderr += stdout;
                  stdout = "";
                }
              } else {
                const source = getFdEntry(ctx, entry.sourceFd);
                if (source?.kind === "output") {
                  await writeThrough(source.path);
                }
              }
            } else if (entry?.kind === "dup-in" || entry?.kind === "input") {
              // A read-side descriptor: writing to it is an error.
              reportBadFd();
            } else if (targetFd >= FIRST_USER_FD) {
              // User FD range (3+) but FD not found - bad file descriptor
              // For FDs 3-9 (manually allocated) and 10+ (auto-allocated),
              // if the FD is not in fileDescriptors, it means it was closed or never opened
              reportBadFd();
            }
          } else if (redir.operator === ">&") {
            // In bash, N>&word where word is not a number or '-' is treated as a file redirect
            // If no explicit fd (redir.fd == null), redirects BOTH stdout and stderr (equivalent to &>word)
            // If explicit fd (e.g., 1>&word), redirects just that fd to the file
            const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
            const error = await checkOutputRedirectTarget(
              ctx,
              filePath,
              target,
              {
                checkNoclobber: true,
              },
            );
            if (error) {
              stderr = error;
              exitCode = 1;
              stdout = "";
              break;
            }
            // Truncate now; content is delivered to the final sinks after
            // the whole redirection list is processed.
            await ctx.fs.writeFile(filePath, "", "binary");
            if (redir.fd == null) {
              // >&word (no explicit fd) - both stdout and stderr to the file
              fd1Sink = { kind: "file", path: filePath, append: false };
              fd2Sink = fd1Sink;
            } else if (fd === 1) {
              // 1>&word - redirect stdout to file
              fd1Sink = { kind: "file", path: filePath, append: false };
            } else if (fd === 2) {
              // 2>&word - redirect stderr to file
              fd2Sink = { kind: "file", path: filePath, append: false };
            }
          }
        }
        break;
      }

      case "&>": {
        // /dev/full always returns ENOSPC when written to
        if (target === "/dev/full") {
          stderr = `bash: echo: write error: No space left on device\n`;
          exitCode = 1;
          stdout = "";
          break;
        }
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        const error = await checkOutputRedirectTarget(ctx, filePath, target, {
          checkNoclobber: true,
        });
        if (error) {
          stderr = error;
          exitCode = 1;
          stdout = "";
          break;
        }
        // Truncate now; content is delivered to the final sinks after the
        // whole redirection list is processed.
        await ctx.fs.writeFile(filePath, "", "binary");
        fd1Sink = { kind: "file", path: filePath, append: false };
        fd2Sink = fd1Sink;
        break;
      }

      case "&>>": {
        // /dev/full always returns ENOSPC when written to
        if (target === "/dev/full") {
          stderr = `bash: echo: write error: No space left on device\n`;
          exitCode = 1;
          stdout = "";
          break;
        }
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        const error = await checkOutputRedirectTarget(
          ctx,
          filePath,
          target,
          {},
        );
        if (error) {
          stderr = error;
          exitCode = 1;
          stdout = "";
          break;
        }
        // Create if missing; content is delivered to the final sinks after
        // the whole redirection list is processed.
        await ctx.fs.appendFile(filePath, "", "binary");
        fd1Sink = { kind: "file", path: filePath, append: true };
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
    const pendingStdout = stdout;
    const pendingStderr = stderr;
    stdout = "";
    stderr = "";
    const deliverToFile = async (
      sink: { path: string; append: boolean },
      content: string,
      encoding: "binary" | "utf8",
    ) => {
      if (sink.append) {
        await ctx.fs.appendFile(sink.path, content, encoding);
      } else {
        await ctx.fs.writeFile(sink.path, content, encoding);
      }
    };
    if (fd1Sink === fd2Sink) {
      // One descriptor carries both streams, so they arrive at it in the order
      // they were written. Identity, not equality: two redirects that name the
      // same path are separate descriptors and keep the clobbering behaviour
      // handled by the loop below.
      const combined = mergeInRecordedOrder(
        result.outputChunks,
        pendingStdout,
        pendingStderr,
      );
      if (combined !== "") {
        switch (fd1Sink.kind) {
          case "live-stdout":
            stdout += combined;
            break;
          case "live-stderr":
            stderr += combined;
            break;
          case "file":
            await deliverToFile(fd1Sink, combined, getStdoutEncoding(combined));
            break;
          case "discard":
            break;
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
          case "discard":
            break;
        }
      }
    }
  }

  // Apply persistent FD redirections (from exec)
  // Check if fd 1 (stdout) is redirected to fd 2 (stderr) via exec 1>&2
  const fd1Entry = getFdEntry(ctx, 1);
  if (fd1Entry?.kind === "dup-out" && fd1Entry.sourceFd === 2) {
    // fd 1 is duplicated to fd 2 - stdout goes to stderr
    stderr += stdout;
    stdout = "";
  } else if (fd1Entry?.kind === "output") {
    // fd 1 is redirected to a file
    await ctx.fs.appendFile(fd1Entry.path, stdout, getStdoutEncoding(stdout));
    stdout = "";
  }

  // Check if fd 2 (stderr) is redirected
  const fd2Entry = getFdEntry(ctx, 2);
  if (fd2Entry?.kind === "dup-out" && fd2Entry.sourceFd === 1) {
    // fd 2 is duplicated to fd 1 - stderr goes to stdout
    stdout += stderr;
    stderr = "";
  } else if (fd2Entry?.kind === "output") {
    await ctx.fs.appendFile(fd2Entry.path, stderr, getFileEncoding(stderr));
    stderr = "";
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

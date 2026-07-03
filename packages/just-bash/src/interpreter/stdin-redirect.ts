/**
 * Stdin Redirect Resolution
 *
 * The single implementation of "what does fd 0 contain?" for every
 * construct that accepts stdin redirections: simple commands, compound
 * commands (if/for/while/until/case), subshells, and groups.
 *
 * Resolution produces latin1-shaped byte content (per the pipeline
 * contract in encoding.ts); installation wraps it in a `StdinStream`
 * scoped to the construct via `withStdin`. Nothing outside this module
 * needs to know how heredocs, here-strings, `< file`, or `<&N` turn
 * into stdin bytes.
 */

import type { HereDocNode, RedirectionNode, WordNode } from "../ast/types.js";
import {
  encodeUtf8ToBytes,
  latin1FromBytes,
  readBytesFrom,
} from "../encoding.js";
import { StdinStream } from "../stdin-stream.js";
import type { ExecResult } from "../types.js";
import { expandWord } from "./expansion.js";
import { checkFdLimit, failure } from "./helpers/result.js";
import { parseRwFdContent } from "./helpers/word-matching.js";
import type { InterpreterContext } from "./types.js";

export interface ResolvedStdin {
  /**
   * Latin1 byte content for fd 0, or null when the redirections carry no
   * stdin redirect (caller keeps its inherited stream).
   */
  stdin: string | null;
  /**
   * When stdin came from `<&N` on a read-write fd, the source fd number so
   * `read` can advance the fd's stored position. -1 otherwise.
   */
  stdinSourceFd: number;
}

export type ResolveStdinResult = ResolvedStdin | { error: ExecResult };

/**
 * Resolve `<<`, `<<-`, `<<<`, `<`, and `<&` redirections to stdin content.
 *
 * Processes redirections left to right (last stdin redirect wins, matching
 * bash). Heredocs targeting a non-zero fd are stored in the fd table for
 * `read -u` instead of becoming stdin.
 *
 * Returns `{ error }` when a `< file` target doesn't exist; the caller
 * returns it without executing the construct.
 */
export async function resolveStdinRedirections(
  ctx: InterpreterContext,
  redirections: RedirectionNode[],
): Promise<ResolveStdinResult> {
  let stdin: string | null = null;
  let stdinSourceFd = -1;

  for (const redir of redirections) {
    if (
      (redir.operator === "<<" || redir.operator === "<<-") &&
      redir.target.type === "HereDoc"
    ) {
      const hereDoc = redir.target as HereDocNode;
      let content = await expandWord(ctx, hereDoc.content);
      // <<- strips leading tabs from each line
      if (hereDoc.stripTabs) {
        content = content
          .split("\n")
          .map((line) => line.replace(/^\t+/, ""))
          .join("\n");
      }
      // Heredocs land here as JS Unicode text; the pipeline contract
      // expects stdin to be a latin1 byte buffer. UTF-8 encode the
      // text once at the source so byte consumers downstream see real
      // bytes and binary writes don't truncate codepoints to their
      // low byte.
      content = latin1FromBytes(encodeUtf8ToBytes(content));
      // If this is a non-standard fd (not 0), store in fileDescriptors for -u option
      const fd = redir.fd ?? 0;
      if (fd !== 0) {
        if (!ctx.state.fileDescriptors) {
          ctx.state.fileDescriptors = new Map();
        }
        checkFdLimit(ctx);
        ctx.state.fileDescriptors.set(fd, content);
      } else {
        stdin = content;
        stdinSourceFd = -1;
      }
      continue;
    }

    if (redir.operator === "<<<" && redir.target.type === "Word") {
      // Same byte-encoding step as heredoc — here-strings deliver
      // JS Unicode text and need to land as bytes.
      stdin = latin1FromBytes(
        encodeUtf8ToBytes(
          `${await expandWord(ctx, redir.target as WordNode)}\n`,
        ),
      );
      stdinSourceFd = -1;
      continue;
    }

    if (redir.operator === "<" && redir.target.type === "Word") {
      const target = await expandWord(ctx, redir.target as WordNode);
      try {
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        // Read as raw bytes — `<` is a transparent file-to-stdin
        // pipe and we don't want the smart-utf8 read path turning
        // valid bytes into U+FFFD replacement chars.
        stdin = latin1FromBytes(await readBytesFrom(ctx.fs, filePath));
        stdinSourceFd = -1;
      } catch {
        return {
          error: failure(`bash: ${target}: No such file or directory\n`),
        };
      }
      continue;
    }

    // Handle <& input redirection from file descriptor
    if (redir.operator === "<&" && redir.target.type === "Word") {
      const target = await expandWord(ctx, redir.target as WordNode);
      const sourceFd = Number.parseInt(target, 10);
      if (!Number.isNaN(sourceFd) && ctx.state.fileDescriptors) {
        const fdContent = ctx.state.fileDescriptors.get(sourceFd);
        if (fdContent !== undefined) {
          // Handle different FD content formats
          if (fdContent.startsWith("__rw__:")) {
            // Read/write mode: format is __rw__:pathLength:path:position:content
            const parsed = parseRwFdContent(fdContent);
            if (parsed) {
              // Return content starting from current position
              stdin = parsed.content.slice(parsed.position);
              stdinSourceFd = sourceFd;
            }
          } else if (
            fdContent.startsWith("__file__:") ||
            fdContent.startsWith("__file_append__:")
          ) {
            // These are output-only, can't read from them
          } else {
            // Plain content (from exec N< file or here-docs)
            stdin = fdContent;
            stdinSourceFd = -1;
          }
        }
      }
    }
  }

  return { stdin, stdinSourceFd };
}

/**
 * Run `fn` with `stream` installed as the scope's stdin, restoring the
 * previous stream afterwards. This is the only way stdin changes hands:
 * pipeline stages, stdin redirects, and top-level exec all install a
 * stream here and inherit it everywhere below by reference.
 */
export async function withStdin<T>(
  ctx: InterpreterContext,
  stream: StdinStream,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = ctx.state.stdin;
  ctx.state.stdin = stream;
  try {
    return await fn();
  } finally {
    ctx.state.stdin = saved;
  }
}

/**
 * Resolve stdin redirections and run `fn` with the resulting stream
 * installed (or unchanged stdin when no stdin redirect is present).
 * Returns the resolution error instead of running `fn` when a `< file`
 * target is missing.
 */
export async function withStdinRedirects(
  ctx: InterpreterContext,
  redirections: RedirectionNode[],
  fn: () => Promise<ExecResult>,
): Promise<ExecResult> {
  const resolved = await resolveStdinRedirections(ctx, redirections);
  if ("error" in resolved) {
    return resolved.error;
  }
  if (resolved.stdin === null) {
    return fn();
  }
  return withStdin(ctx, new StdinStream(resolved.stdin), fn);
}

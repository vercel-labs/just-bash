/**
 * Redirection Handling
 *
 * Handles output redirections:
 * - > : Write stdout to file
 * - >> : Append stdout to file
 * - 2> : Write stderr to file
 * - &> : Write both stdout and stderr to file
 * - >& : Redirect fd to another fd
 */

import type { RedirectionNode, WordNode } from "../ast/types.js";
import type { ExecResult } from "../types.js";
import { expandRedirectTarget, expandWord } from "./expansion.js";
import { result as makeResult } from "./helpers/result.js";
import type { InterpreterContext } from "./types.js";

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
): Promise<ExecResult | null> {
  for (const redir of redirections) {
    if (redir.target.type === "HereDoc") {
      continue;
    }

    // Only handle output truncation redirects (>, >|, &>)
    // Append (>>, &>>) doesn't need pre-truncation
    // FD redirects (>&) don't touch files
    if (
      redir.operator !== ">" &&
      redir.operator !== ">|" &&
      redir.operator !== "&>"
    ) {
      continue;
    }

    // Expand redirect target with glob handling (failglob, ambiguous redirect)
    const expandResult = await expandRedirectTarget(
      ctx,
      redir.target as WordNode,
    );
    if ("error" in expandResult) {
      return makeResult("", expandResult.error, 1);
    }
    const target = expandResult.target;
    const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
    const isClobber = redir.operator === ">|";

    // Check if target is a directory or noclobber prevents overwrite
    try {
      const stat = await ctx.fs.stat(filePath);
      if (stat.isDirectory) {
        return makeResult("", `bash: ${target}: Is a directory\n`, 1);
      }
      // Check noclobber: if file exists and noclobber is set, refuse to overwrite
      // unless using >| (clobber operator) or writing to /dev/null
      if (
        ctx.state.options.noclobber &&
        !isClobber &&
        !stat.isDirectory &&
        target !== "/dev/null"
      ) {
        return makeResult(
          "",
          `bash: ${target}: cannot overwrite existing file\n`,
          1,
        );
      }
    } catch {
      // File doesn't exist, that's ok - we'll create it
    }

    // Pre-truncate the file (create empty file)
    // This makes the file empty before any command substitutions in the
    // compound command body are evaluated
    if (target !== "/dev/null") {
      await ctx.fs.writeFile(filePath, "", "utf8");
    }
  }

  return null; // Success - no error
}

export async function applyRedirections(
  ctx: InterpreterContext,
  result: ExecResult,
  redirections: RedirectionNode[],
): Promise<ExecResult> {
  let { stdout, stderr, exitCode } = result;

  for (const redir of redirections) {
    if (redir.target.type === "HereDoc") {
      continue;
    }

    // For FD-to-FD redirects (>&), use plain expansion without glob handling
    // For file redirects, use glob expansion with failglob/ambiguous redirect handling
    const isFdRedirect = redir.operator === ">&" || redir.operator === "<&";
    let target: string;
    if (isFdRedirect) {
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

    switch (redir.operator) {
      case ">":
      case ">|": {
        const fd = redir.fd ?? 1;
        const isClobber = redir.operator === ">|";
        if (fd === 1) {
          const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
          // Check if target is a directory
          try {
            const stat = await ctx.fs.stat(filePath);
            if (stat.isDirectory) {
              stderr += `bash: ${target}: Is a directory\n`;
              exitCode = 1;
              stdout = "";
              break;
            }
            // Check noclobber: if file exists and noclobber is set, refuse to overwrite
            // unless using >| (clobber operator) or writing to /dev/null
            if (
              ctx.state.options.noclobber &&
              !isClobber &&
              target !== "/dev/null"
            ) {
              stderr += `bash: ${target}: cannot overwrite existing file\n`;
              exitCode = 1;
              stdout = "";
              break;
            }
          } catch {
            // File doesn't exist, that's ok - we'll create it
          }
          // Use binary encoding to preserve bytes in stdout (e.g., gzip output)
          await ctx.fs.writeFile(filePath, stdout, "binary");
          stdout = "";
        } else if (fd === 2) {
          if (target === "/dev/null") {
            stderr = "";
          } else {
            const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
            // Check if target is a directory
            try {
              const stat = await ctx.fs.stat(filePath);
              if (stat.isDirectory) {
                stderr += `bash: ${target}: Is a directory\n`;
                exitCode = 1;
                break;
              }
              // Check noclobber for stderr too
              if (
                ctx.state.options.noclobber &&
                !isClobber &&
                target !== "/dev/null"
              ) {
                stderr += `bash: ${target}: cannot overwrite existing file\n`;
                exitCode = 1;
                break;
              }
            } catch {
              // File doesn't exist, that's ok
            }
            // Use binary encoding to preserve bytes in stderr
            await ctx.fs.writeFile(filePath, stderr, "binary");
            stderr = "";
          }
        }
        break;
      }

      case ">>": {
        const fd = redir.fd ?? 1;
        if (fd === 1) {
          const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
          // Check if target is a directory
          try {
            const stat = await ctx.fs.stat(filePath);
            if (stat.isDirectory) {
              stderr += `bash: ${target}: Is a directory\n`;
              exitCode = 1;
              stdout = "";
              break;
            }
          } catch {
            // File doesn't exist, that's ok
          }
          // Use binary encoding to preserve bytes in stdout
          await ctx.fs.appendFile(filePath, stdout, "binary");
          stdout = "";
        } else if (fd === 2) {
          const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
          // Check if target is a directory
          try {
            const stat = await ctx.fs.stat(filePath);
            if (stat.isDirectory) {
              stderr += `bash: ${target}: Is a directory\n`;
              exitCode = 1;
              break;
            }
          } catch {
            // File doesn't exist, that's ok
          }
          // Use binary encoding to preserve bytes in stderr
          await ctx.fs.appendFile(filePath, stderr, "binary");
          stderr = "";
        }
        break;
      }

      case ">&": {
        const fd = redir.fd ?? 1; // Default to stdout (fd 1)
        // >&2 or 1>&2: redirect stdout to stderr
        if (target === "2" || target === "&2") {
          if (fd === 1) {
            stderr += stdout;
            stdout = "";
          }
        }
        // 2>&1: redirect stderr to stdout
        else if (target === "1" || target === "&1") {
          if (fd === 2) {
            stdout += stderr;
            stderr = "";
          } else {
            // 1>&1 is a no-op, but other fds redirect to stdout
            stdout += stderr;
            stderr = "";
          }
        }
        break;
      }

      case "&>": {
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        // Check if target is a directory
        try {
          const stat = await ctx.fs.stat(filePath);
          if (stat.isDirectory) {
            stderr = `bash: ${target}: Is a directory\n`;
            exitCode = 1;
            stdout = "";
            break;
          }
          // Check noclobber: if file exists and noclobber is set, refuse to overwrite
          if (ctx.state.options.noclobber && target !== "/dev/null") {
            stderr = `bash: ${target}: cannot overwrite existing file\n`;
            exitCode = 1;
            stdout = "";
            break;
          }
        } catch {
          // File doesn't exist, that's ok
        }
        // Use binary encoding to preserve bytes
        await ctx.fs.writeFile(filePath, stdout + stderr, "binary");
        stdout = "";
        stderr = "";
        break;
      }

      case "&>>": {
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        // Check if target is a directory
        try {
          const stat = await ctx.fs.stat(filePath);
          if (stat.isDirectory) {
            stderr = `bash: ${target}: Is a directory\n`;
            exitCode = 1;
            stdout = "";
            break;
          }
        } catch {
          // File doesn't exist, that's ok
        }
        // Use binary encoding to preserve bytes
        await ctx.fs.appendFile(filePath, stdout + stderr, "binary");
        stdout = "";
        stderr = "";
        break;
      }
    }
  }

  return makeResult(stdout, stderr, exitCode);
}

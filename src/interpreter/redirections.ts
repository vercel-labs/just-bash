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
import type { ExecResult } from "../types.js";
import { expandRedirectTarget, expandWord } from "./expansion.js";
import { result as makeResult } from "./helpers/result.js";
import type { InterpreterContext } from "./types.js";

/**
 * Allocate the next available file descriptor (starting at 10).
 * Returns the allocated FD number.
 */
function allocateFd(ctx: InterpreterContext): number {
  if (ctx.state.nextFd === undefined) {
    ctx.state.nextFd = 10;
  }
  const fd = ctx.state.nextFd;
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
): Promise<ExecResult | null> {
  for (const redir of redirections) {
    if (!redir.fdVariable) {
      continue;
    }

    // Initialize fileDescriptors map if needed
    if (!ctx.state.fileDescriptors) {
      ctx.state.fileDescriptors = new Map();
    }

    // Handle close operation: {fd}>&- or {fd}<&-
    // For close operations, we look up the existing variable value (the FD number)
    // and close that FD, rather than allocating a new one.
    if (
      (redir.operator === ">&" || redir.operator === "<&") &&
      redir.target.type === "Word"
    ) {
      const target = await expandWord(ctx, redir.target as WordNode);
      if (target === "-") {
        // Close operation - look up the FD from the variable and close it
        const existingFd = ctx.state.env[redir.fdVariable];
        if (existingFd !== undefined) {
          const fdNum = Number.parseInt(existingFd, 10);
          if (!Number.isNaN(fdNum)) {
            ctx.state.fileDescriptors.delete(fdNum);
          }
        }
        // Don't allocate a new FD for close operations
        continue;
      }
    }

    // Allocate a new FD (for non-close operations)
    const fd = allocateFd(ctx);

    // Set the variable to the allocated FD number
    ctx.state.env[redir.fdVariable] = String(fd);

    // For file redirections, store the file path mapping
    if (redir.target.type === "Word") {
      const target = await expandWord(ctx, redir.target as WordNode);

      // Handle FD duplication: {fd}>&N or {fd}<&N
      if (redir.operator === ">&" || redir.operator === "<&") {
        const sourceFd = Number.parseInt(target, 10);
        if (!Number.isNaN(sourceFd)) {
          // Duplicate the source FD's content to the new FD
          const content = ctx.state.fileDescriptors.get(sourceFd);
          if (content !== undefined) {
            ctx.state.fileDescriptors.set(fd, content);
          }
          continue;
        }
      }

      // For output redirections to files, we'll handle actual writing in applyRedirections
      // Store the target file path associated with this FD
      if (
        redir.operator === ">" ||
        redir.operator === ">>" ||
        redir.operator === ">|" ||
        redir.operator === "&>" ||
        redir.operator === "&>>"
      ) {
        // Mark this FD as pointing to a file (store file path for later use)
        // Use a special format to distinguish from content
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        // For truncating operators (>, >|, &>), create/truncate the file now
        if (
          redir.operator === ">" ||
          redir.operator === ">|" ||
          redir.operator === "&>"
        ) {
          await ctx.fs.writeFile(filePath, "", "utf8");
        }
        ctx.state.fileDescriptors.set(fd, `__file__:${filePath}`);
      } else if (redir.operator === "<<<") {
        // For here-strings, store the target value plus newline as the FD content
        ctx.state.fileDescriptors.set(fd, `${target}\n`);
      } else if (redir.operator === "<" || redir.operator === "<>") {
        // For input redirections, read the file content
        try {
          const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
          const content = await ctx.fs.readFile(filePath);
          ctx.state.fileDescriptors.set(fd, content);
        } catch {
          return makeResult(
            "",
            `bash: ${target}: No such file or directory\n`,
            1,
          );
        }
      }
    }
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

    // Skip FD variable redirections in applyRedirections - they're already handled
    // by processFdVariableRedirections and don't affect stdout/stderr directly
    if (redir.fdVariable) {
      continue;
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

      case ">&":
      case "<&": {
        // In bash, <& and >& are essentially the same for FD duplication
        // 1<&2 and 1>&2 both make fd 1 point to where fd 2 points
        const fd = redir.fd ?? 1; // Default to stdout (fd 1)
        // Handle >&- or <&- close operation
        if (target === "-") {
          // Close the FD - remove from fileDescriptors
          if (ctx.state.fileDescriptors) {
            ctx.state.fileDescriptors.delete(fd);
          }
          break;
        }
        // >&2, 1>&2, 1<&2: redirect stdout to stderr
        if (target === "2" || target === "&2") {
          if (fd === 1) {
            stderr += stdout;
            stdout = "";
          }
        }
        // 2>&1, 2<&1: redirect stderr to stdout
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
        // Handle writing to a user-allocated FD (>&$fd)
        else {
          const targetFd = Number.parseInt(target, 10);
          if (!Number.isNaN(targetFd)) {
            // Check if this is a valid user-allocated FD
            const fdInfo = ctx.state.fileDescriptors?.get(targetFd);
            if (fdInfo?.startsWith("__file__:")) {
              // This FD is associated with a file - write to it
              // The path is already resolved when the FD was allocated
              const resolvedPath = fdInfo.slice(9); // Remove "__file__:" prefix
              if (fd === 1) {
                await ctx.fs.appendFile(resolvedPath, stdout, "binary");
                stdout = "";
              } else if (fd === 2) {
                await ctx.fs.appendFile(resolvedPath, stderr, "binary");
                stderr = "";
              }
            } else if (fdInfo?.startsWith("__rw__:")) {
              // Read/write FD - extract path and append to file
              const colonIdx = fdInfo.indexOf(":", 7);
              if (colonIdx !== -1) {
                const resolvedPath = fdInfo.slice(7, colonIdx);
                if (fd === 1) {
                  await ctx.fs.appendFile(resolvedPath, stdout, "binary");
                  stdout = "";
                } else if (fd === 2) {
                  await ctx.fs.appendFile(resolvedPath, stderr, "binary");
                  stderr = "";
                }
              }
            } else if (targetFd >= 10) {
              // User-allocated FD range (>=10) but FD not found - bad file descriptor
              stderr += `bash: ${targetFd}: Bad file descriptor\n`;
              exitCode = 1;
              stdout = "";
            }
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

  // Apply persistent FD redirections (from exec)
  // Check if fd 1 (stdout) is redirected to fd 2 (stderr) via exec 1>&2
  const fd1Info = ctx.state.fileDescriptors?.get(1);
  if (fd1Info) {
    if (fd1Info === "__dupout__:2") {
      // fd 1 is duplicated to fd 2 - stdout goes to stderr
      stderr += stdout;
      stdout = "";
    } else if (fd1Info.startsWith("__file__:")) {
      // fd 1 is redirected to a file
      const filePath = fd1Info.slice(9);
      await ctx.fs.appendFile(filePath, stdout, "binary");
      stdout = "";
    } else if (fd1Info.startsWith("__file_append__:")) {
      const filePath = fd1Info.slice(16);
      await ctx.fs.appendFile(filePath, stdout, "binary");
      stdout = "";
    }
  }

  // Check if fd 2 (stderr) is redirected
  const fd2Info = ctx.state.fileDescriptors?.get(2);
  if (fd2Info) {
    if (fd2Info === "__dupout__:1") {
      // fd 2 is duplicated to fd 1 - stderr goes to stdout
      stdout += stderr;
      stderr = "";
    } else if (fd2Info.startsWith("__file__:")) {
      const filePath = fd2Info.slice(9);
      await ctx.fs.appendFile(filePath, stderr, "binary");
      stderr = "";
    } else if (fd2Info.startsWith("__file_append__:")) {
      const filePath = fd2Info.slice(16);
      await ctx.fs.appendFile(filePath, stderr, "binary");
      stderr = "";
    }
  }

  return makeResult(stdout, stderr, exitCode);
}

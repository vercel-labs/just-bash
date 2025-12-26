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
import { expandWord } from "./expansion.js";
import { result as makeResult } from "./helpers/result.js";
import type { InterpreterContext } from "./types.js";

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

    const target = await expandWord(ctx, redir.target as WordNode);

    switch (redir.operator) {
      case ">": {
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
            // File doesn't exist, that's ok - we'll create it
          }
          await ctx.fs.writeFile(filePath, stdout);
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
            } catch {
              // File doesn't exist, that's ok
            }
            await ctx.fs.writeFile(filePath, stderr);
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
          await ctx.fs.appendFile(filePath, stdout);
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
          await ctx.fs.appendFile(filePath, stderr);
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
        } catch {
          // File doesn't exist, that's ok
        }
        await ctx.fs.writeFile(filePath, stdout + stderr);
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
        await ctx.fs.appendFile(filePath, stdout + stderr);
        stdout = "";
        stderr = "";
        break;
      }
    }
  }

  return makeResult(stdout, stderr, exitCode);
}

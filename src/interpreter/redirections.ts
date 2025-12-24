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
          await ctx.fs.writeFile(filePath, stdout);
          stdout = "";
        } else if (fd === 2) {
          if (target === "/dev/null") {
            stderr = "";
          } else {
            const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
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
          await ctx.fs.appendFile(filePath, stdout);
          stdout = "";
        } else if (fd === 2) {
          const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
          await ctx.fs.appendFile(filePath, stderr);
          stderr = "";
        }
        break;
      }

      case ">&": {
        if (target === "1" || target === "&1") {
          stdout += stderr;
          stderr = "";
        }
        break;
      }

      case "&>": {
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        await ctx.fs.writeFile(filePath, stdout + stderr);
        stdout = "";
        stderr = "";
        break;
      }

      case "&>>": {
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        await ctx.fs.appendFile(filePath, stdout + stderr);
        stdout = "";
        stderr = "";
        break;
      }
    }
  }

  return { stdout, stderr, exitCode };
}

/**
 * Control Flow Execution
 *
 * Handles control flow constructs:
 * - if/elif/else
 * - for loops
 * - C-style for loops
 * - while loops
 * - until loops
 * - case statements
 */

import type {
  CaseNode,
  CStyleForNode,
  ForNode,
  IfNode,
  UntilNode,
  WhileNode,
} from "../ast/types.js";
import type { ExecResult } from "../types.js";
import { evaluateArithmetic } from "./arithmetic.js";
import { matchPattern } from "./conditionals.js";
import { expandWord, expandWordWithGlob } from "./expansion.js";
import type { InterpreterContext } from "./types.js";

export async function executeIf(
  ctx: InterpreterContext,
  node: IfNode,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  for (const clause of node.clauses) {
    let conditionExitCode = 0;
    for (const stmt of clause.condition) {
      const result = await ctx.executeStatement(stmt);
      stdout += result.stdout;
      stderr += result.stderr;
      conditionExitCode = result.exitCode;
    }

    if (conditionExitCode === 0) {
      for (const stmt of clause.body) {
        const result = await ctx.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
      return { stdout, stderr, exitCode };
    }
  }

  if (node.elseBody) {
    for (const stmt of node.elseBody) {
      const result = await ctx.executeStatement(stmt);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }
  }

  return { stdout, stderr, exitCode };
}

export async function executeFor(
  ctx: InterpreterContext,
  node: ForNode,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let iterations = 0;

  let words: string[] = [];
  if (node.words === null) {
    words = (ctx.state.env["@"] || "").split(" ").filter(Boolean);
  } else if (node.words.length === 0) {
    words = [];
  } else {
    for (const word of node.words) {
      const expanded = await expandWordWithGlob(ctx, word);
      words.push(...expanded.values);
    }
  }

  for (const value of words) {
    iterations++;
    if (iterations > ctx.maxLoopIterations) {
      return {
        stdout,
        stderr:
          stderr +
          `bash: for loop: too many iterations (${ctx.maxLoopIterations}), increase maxLoopIterations\n`,
        exitCode: 1,
      };
    }

    ctx.state.env[node.variable] = value;

    for (const stmt of node.body) {
      try {
        const result = await ctx.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          stdout,
          stderr: `${stderr + message}\n`,
          exitCode: 1,
        };
      }
    }
  }

  delete ctx.state.env[node.variable];

  return { stdout, stderr, exitCode };
}

export async function executeCStyleFor(
  ctx: InterpreterContext,
  node: CStyleForNode,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let iterations = 0;

  if (node.init) {
    evaluateArithmetic(ctx, node.init.expression);
  }

  while (true) {
    iterations++;
    if (iterations > ctx.maxLoopIterations) {
      return {
        stdout,
        stderr:
          stderr +
          `bash: for loop: too many iterations (${ctx.maxLoopIterations}), increase maxLoopIterations\n`,
        exitCode: 1,
      };
    }

    if (node.condition) {
      const condResult = evaluateArithmetic(ctx, node.condition.expression);
      if (condResult === 0) break;
    }

    for (const stmt of node.body) {
      try {
        const result = await ctx.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
    }

    if (node.update) {
      evaluateArithmetic(ctx, node.update.expression);
    }
  }

  return { stdout, stderr, exitCode };
}

export async function executeWhile(
  ctx: InterpreterContext,
  node: WhileNode,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let iterations = 0;

  while (true) {
    iterations++;
    if (iterations > ctx.maxLoopIterations) {
      return {
        stdout,
        stderr:
          stderr +
          `bash: while loop: too many iterations (${ctx.maxLoopIterations}), increase maxLoopIterations\n`,
        exitCode: 1,
      };
    }

    let conditionExitCode = 0;
    for (const stmt of node.condition) {
      try {
        const result = await ctx.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        conditionExitCode = result.exitCode;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
    }

    if (conditionExitCode !== 0) break;

    for (const stmt of node.body) {
      try {
        const result = await ctx.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
    }
  }

  return { stdout, stderr, exitCode };
}

export async function executeUntil(
  ctx: InterpreterContext,
  node: UntilNode,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let iterations = 0;

  while (true) {
    iterations++;
    if (iterations > ctx.maxLoopIterations) {
      return {
        stdout,
        stderr:
          stderr +
          `bash: until loop: too many iterations (${ctx.maxLoopIterations}), increase maxLoopIterations\n`,
        exitCode: 1,
      };
    }

    let conditionExitCode = 0;
    for (const stmt of node.condition) {
      try {
        const result = await ctx.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        conditionExitCode = result.exitCode;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
    }

    if (conditionExitCode === 0) break;

    for (const stmt of node.body) {
      try {
        const result = await ctx.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
    }
  }

  return { stdout, stderr, exitCode };
}

export async function executeCase(
  ctx: InterpreterContext,
  node: CaseNode,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  const value = await expandWord(ctx, node.word);

  for (const item of node.items) {
    let matched = false;

    for (const pattern of item.patterns) {
      const patternStr = await expandWord(ctx, pattern);
      if (matchPattern(value, patternStr)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      for (const stmt of item.body) {
        const result = await ctx.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }

      if (item.terminator === ";;") {
        break;
      }
    }
  }

  return { stdout, stderr, exitCode };
}

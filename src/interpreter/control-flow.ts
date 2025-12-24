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
 * - break/continue
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
import { ErrexitError } from "./interpreter.js";
import type { InterpreterContext } from "./types.js";

/**
 * Error thrown when break is called to exit loops.
 */
export class BreakError extends Error {
  constructor(
    public levels: number = 1,
    public stdout: string = "",
    public stderr: string = "",
  ) {
    super("break");
    this.name = "BreakError";
  }
}

/**
 * Error thrown when continue is called to skip to next iteration.
 */
export class ContinueError extends Error {
  constructor(
    public levels: number = 1,
    public stdout: string = "",
    public stderr: string = "",
  ) {
    super("continue");
    this.name = "ContinueError";
  }
}

export async function executeIf(
  ctx: InterpreterContext,
  node: IfNode,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  for (const clause of node.clauses) {
    let conditionExitCode = 0;

    // Condition evaluation should not trigger errexit
    const savedInCondition = ctx.state.inCondition;
    ctx.state.inCondition = true;
    try {
      for (const stmt of clause.condition) {
        const result = await ctx.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        conditionExitCode = result.exitCode;
      }
    } finally {
      ctx.state.inCondition = savedInCondition;
    }

    if (conditionExitCode === 0) {
      try {
        for (const stmt of clause.body) {
          const result = await ctx.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        }
      } catch (error) {
        if (error instanceof BreakError || error instanceof ContinueError) {
          error.stdout = stdout + error.stdout;
          error.stderr = stderr + error.stderr;
          throw error;
        }
        if (error instanceof ErrexitError) {
          error.stdout = stdout + error.stdout;
          error.stderr = stderr + error.stderr;
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
      return { stdout, stderr, exitCode };
    }
  }

  if (node.elseBody) {
    try {
      for (const stmt of node.elseBody) {
        const result = await ctx.executeStatement(stmt);
        stdout += result.stdout;
        stderr += result.stderr;
        exitCode = result.exitCode;
      }
    } catch (error) {
      if (error instanceof BreakError || error instanceof ContinueError) {
        error.stdout = stdout + error.stdout;
        error.stderr = stderr + error.stderr;
        throw error;
      }
      if (error instanceof ErrexitError) {
        error.stdout = stdout + error.stdout;
        error.stderr = stderr + error.stderr;
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
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

  ctx.state.loopDepth++;
  try {
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

      try {
        for (const stmt of node.body) {
          const result = await ctx.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        }
      } catch (error) {
        if (error instanceof BreakError) {
          stdout += error.stdout;
          stderr += error.stderr;
          if (error.levels > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          break;
        }
        if (error instanceof ContinueError) {
          stdout += error.stdout;
          stderr += error.stderr;
          if (error.levels > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          continue;
        }
        if (error instanceof ErrexitError) {
          error.stdout = stdout + error.stdout;
          error.stderr = stderr + error.stderr;
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
    }
  } finally {
    ctx.state.loopDepth--;
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

  ctx.state.loopDepth++;
  try {
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

      try {
        for (const stmt of node.body) {
          const result = await ctx.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        }
      } catch (error) {
        if (error instanceof BreakError) {
          stdout += error.stdout;
          stderr += error.stderr;
          if (error.levels > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          break;
        }
        if (error instanceof ContinueError) {
          stdout += error.stdout;
          stderr += error.stderr;
          if (error.levels > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          // Still need to run the update expression
          if (node.update) {
            evaluateArithmetic(ctx, node.update.expression);
          }
          continue;
        }
        if (error instanceof ErrexitError) {
          error.stdout = stdout + error.stdout;
          error.stderr = stderr + error.stderr;
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }

      if (node.update) {
        evaluateArithmetic(ctx, node.update.expression);
      }
    }
  } finally {
    ctx.state.loopDepth--;
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

  ctx.state.loopDepth++;
  try {
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

      // Condition evaluation should not trigger errexit
      const savedInCondition = ctx.state.inCondition;
      ctx.state.inCondition = true;
      try {
        for (const stmt of node.condition) {
          const result = await ctx.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          conditionExitCode = result.exitCode;
        }
      } finally {
        ctx.state.inCondition = savedInCondition;
      }

      if (conditionExitCode !== 0) break;

      try {
        for (const stmt of node.body) {
          const result = await ctx.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        }
      } catch (error) {
        if (error instanceof BreakError) {
          stdout += error.stdout;
          stderr += error.stderr;
          if (error.levels > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          break;
        }
        if (error instanceof ContinueError) {
          stdout += error.stdout;
          stderr += error.stderr;
          if (error.levels > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          continue;
        }
        if (error instanceof ErrexitError) {
          error.stdout = stdout + error.stdout;
          error.stderr = stderr + error.stderr;
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
    }
  } finally {
    ctx.state.loopDepth--;
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

  ctx.state.loopDepth++;
  try {
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

      // Condition evaluation should not trigger errexit
      const savedInCondition = ctx.state.inCondition;
      ctx.state.inCondition = true;
      try {
        for (const stmt of node.condition) {
          const result = await ctx.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          conditionExitCode = result.exitCode;
        }
      } finally {
        ctx.state.inCondition = savedInCondition;
      }

      if (conditionExitCode === 0) break;

      try {
        for (const stmt of node.body) {
          const result = await ctx.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        }
      } catch (error) {
        if (error instanceof BreakError) {
          stdout += error.stdout;
          stderr += error.stderr;
          if (error.levels > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          break;
        }
        if (error instanceof ContinueError) {
          stdout += error.stdout;
          stderr += error.stderr;
          if (error.levels > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          continue;
        }
        if (error instanceof ErrexitError) {
          error.stdout = stdout + error.stdout;
          error.stderr = stderr + error.stderr;
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
    }
  } finally {
    ctx.state.loopDepth--;
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
      try {
        for (const stmt of item.body) {
          const result = await ctx.executeStatement(stmt);
          stdout += result.stdout;
          stderr += result.stderr;
          exitCode = result.exitCode;
        }
      } catch (error) {
        if (error instanceof BreakError || error instanceof ContinueError) {
          error.stdout = stdout + error.stdout;
          error.stderr = stderr + error.stderr;
          throw error;
        }
        if (error instanceof ErrexitError) {
          error.stdout = stdout + error.stdout;
          error.stderr = stderr + error.stderr;
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }

      if (item.terminator === ";;") {
        break;
      }
    }
  }

  return { stdout, stderr, exitCode };
}

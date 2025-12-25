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
import {
  BreakError,
  ContinueError,
  ErrexitError,
  ExitError,
  isScopeExitError,
  ReturnError,
} from "./errors.js";
import { expandWord, expandWordWithGlob } from "./expansion.js";
import type { InterpreterContext } from "./types.js";

// Re-export error classes for backwards compatibility
export {
  BreakError,
  ContinueError,
  ErrexitError,
  isControlFlowError,
  isScopeExitError,
  NounsetError,
  ReturnError,
} from "./errors.js";

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
        if (
          isScopeExitError(error) ||
          error instanceof ErrexitError ||
          error instanceof ExitError
        ) {
          error.prependOutput(stdout, stderr);
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
      if (
        isScopeExitError(error) ||
        error instanceof ErrexitError ||
        error instanceof ExitError
      ) {
        error.prependOutput(stdout, stderr);
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
          // Only propagate if levels > 1 AND we're not at the outermost loop
          // Per bash docs: "If n is greater than the number of enclosing loops,
          // the last enclosing loop is exited"
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
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
          // Only propagate if levels > 1 AND we're not at the outermost loop
          // Per bash docs: "If n is greater than the number of enclosing loops,
          // the last enclosing loop is resumed"
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          continue;
        }
        if (
          error instanceof ReturnError ||
          error instanceof ErrexitError ||
          error instanceof ExitError
        ) {
          error.prependOutput(stdout, stderr);
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
    }
  } finally {
    ctx.state.loopDepth--;
  }

  // Note: In bash, the loop variable persists after the loop with its last value
  // Do NOT delete ctx.state.env[node.variable] here

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
    await evaluateArithmetic(ctx, node.init.expression);
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
        const condResult = await evaluateArithmetic(ctx, node.condition.expression);
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
          // Only propagate if levels > 1 AND we're not at the outermost loop
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
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
          // Only propagate if levels > 1 AND we're not at the outermost loop
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          // Still need to run the update expression
          if (node.update) {
            await evaluateArithmetic(ctx, node.update.expression);
          }
          continue;
        }
        if (
          error instanceof ReturnError ||
          error instanceof ErrexitError ||
          error instanceof ExitError
        ) {
          error.prependOutput(stdout, stderr);
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }

      if (node.update) {
        await evaluateArithmetic(ctx, node.update.expression);
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
  stdin = "",
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let iterations = 0;

  // Save and set groupStdin for piped while loops
  const savedGroupStdin = ctx.state.groupStdin;
  if (stdin) {
    ctx.state.groupStdin = stdin;
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
          // Only propagate if levels > 1 AND we're not at the outermost loop
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
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
          // Only propagate if levels > 1 AND we're not at the outermost loop
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          continue;
        }
        if (
          error instanceof ReturnError ||
          error instanceof ErrexitError ||
          error instanceof ExitError
        ) {
          error.prependOutput(stdout, stderr);
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }
    }
  } finally {
    ctx.state.loopDepth--;
    ctx.state.groupStdin = savedGroupStdin;
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
          // Only propagate if levels > 1 AND we're not at the outermost loop
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
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
          // Only propagate if levels > 1 AND we're not at the outermost loop
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            throw error;
          }
          continue;
        }
        if (
          error instanceof ReturnError ||
          error instanceof ErrexitError ||
          error instanceof ExitError
        ) {
          error.prependOutput(stdout, stderr);
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

  // fallThrough tracks whether we should execute the next case body unconditionally
  // This happens when the previous case ended with ;& (unconditional fall-through)
  let fallThrough = false;

  for (let i = 0; i < node.items.length; i++) {
    const item = node.items[i];
    let matched = fallThrough; // If falling through, automatically match

    if (!fallThrough) {
      // Normal pattern matching
      for (const pattern of item.patterns) {
        const patternStr = await expandWord(ctx, pattern);
        if (matchPattern(value, patternStr)) {
          matched = true;
          break;
        }
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
        if (
          isScopeExitError(error) ||
          error instanceof ErrexitError ||
          error instanceof ExitError
        ) {
          error.prependOutput(stdout, stderr);
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { stdout, stderr: `${stderr + message}\n`, exitCode: 1 };
      }

      // Handle different terminators:
      // ;; - stop, no fall-through
      // ;& - unconditional fall-through (execute next body without pattern check)
      // ;;& - continue pattern matching (check next case patterns)
      if (item.terminator === ";;") {
        break;
      } else if (item.terminator === ";&") {
        fallThrough = true;
      } else {
        // ;;& - reset fallThrough, continue to next iteration for pattern matching
        fallThrough = false;
      }
    } else {
      fallThrough = false;
    }
  }

  return { stdout, stderr, exitCode };
}

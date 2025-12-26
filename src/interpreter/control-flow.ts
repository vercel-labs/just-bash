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
  HereDocNode,
  IfNode,
  UntilNode,
  WhileNode,
  WordNode,
} from "../ast/types.js";
import type { ExecResult } from "../types.js";
import { evaluateArithmetic } from "./arithmetic.js";
import { matchPattern } from "./conditionals.js";
import { BreakError, ContinueError } from "./errors.js";
import {
  escapeGlobChars,
  expandWord,
  expandWordWithGlob,
  isWordFullyQuoted,
} from "./expansion.js";
import { executeCondition } from "./helpers/condition.js";
import { handleLoopError } from "./helpers/loop.js";
import { failure, result } from "./helpers/result.js";
import { executeStatements } from "./helpers/statements.js";
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

  for (const clause of node.clauses) {
    // Condition evaluation should not trigger errexit
    const condResult = await executeCondition(ctx, clause.condition);
    stdout += condResult.stdout;
    stderr += condResult.stderr;

    if (condResult.exitCode === 0) {
      return executeStatements(ctx, clause.body, stdout, stderr);
    }
  }

  if (node.elseBody) {
    return executeStatements(ctx, node.elseBody, stdout, stderr);
  }

  return result(stdout, stderr, 0);
}

export async function executeFor(
  ctx: InterpreterContext,
  node: ForNode,
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let iterations = 0;

  // Validate variable name at runtime (matches bash behavior)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(node.variable)) {
    return failure(`bash: \`${node.variable}': not a valid identifier\n`);
  }

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
        return result(
          stdout,
          `${stderr}bash: for loop: too many iterations (${ctx.maxLoopIterations}), increase maxLoopIterations\n`,
          1,
        );
      }

      ctx.state.env[node.variable] = value;

      try {
        for (const stmt of node.body) {
          const stmtResult = await ctx.executeStatement(stmt);
          stdout += stmtResult.stdout;
          stderr += stmtResult.stderr;
          exitCode = stmtResult.exitCode;
        }
      } catch (error) {
        const loopResult = handleLoopError(
          error,
          stdout,
          stderr,
          ctx.state.loopDepth,
        );
        stdout = loopResult.stdout;
        stderr = loopResult.stderr;
        if (loopResult.action === "break") break;
        if (loopResult.action === "continue") continue;
        if (loopResult.action === "error") {
          return result(stdout, stderr, loopResult.exitCode ?? 1);
        }
        throw loopResult.error;
      }
    }
  } finally {
    ctx.state.loopDepth--;
  }

  // Note: In bash, the loop variable persists after the loop with its last value
  // Do NOT delete ctx.state.env[node.variable] here

  return result(stdout, stderr, exitCode);
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
        return result(
          stdout,
          `${stderr}bash: for loop: too many iterations (${ctx.maxLoopIterations}), increase maxLoopIterations\n`,
          1,
        );
      }

      if (node.condition) {
        const condResult = await evaluateArithmetic(
          ctx,
          node.condition.expression,
        );
        if (condResult === 0) break;
      }

      try {
        for (const stmt of node.body) {
          const stmtResult = await ctx.executeStatement(stmt);
          stdout += stmtResult.stdout;
          stderr += stmtResult.stderr;
          exitCode = stmtResult.exitCode;
        }
      } catch (error) {
        const loopResult = handleLoopError(
          error,
          stdout,
          stderr,
          ctx.state.loopDepth,
        );
        stdout = loopResult.stdout;
        stderr = loopResult.stderr;
        if (loopResult.action === "break") break;
        if (loopResult.action === "continue") {
          // Still need to run the update expression on continue
          if (node.update) {
            await evaluateArithmetic(ctx, node.update.expression);
          }
          continue;
        }
        if (loopResult.action === "error") {
          return result(stdout, stderr, loopResult.exitCode ?? 1);
        }
        throw loopResult.error;
      }

      if (node.update) {
        await evaluateArithmetic(ctx, node.update.expression);
      }
    }
  } finally {
    ctx.state.loopDepth--;
  }

  return result(stdout, stderr, exitCode);
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

  // Process here-doc redirections to get stdin content
  let effectiveStdin = stdin;
  for (const redir of node.redirections) {
    if (
      (redir.operator === "<<" || redir.operator === "<<-") &&
      redir.target.type === "HereDoc"
    ) {
      const hereDoc = redir.target as HereDocNode;
      let content = await expandWord(ctx, hereDoc.content);
      if (hereDoc.stripTabs) {
        content = content
          .split("\n")
          .map((line) => line.replace(/^\t+/, ""))
          .join("\n");
      }
      effectiveStdin = content;
    } else if (redir.operator === "<<<" && redir.target.type === "Word") {
      effectiveStdin = `${await expandWord(ctx, redir.target as WordNode)}\n`;
    } else if (redir.operator === "<" && redir.target.type === "Word") {
      try {
        const target = await expandWord(ctx, redir.target as WordNode);
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        effectiveStdin = await ctx.fs.readFile(filePath);
      } catch {
        const target = await expandWord(ctx, redir.target as WordNode);
        return failure(`bash: ${target}: No such file or directory\n`);
      }
    }
  }

  // Save and set groupStdin for piped while loops
  const savedGroupStdin = ctx.state.groupStdin;
  if (effectiveStdin) {
    ctx.state.groupStdin = effectiveStdin;
  }

  ctx.state.loopDepth++;
  try {
    while (true) {
      iterations++;
      if (iterations > ctx.maxLoopIterations) {
        return result(
          stdout,
          `${stderr}bash: while loop: too many iterations (${ctx.maxLoopIterations}), increase maxLoopIterations\n`,
          1,
        );
      }

      let conditionExitCode = 0;
      let shouldBreak = false;
      let shouldContinue = false;

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
      } catch (error) {
        // break/continue in condition should affect THIS while loop
        if (error instanceof BreakError) {
          stdout += error.stdout;
          stderr += error.stderr;
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            ctx.state.inCondition = savedInCondition;
            throw error;
          }
          shouldBreak = true;
        } else if (error instanceof ContinueError) {
          stdout += error.stdout;
          stderr += error.stderr;
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
            error.levels--;
            error.stdout = stdout;
            error.stderr = stderr;
            ctx.state.inCondition = savedInCondition;
            throw error;
          }
          shouldContinue = true;
        } else {
          ctx.state.inCondition = savedInCondition;
          throw error;
        }
      } finally {
        ctx.state.inCondition = savedInCondition;
      }

      if (shouldBreak) break;
      if (shouldContinue) continue;
      if (conditionExitCode !== 0) break;

      try {
        for (const stmt of node.body) {
          const stmtResult = await ctx.executeStatement(stmt);
          stdout += stmtResult.stdout;
          stderr += stmtResult.stderr;
          exitCode = stmtResult.exitCode;
        }
      } catch (error) {
        const loopResult = handleLoopError(
          error,
          stdout,
          stderr,
          ctx.state.loopDepth,
        );
        stdout = loopResult.stdout;
        stderr = loopResult.stderr;
        if (loopResult.action === "break") break;
        if (loopResult.action === "continue") continue;
        if (loopResult.action === "error") {
          return result(stdout, stderr, loopResult.exitCode ?? 1);
        }
        throw loopResult.error;
      }
    }
  } finally {
    ctx.state.loopDepth--;
    ctx.state.groupStdin = savedGroupStdin;
  }

  return result(stdout, stderr, exitCode);
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
        return result(
          stdout,
          `${stderr}bash: until loop: too many iterations (${ctx.maxLoopIterations}), increase maxLoopIterations\n`,
          1,
        );
      }

      // Condition evaluation should not trigger errexit
      const condResult = await executeCondition(ctx, node.condition);
      stdout += condResult.stdout;
      stderr += condResult.stderr;

      if (condResult.exitCode === 0) break;

      try {
        for (const stmt of node.body) {
          const stmtResult = await ctx.executeStatement(stmt);
          stdout += stmtResult.stdout;
          stderr += stmtResult.stderr;
          exitCode = stmtResult.exitCode;
        }
      } catch (error) {
        const loopResult = handleLoopError(
          error,
          stdout,
          stderr,
          ctx.state.loopDepth,
        );
        stdout = loopResult.stdout;
        stderr = loopResult.stderr;
        if (loopResult.action === "break") break;
        if (loopResult.action === "continue") continue;
        if (loopResult.action === "error") {
          return result(stdout, stderr, loopResult.exitCode ?? 1);
        }
        throw loopResult.error;
      }
    }
  } finally {
    ctx.state.loopDepth--;
  }

  return result(stdout, stderr, exitCode);
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
        let patternStr = await expandWord(ctx, pattern);
        // If the pattern is fully quoted, escape glob characters for literal matching
        if (isWordFullyQuoted(pattern)) {
          patternStr = escapeGlobChars(patternStr);
        }
        if (matchPattern(value, patternStr)) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      const bodyResult = await executeStatements(
        ctx,
        item.body,
        stdout,
        stderr,
      );
      stdout = bodyResult.stdout;
      stderr = bodyResult.stderr;
      exitCode = bodyResult.exitCode;

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

  return result(stdout, stderr, exitCode);
}

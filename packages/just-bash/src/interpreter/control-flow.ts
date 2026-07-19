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
  StatementNode,
  UntilNode,
  WhileNode,
  WordNode,
} from "../ast/types.js";
import { utf8ByteLength } from "../encoding.js";
import type { ExecResult } from "../types.js";
import { evaluateArithmetic } from "./arithmetic.js";
import { matchPattern } from "./conditionals.js";
import {
  BreakError,
  ContinueError,
  ErrexitError,
  ExecutionLimitError,
  ExitError,
  GlobError,
  isScopeExitError,
  SubshellExitError,
} from "./errors.js";
import {
  escapeGlobChars,
  expandWord,
  expandWordWithGlob,
  isWordFullyQuoted,
} from "./expansion.js";
import { executeCondition } from "./helpers/condition.js";
import { getErrorMessage } from "./helpers/errors.js";
import { handleLoopError } from "./helpers/loop.js";
import { failure, throwExecutionLimit } from "./helpers/result.js";
import { applyRedirections, preOpenOutputRedirects } from "./redirections.js";
import type { InterpreterContext } from "./types.js";

class CompoundOutput {
  private stdoutChunks: string[] = [];
  private stderrChunks: string[] = [];
  private totalBytes = 0;

  constructor(private readonly ctx: InterpreterContext) {}

  append(stdout: string, stderr: string): void {
    const addedBytes = utf8ByteLength(stdout) + utf8ByteLength(stderr);
    if (addedBytes > this.ctx.limits.maxOutputSize - this.totalBytes) {
      throwExecutionLimit(
        `total output size exceeded (>${this.ctx.limits.maxOutputSize} bytes), increase executionLimits.maxOutputSize`,
        "output_size",
      );
    }
    if (stdout) this.stdoutChunks.push(stdout);
    if (stderr) this.stderrChunks.push(stderr);
    this.totalBytes += addedBytes;
  }

  /** Append output synthesized here rather than relayed from a child. */
  appendUnaccounted(stdout: string, stderr: string): void {
    this.ctx.executionScope.appendOutput("stdout", stdout, "control-flow");
    this.ctx.executionScope.appendOutput("stderr", stderr, "control-flow");
    this.append(stdout, stderr);
  }

  replace(stdout: string, stderr: string): void {
    this.stdoutChunks = [];
    this.stderrChunks = [];
    this.totalBytes = 0;
    this.append(stdout, stderr);
  }

  get stdout(): string {
    return this.stdoutChunks.join("");
  }

  get stderr(): string {
    return this.stderrChunks.join("");
  }

  /** Preserve child accounting while relaying compound-command output. */
  build(exitCode: number): ExecResult {
    const stdout = this.stdout;
    const stderr = this.stderr;
    return {
      stdout,
      stderr,
      exitCode,
      internalOutputAccounting: {
        stdout: utf8ByteLength(stdout),
        stderr: utf8ByteLength(stderr),
      },
    };
  }
}

async function executeBoundedStatements(
  ctx: InterpreterContext,
  statements: StatementNode[],
  output: CompoundOutput,
): Promise<ExecResult> {
  let exitCode = 0;
  try {
    for (const statement of statements) {
      const statementResult = await ctx.executeStatement(statement);
      output.append(statementResult.stdout, statementResult.stderr);
      exitCode = statementResult.exitCode;
    }
  } catch (error) {
    if (
      isScopeExitError(error) ||
      error instanceof ErrexitError ||
      error instanceof ExitError ||
      error instanceof ExecutionLimitError ||
      error instanceof SubshellExitError
    ) {
      error.prependOutput(output.stdout, output.stderr);
      throw error;
    }
    output.appendUnaccounted("", `${getErrorMessage(error)}\n`);
    return output.build(1);
  }
  return output.build(exitCode);
}

export async function executeIf(
  ctx: InterpreterContext,
  node: IfNode,
): Promise<ExecResult> {
  const output = new CompoundOutput(ctx);

  for (const clause of node.clauses) {
    // Condition evaluation should not trigger errexit
    const condResult = await executeCondition(ctx, clause.condition);
    output.append(condResult.stdout, condResult.stderr);

    if (condResult.exitCode === 0) {
      return executeBoundedStatements(ctx, clause.body, output);
    }
  }

  if (node.elseBody) {
    return executeBoundedStatements(ctx, node.elseBody, output);
  }

  return output.build(0);
}

export async function executeFor(
  ctx: InterpreterContext,
  node: ForNode,
): Promise<ExecResult> {
  // Pre-open output redirects to truncate files BEFORE expanding words
  // This matches bash behavior where redirect files are opened before
  // any command substitutions in the word list are evaluated
  const preparedRedirects = await preOpenOutputRedirects(
    ctx,
    node.redirections,
  );
  if (preparedRedirects.error) {
    return preparedRedirects.error;
  }

  const output = new CompoundOutput(ctx);
  let exitCode = 0;
  let iterations = 0;

  // Validate variable name at runtime (matches bash behavior)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(node.variable)) {
    return failure(`bash: \`${node.variable}': not a valid identifier\n`);
  }

  let words: string[] = [];
  if (node.words === null) {
    words = (ctx.state.env.get("@") || "").split(" ").filter(Boolean);
  } else if (node.words.length === 0) {
    words = [];
  } else {
    try {
      for (const word of node.words) {
        const expanded = await expandWordWithGlob(ctx, word);
        words.push(...expanded.values);
      }
    } catch (e) {
      if (e instanceof GlobError) {
        // failglob: return error with exit code 1
        return { stdout: "", stderr: e.stderr, exitCode: 1 };
      }
      throw e;
    }
  }

  ctx.state.loopDepth++;
  try {
    for (const value of words) {
      iterations++;
      if (iterations > ctx.limits.maxLoopIterations) {
        throwExecutionLimit(
          `for loop: too many iterations (${ctx.limits.maxLoopIterations}), increase executionLimits.maxLoopIterations`,
          "iterations",
          output.stdout,
          output.stderr,
        );
      }

      ctx.state.env.set(node.variable, value);

      try {
        for (const stmt of node.body) {
          const stmtResult = await ctx.executeStatement(stmt);
          output.append(stmtResult.stdout, stmtResult.stderr);
          exitCode = stmtResult.exitCode;
        }
      } catch (error) {
        const loopResult = handleLoopError(
          error,
          output.stdout,
          output.stderr,
          ctx.state.loopDepth,
        );
        output.replace(loopResult.stdout, loopResult.stderr);
        if (loopResult.action === "break") break;
        if (loopResult.action === "continue") continue;
        if (loopResult.action === "error") {
          // Apply output redirections before returning
          const bodyResult = output.build(loopResult.exitCode ?? 1);
          return applyRedirections(
            ctx,
            bodyResult,
            node.redirections,
            preparedRedirects.targets,
          );
        }
        throw loopResult.error;
      }
    }
  } finally {
    ctx.state.loopDepth--;
  }

  // Note: In bash, the loop variable persists after the loop with its last value
  // Do NOT ctx.state.env.delete(node.variable) here

  // Apply output redirections
  const bodyResult = output.build(exitCode);
  return applyRedirections(
    ctx,
    bodyResult,
    node.redirections,
    preparedRedirects.targets,
  );
}

export async function executeCStyleFor(
  ctx: InterpreterContext,
  node: CStyleForNode,
): Promise<ExecResult> {
  // Pre-open output redirects to truncate files BEFORE evaluating expressions
  // This matches bash behavior where redirect files are opened before
  // any command substitutions in the loop are evaluated
  const preparedRedirects = await preOpenOutputRedirects(
    ctx,
    node.redirections,
  );
  if (preparedRedirects.error) {
    return preparedRedirects.error;
  }

  // Update currentLine for $LINENO - set to loop header line
  const loopLine = node.line;
  if (loopLine !== undefined) {
    ctx.state.currentLine = loopLine;
  }

  const output = new CompoundOutput(ctx);
  let exitCode = 0;
  let iterations = 0;

  if (node.init) {
    await evaluateArithmetic(ctx, node.init.expression);
  }

  ctx.state.loopDepth++;
  try {
    while (true) {
      iterations++;
      if (iterations > ctx.limits.maxLoopIterations) {
        throwExecutionLimit(
          `for loop: too many iterations (${ctx.limits.maxLoopIterations}), increase executionLimits.maxLoopIterations`,
          "iterations",
          output.stdout,
          output.stderr,
        );
      }

      if (node.condition) {
        // Set LINENO to loop header line for condition evaluation
        if (loopLine !== undefined) {
          ctx.state.currentLine = loopLine;
        }
        const condResult = await evaluateArithmetic(
          ctx,
          node.condition.expression,
        );
        if (condResult === 0) break;
      }

      try {
        for (const stmt of node.body) {
          const stmtResult = await ctx.executeStatement(stmt);
          output.append(stmtResult.stdout, stmtResult.stderr);
          exitCode = stmtResult.exitCode;
        }
      } catch (error) {
        const loopResult = handleLoopError(
          error,
          output.stdout,
          output.stderr,
          ctx.state.loopDepth,
        );
        output.replace(loopResult.stdout, loopResult.stderr);
        if (loopResult.action === "break") break;
        if (loopResult.action === "continue") {
          // Still need to run the update expression on continue
          if (node.update) {
            await evaluateArithmetic(ctx, node.update.expression);
          }
          continue;
        }
        if (loopResult.action === "error") {
          // Apply output redirections before returning
          const bodyResult = output.build(loopResult.exitCode ?? 1);
          return applyRedirections(
            ctx,
            bodyResult,
            node.redirections,
            preparedRedirects.targets,
          );
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

  // Apply output redirections
  const bodyResult = output.build(exitCode);
  return applyRedirections(
    ctx,
    bodyResult,
    node.redirections,
    preparedRedirects.targets,
  );
}

export async function executeWhile(
  ctx: InterpreterContext,
  node: WhileNode,
  stdin = "",
): Promise<ExecResult> {
  const output = new CompoundOutput(ctx);
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
      if (iterations > ctx.limits.maxLoopIterations) {
        throwExecutionLimit(
          `while loop: too many iterations (${ctx.limits.maxLoopIterations}), increase executionLimits.maxLoopIterations`,
          "iterations",
          output.stdout,
          output.stderr,
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
          output.append(result.stdout, result.stderr);
          conditionExitCode = result.exitCode;
        }
      } catch (error) {
        // break/continue in condition should affect THIS while loop
        if (error instanceof BreakError) {
          output.append(error.stdout, error.stderr);
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
            error.levels--;
            error.stdout = output.stdout;
            error.stderr = output.stderr;
            ctx.state.inCondition = savedInCondition;
            throw error;
          }
          shouldBreak = true;
        } else if (error instanceof ContinueError) {
          output.append(error.stdout, error.stderr);
          if (error.levels > 1 && ctx.state.loopDepth > 1) {
            error.levels--;
            error.stdout = output.stdout;
            error.stderr = output.stderr;
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
          output.append(stmtResult.stdout, stmtResult.stderr);
          exitCode = stmtResult.exitCode;
        }
      } catch (error) {
        const loopResult = handleLoopError(
          error,
          output.stdout,
          output.stderr,
          ctx.state.loopDepth,
        );
        output.replace(loopResult.stdout, loopResult.stderr);
        if (loopResult.action === "break") break;
        if (loopResult.action === "continue") continue;
        if (loopResult.action === "error") {
          return output.build(loopResult.exitCode ?? 1);
        }
        throw loopResult.error;
      }
    }
  } finally {
    ctx.state.loopDepth--;
    ctx.state.groupStdin = savedGroupStdin;
  }

  return output.build(exitCode);
}

export async function executeUntil(
  ctx: InterpreterContext,
  node: UntilNode,
): Promise<ExecResult> {
  const output = new CompoundOutput(ctx);
  let exitCode = 0;
  let iterations = 0;

  ctx.state.loopDepth++;
  try {
    while (true) {
      iterations++;
      if (iterations > ctx.limits.maxLoopIterations) {
        throwExecutionLimit(
          `until loop: too many iterations (${ctx.limits.maxLoopIterations}), increase executionLimits.maxLoopIterations`,
          "iterations",
          output.stdout,
          output.stderr,
        );
      }

      // Condition evaluation should not trigger errexit
      const condResult = await executeCondition(ctx, node.condition);
      output.append(condResult.stdout, condResult.stderr);

      if (condResult.exitCode === 0) break;

      try {
        for (const stmt of node.body) {
          const stmtResult = await ctx.executeStatement(stmt);
          output.append(stmtResult.stdout, stmtResult.stderr);
          exitCode = stmtResult.exitCode;
        }
      } catch (error) {
        const loopResult = handleLoopError(
          error,
          output.stdout,
          output.stderr,
          ctx.state.loopDepth,
        );
        output.replace(loopResult.stdout, loopResult.stderr);
        if (loopResult.action === "break") break;
        if (loopResult.action === "continue") continue;
        if (loopResult.action === "error") {
          return output.build(loopResult.exitCode ?? 1);
        }
        throw loopResult.error;
      }
    }
  } finally {
    ctx.state.loopDepth--;
  }

  return output.build(exitCode);
}

export async function executeCase(
  ctx: InterpreterContext,
  node: CaseNode,
): Promise<ExecResult> {
  // Pre-open output redirects to truncate files BEFORE expanding case word
  // This matches bash behavior where redirect files are opened before
  // any command substitutions in the case word are evaluated
  const preparedRedirects = await preOpenOutputRedirects(
    ctx,
    node.redirections,
  );
  if (preparedRedirects.error) {
    return preparedRedirects.error;
  }

  const output = new CompoundOutput(ctx);
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
        const nocasematch = ctx.state.shoptOptions.nocasematch;
        const extglob = ctx.state.shoptOptions.extglob;
        if (matchPattern(value, patternStr, nocasematch, extglob)) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      const bodyResult = await executeBoundedStatements(ctx, item.body, output);
      output.replace(bodyResult.stdout, bodyResult.stderr);
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

  // Apply output redirections
  const bodyResult = output.build(exitCode);
  return applyRedirections(
    ctx,
    bodyResult,
    node.redirections,
    preparedRedirects.targets,
  );
}

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
  StatementNode,
  UntilNode,
  WhileNode,
} from "../ast/types.js";
import { getCurrentExtglob } from "../ast/types.js";
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
  expandWordForPattern,
  expandWordWithGlob,
  isWordFullyQuoted,
} from "./expansion.js";
import { appendBoundedElements } from "./helpers/bounded-array.js";
import { executeCondition } from "./helpers/condition.js";
import { getErrorMessage } from "./helpers/errors.js";
import { handleLoopError } from "./helpers/loop.js";
import { failure, throwExecutionLimit } from "./helpers/result.js";
import {
  type PreparedRedirections,
  withPreparedRedirections,
} from "./redirections.js";
import type { InterpreterContext } from "./types.js";

/**
 * Decide whether a loop takes ownership of the shared read stream
 * (`ctx.state.groupStdin`).
 *
 * A loop only installs — and therefore only restores — a stdin it brought
 * itself: its own input redirection (`< file`, here-doc, here-string), or the
 * stdin handed to it as a pipeline stage. A stream merely INHERITED from an
 * enclosing group or loop must be left in place, because reads inside the body
 * advance it and restoring it afterwards would rewind the shared read
 * position: `printf 'a\nb\n' | { while read x; do break; done; read y; }` has
 * to see `y=b`, not `y=a`.
 *
 * `ownStdin` of `""` still counts as ownership — `done < empty-file` gives the
 * body an empty stream rather than the enclosing one.
 */
function resolveLoopStdin(
  ownStdin: string | undefined,
  pipelineStdin: string,
): { owns: true; stdin: string } | { owns: false } {
  if (ownStdin !== undefined) {
    return { owns: true, stdin: ownStdin };
  }
  if (pipelineStdin !== "") {
    return { owns: true, stdin: pipelineStdin };
  }
  return { owns: false };
}

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

  appendExpansionStderr(stderr: string): void {
    this.append("", stderr);
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
  return withPreparedRedirections(ctx, node.redirections, "", () =>
    executeIfBody(ctx, node),
  );
}

async function executeIfBody(
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
  return withPreparedRedirections(ctx, node.redirections, "", () =>
    executeForBody(ctx, node),
  );
}

async function executeForBody(
  ctx: InterpreterContext,
  node: ForNode,
): Promise<ExecResult> {
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
        appendBoundedElements(
          words,
          expanded.values,
          ctx.limits.maxArrayElements,
          "for-loop expansion",
        );
      }
    } catch (e) {
      if (e instanceof GlobError) {
        // failglob: return error with exit code 1
        const stderr = (ctx.state.expansionStderr || "") + e.stderr;
        ctx.state.expansionStderr = "";
        return { stdout: "", stderr, exitCode: 1 };
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
          return output.build(loopResult.exitCode ?? 1);
        }
        throw loopResult.error;
      }
    }
  } finally {
    ctx.state.loopDepth--;
  }

  // Note: In bash, the loop variable persists after the loop with its last value
  // Do NOT ctx.state.env.delete(node.variable) here

  return output.build(exitCode);
}

export async function executeCStyleFor(
  ctx: InterpreterContext,
  node: CStyleForNode,
): Promise<ExecResult> {
  return withPreparedRedirections(ctx, node.redirections, "", () =>
    executeCStyleForBody(ctx, node),
  );
}

async function executeCStyleForBody(
  ctx: InterpreterContext,
  node: CStyleForNode,
): Promise<ExecResult> {
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
          return output.build(loopResult.exitCode ?? 1);
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

  return output.build(exitCode);
}

export async function executeWhile(
  ctx: InterpreterContext,
  node: WhileNode,
  stdin = "",
): Promise<ExecResult> {
  return withPreparedRedirections(ctx, node.redirections, stdin, (prepared) =>
    executeWhileBody(ctx, node, stdin, prepared),
  );
}

async function executeWhileBody(
  ctx: InterpreterContext,
  node: WhileNode,
  stdin: string,
  prepared: PreparedRedirections,
): Promise<ExecResult> {
  const output = new CompoundOutput(ctx);
  let exitCode = 0;
  let iterations = 0;

  // Install groupStdin only for a stream this loop owns (see resolveLoopStdin)
  const loopStdin = resolveLoopStdin(prepared.stdin, stdin);
  const savedGroupStdin = ctx.state.groupStdin;
  if (loopStdin.owns) {
    ctx.state.groupStdin = loopStdin.stdin;
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
    if (loopStdin.owns) {
      ctx.state.groupStdin = savedGroupStdin;
    }
  }

  return output.build(exitCode);
}

export async function executeUntil(
  ctx: InterpreterContext,
  node: UntilNode,
  stdin = "",
): Promise<ExecResult> {
  return withPreparedRedirections(ctx, node.redirections, stdin, (prepared) =>
    executeUntilBody(ctx, node, stdin, prepared),
  );
}

async function executeUntilBody(
  ctx: InterpreterContext,
  node: UntilNode,
  stdin: string,
  prepared: PreparedRedirections,
): Promise<ExecResult> {
  const output = new CompoundOutput(ctx);
  let exitCode = 0;
  let iterations = 0;

  // Install groupStdin only for a stream this loop owns (see resolveLoopStdin)
  const loopStdin = resolveLoopStdin(prepared.stdin, stdin);
  const savedGroupStdin = ctx.state.groupStdin;
  if (loopStdin.owns) {
    ctx.state.groupStdin = loopStdin.stdin;
  }

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
    if (loopStdin.owns) {
      ctx.state.groupStdin = savedGroupStdin;
    }
  }

  return output.build(exitCode);
}

export async function executeCase(
  ctx: InterpreterContext,
  node: CaseNode,
): Promise<ExecResult> {
  return withPreparedRedirections(ctx, node.redirections, "", () =>
    executeCaseBody(ctx, node),
  );
}

async function executeCaseBody(
  ctx: InterpreterContext,
  node: CaseNode,
): Promise<ExecResult> {
  const output = new CompoundOutput(ctx);
  let exitCode = 0;

  const value = await expandWord(ctx, node.word);
  if (ctx.state.expansionStderr) {
    output.appendExpansionStderr(ctx.state.expansionStderr);
    ctx.state.expansionStderr = "";
  }

  // fallThrough tracks whether we should execute the next case body unconditionally
  // This happens when the previous case ended with ;& (unconditional fall-through)
  let fallThrough = false;

  for (let i = 0; i < node.items.length; i++) {
    const item = node.items[i];
    let matched = fallThrough; // If falling through, automatically match

    if (!fallThrough) {
      // Normal pattern matching
      for (const pattern of item.patterns) {
        const hasStructuredExtglob = pattern.parts.some(
          (part) => part.type === "Glob" && getCurrentExtglob(part),
        );
        let patternStr = hasStructuredExtglob
          ? await expandWordForPattern(ctx, pattern)
          : await expandWord(ctx, pattern);
        if (ctx.state.expansionStderr) {
          output.appendExpansionStderr(ctx.state.expansionStderr);
          ctx.state.expansionStderr = "";
        }
        // If the pattern is fully quoted, escape glob characters for literal matching
        if (isWordFullyQuoted(pattern)) {
          patternStr = escapeGlobChars(patternStr);
        }
        const nocasematch = ctx.state.shoptOptions.nocasematch;
        const extglob = ctx.state.shoptOptions.extglob;
        if (
          matchPattern(
            value,
            patternStr,
            nocasematch,
            extglob,
            ctx.limits.maxCallDepth,
          )
        ) {
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

  return output.build(exitCode);
}

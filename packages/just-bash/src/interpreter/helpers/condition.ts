/**
 * Condition execution helper for the interpreter.
 *
 * Handles executing condition statements with proper inCondition state management.
 * Used by if, while, and until loops.
 */

import type { StatementNode } from "../../ast/types.js";
import { ExecutionOutputAccumulator } from "../../execution-output.js";
import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

export type ConditionResult = Pick<
  ExecResult,
  "stdout" | "stderr" | "exitCode" | "internalOutputAccounting"
>;

/**
 * Execute condition statements with inCondition flag set.
 * This prevents errexit from triggering during condition evaluation.
 *
 * @param ctx - Interpreter context
 * @param statements - Condition statements to execute
 * @returns Accumulated stdout, stderr, and final exit code
 */
export async function executeCondition(
  ctx: InterpreterContext,
  statements: StatementNode[],
): Promise<ConditionResult> {
  const savedInCondition = ctx.state.inCondition;
  ctx.state.inCondition = true;

  const output = new ExecutionOutputAccumulator(
    ctx.executionScope,
    "condition",
  );
  let exitCode = 0;

  try {
    for (const stmt of statements) {
      const result = await ctx.executeStatement(stmt);
      output.appendResult(result);
      exitCode = result.exitCode;
    }
  } catch (error) {
    output.prependTo(error);
    throw error;
  } finally {
    ctx.state.inCondition = savedInCondition;
  }

  return output.build(exitCode);
}

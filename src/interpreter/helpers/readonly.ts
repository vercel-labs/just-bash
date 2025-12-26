/**
 * Readonly variable helpers.
 *
 * Consolidates readonly variable logic used in declare, export, local, etc.
 */

import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";
import { failure } from "./result.js";

/**
 * Mark a variable as readonly.
 */
export function markReadonly(ctx: InterpreterContext, name: string): void {
  ctx.state.readonlyVars = ctx.state.readonlyVars || new Set();
  ctx.state.readonlyVars.add(name);
}

/**
 * Check if a variable is readonly.
 */
export function isReadonly(ctx: InterpreterContext, name: string): boolean {
  return ctx.state.readonlyVars?.has(name) ?? false;
}

/**
 * Check if a variable is readonly and return an error if so.
 * Returns null if the variable is not readonly (can be modified).
 *
 * @param ctx - Interpreter context
 * @param name - Variable name
 * @param command - Command name for error message (default: "bash")
 * @returns Error result if readonly, null otherwise
 */
export function checkReadonlyError(
  ctx: InterpreterContext,
  name: string,
  command = "bash",
): ExecResult | null {
  if (isReadonly(ctx, name)) {
    return failure(`${command}: ${name}: readonly variable\n`);
  }
  return null;
}

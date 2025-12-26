/**
 * Variable assignment helpers for declare, readonly, local, export builtins.
 */

import type { ExecResult } from "../../types.js";
import { checkReadonlyError, markReadonly } from "../helpers/readonly.js";
import type { InterpreterContext } from "../types.js";
import { parseArrayElements } from "./declare.js";

/**
 * Result of parsing an assignment argument.
 */
export interface ParsedAssignment {
  name: string;
  isArray: boolean;
  arrayElements?: string[];
  value?: string;
}

/**
 * Parse an assignment argument like "name=value" or "name=(a b c)".
 */
export function parseAssignment(arg: string): ParsedAssignment {
  // Check for array assignment: name=(...)
  const arrayMatch = arg.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=\((.*)\)$/s);
  if (arrayMatch) {
    return {
      name: arrayMatch[1],
      isArray: true,
      arrayElements: parseArrayElements(arrayMatch[2]),
    };
  }

  // Check for scalar assignment: name=value
  if (arg.includes("=")) {
    const eqIdx = arg.indexOf("=");
    return {
      name: arg.slice(0, eqIdx),
      isArray: false,
      value: arg.slice(eqIdx + 1),
    };
  }

  // Just a name, no value
  return {
    name: arg,
    isArray: false,
  };
}

/**
 * Options for setting a variable.
 */
export interface SetVariableOptions {
  makeReadonly?: boolean;
  checkReadonly?: boolean;
}

/**
 * Set a variable from a parsed assignment.
 * Returns an error result if the variable is readonly, otherwise null.
 */
export function setVariable(
  ctx: InterpreterContext,
  assignment: ParsedAssignment,
  options: SetVariableOptions = {},
): ExecResult | null {
  const { name, isArray, arrayElements, value } = assignment;
  const { makeReadonly = false, checkReadonly = true } = options;

  // Check if variable is readonly (if checking is enabled)
  if (checkReadonly) {
    const error = checkReadonlyError(ctx, name);
    if (error) return error;
  }

  if (isArray && arrayElements) {
    // Set array elements
    for (let i = 0; i < arrayElements.length; i++) {
      ctx.state.env[`${name}_${i}`] = arrayElements[i];
    }
    ctx.state.env[`${name}__length`] = String(arrayElements.length);
  } else if (value !== undefined) {
    // Set scalar value
    ctx.state.env[name] = value;
  }

  // Mark as readonly if requested
  if (makeReadonly) {
    markReadonly(ctx, name);
  }

  return null; // Success
}

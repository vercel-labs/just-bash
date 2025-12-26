/**
 * Function Handling
 *
 * Handles shell function definition and invocation:
 * - Function definition (adding to function table)
 * - Function calls (with positional parameters and local scopes)
 */

import type { FunctionDefNode } from "../ast/types.js";
import type { ExecResult } from "../types.js";
import { ReturnError } from "./errors.js";
import { failure, OK, result } from "./helpers/result.js";
import type { InterpreterContext } from "./types.js";

export function executeFunctionDef(
  ctx: InterpreterContext,
  node: FunctionDefNode,
): ExecResult {
  ctx.state.functions.set(node.name, node);
  return OK;
}

export async function callFunction(
  ctx: InterpreterContext,
  func: FunctionDefNode,
  args: string[],
): Promise<ExecResult> {
  ctx.state.callDepth++;
  if (ctx.state.callDepth > ctx.maxCallDepth) {
    ctx.state.callDepth--;
    return failure(
      `bash: ${func.name}: maximum recursion depth (${ctx.maxCallDepth}) exceeded, increase maxCallDepth\n`,
    );
  }

  ctx.state.localScopes.push(new Map());

  const savedPositional: Record<string, string | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    savedPositional[String(i + 1)] = ctx.state.env[String(i + 1)];
    ctx.state.env[String(i + 1)] = args[i];
  }
  savedPositional["@"] = ctx.state.env["@"];
  savedPositional["#"] = ctx.state.env["#"];
  ctx.state.env["@"] = args.join(" ");
  ctx.state.env["#"] = String(args.length);

  const cleanup = (): void => {
    const localScope = ctx.state.localScopes.pop();
    if (localScope) {
      for (const [varName, originalValue] of localScope) {
        if (originalValue === undefined) {
          delete ctx.state.env[varName];
        } else {
          ctx.state.env[varName] = originalValue;
        }
      }
    }

    for (const [key, value] of Object.entries(savedPositional)) {
      if (value === undefined) {
        delete ctx.state.env[key];
      } else {
        ctx.state.env[key] = value;
      }
    }

    ctx.state.callDepth--;
  };

  try {
    const execResult = await ctx.executeCommand(func.body, "");
    cleanup();
    return execResult;
  } catch (error) {
    cleanup();
    // Handle return statement - convert to normal exit with the specified code
    if (error instanceof ReturnError) {
      return result(error.stdout, error.stderr, error.exitCode);
    }
    throw error;
  }
}

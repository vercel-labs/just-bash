/**
 * Function Handling
 *
 * Handles shell function definition and invocation:
 * - Function definition (adding to function table)
 * - Function calls (with positional parameters and local scopes)
 */

import type { FunctionDefNode } from "../ast/types.js";
import type { ExecResult } from "../types.js";
import type { InterpreterContext } from "./types.js";

export function executeFunctionDef(
  ctx: InterpreterContext,
  node: FunctionDefNode,
): ExecResult {
  ctx.state.functions.set(node.name, node);
  return { stdout: "", stderr: "", exitCode: 0 };
}

export async function callFunction(
  ctx: InterpreterContext,
  func: FunctionDefNode,
  args: string[],
): Promise<ExecResult> {
  ctx.state.callDepth++;
  if (ctx.state.callDepth > ctx.maxCallDepth) {
    ctx.state.callDepth--;
    return {
      stdout: "",
      stderr: `bash: ${func.name}: maximum recursion depth (${ctx.maxCallDepth}) exceeded, increase maxCallDepth\n`,
      exitCode: 1,
    };
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

  const result = await ctx.executeCommand(func.body, "");

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
  return result;
}

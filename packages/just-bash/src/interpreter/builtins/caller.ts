import type { ExecResult } from "../../types.js";
import { failure, result, success } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

/** Read the bounded interpreter stack, including source invocations. */
export function handleCaller(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  let expression = args[0];
  if (expression === "--") expression = args[1];
  else if (expression?.startsWith("-") && expression !== "-")
    return failure(
      `bash: caller: ${expression}: invalid option\ncaller: usage: caller [expr]\n`,
      2,
    );
  if (
    expression !== undefined &&
    (!/^\s*[+-]?\d+\s*$/.test(expression) ||
      !Number.isSafeInteger(Number(expression)))
  )
    return failure(
      `bash: caller: ${expression}: invalid number\ncaller: usage: caller [expr]\n`,
      2,
    );
  const depth = expression === undefined ? 0 : Number(expression);
  const frames = ctx.state.callerFrames ?? [];
  const current = frames[depth];
  const parent = frames[depth + 1];
  if (depth < 0 || !current || (expression !== undefined && !parent))
    return result("", "", 1);
  return success(
    expression === undefined
      ? `${current.line} ${parent?.source ?? "NULL"}\n`
      : `${current.line} ${parent.name} ${parent.source}\n`,
  );
}

import type { ExecResult } from "../../types.js";
import { PosixFatalError } from "../errors.js";
import { failure, OK } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleShift(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  let n = 1;

  if (args.length > 0) {
    const parsed = Number.parseInt(args[0], 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      const errorMsg = `bash: shift: ${args[0]}: numeric argument required\n`;
      if (ctx.state.options.posix) {
        throw new PosixFatalError(1, "", errorMsg);
      }
      return failure(errorMsg);
    }
    n = parsed;
  }

  const declared = Number.parseInt(ctx.state.env.get("#") || "0", 10);
  const params: string[] = [];
  while (
    params.length < declared &&
    ctx.state.env.has(String(params.length + 1))
  ) {
    params.push(ctx.state.env.get(String(params.length + 1)) ?? "");
  }

  if (n > params.length) {
    const errorMsg = "bash: shift: shift count out of range\n";
    if (ctx.state.options.posix) {
      throw new PosixFatalError(1, "", errorMsg);
    }
    return failure(errorMsg);
  }

  if (n === 0) {
    return OK;
  }

  const newParams = params.slice(n);

  for (let i = 1; i <= params.length; i++) {
    ctx.state.env.delete(String(i));
  }

  for (let i = 0; i < newParams.length; i++) {
    ctx.state.env.set(String(i + 1), newParams[i]);
  }

  ctx.state.env.set("#", String(newParams.length));
  ctx.state.env.set("@", newParams.join(" "));

  return OK;
}

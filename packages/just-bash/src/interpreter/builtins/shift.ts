import type { ExecResult } from "../../types.js";
import { PosixFatalError } from "../errors.js";
import { failure, OK } from "../helpers/result.js";
import {
  INTMAX_MAX,
  leadingInteger,
  moveStoredParams,
} from "../helpers/stored-params.js";
import type { InterpreterContext } from "../types.js";

export function handleShift(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  const n = args.length > 0 ? leadingInteger(args[0]) : 1n;
  if (n === undefined || n < 0n) {
    return fail(ctx, `${args[0]}: numeric argument required`);
  }

  const env = ctx.state.env;
  const count = leadingInteger(env.get("#") || "0");
  if (count === undefined) {
    if (n > 0n) {
      env.set("#", "0");
      env.set("@", "");
    }
    return OK;
  }

  if (count > INTMAX_MAX) {
    return n === 0n
      ? OK
      : fail(ctx, "$#: positional parameter count out of range");
  }

  if (n > count) {
    return fail(ctx, "shift count out of range");
  }

  if (n === 0n) {
    return OK;
  }

  const kept = moveStoredParams(env, count, n);
  env.set("#", String(count - n));
  env.set("@", kept.join(" "));

  return OK;
}

function fail(ctx: InterpreterContext, message: string): ExecResult {
  const errorMsg = `bash: shift: ${message}\n`;
  if (ctx.state.options.posix) {
    throw new PosixFatalError(1, "", errorMsg);
  }
  return failure(errorMsg);
}

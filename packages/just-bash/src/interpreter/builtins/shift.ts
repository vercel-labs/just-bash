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

  const env = ctx.state.env;
  const declared = env.get("#") || "0";
  const count = Number.parseInt(declared, 10);

  if (count > Math.max(env.size, ctx.limits.maxArrayElements)) {
    return shiftStoredParams(
      ctx,
      leadingInteger(declared),
      args.length > 0 ? leadingInteger(args[0]) : 1n,
    );
  }

  if (n > count) {
    return outOfRange(ctx);
  }

  if (n === 0) {
    return OK;
  }

  const params: string[] = [];
  for (let i = 1; i <= count; i++) {
    params.push(env.get(String(i)) || "");
  }

  const newParams = params.slice(n);

  for (let i = 1; i <= count; i++) {
    env.delete(String(i));
  }

  for (let i = 0; i < newParams.length; i++) {
    env.set(String(i + 1), newParams[i]);
  }

  env.set("#", String(newParams.length));
  env.set("@", newParams.join(" "));

  return OK;
}

function outOfRange(ctx: InterpreterContext): ExecResult {
  const errorMsg = "bash: shift: shift count out of range\n";
  if (ctx.state.options.posix) {
    throw new PosixFatalError(1, "", errorMsg);
  }
  return failure(errorMsg);
}

function leadingInteger(text: string): bigint {
  return BigInt(/^\s*[+-]?(\d+)/.exec(text)?.[1] ?? "0");
}

function shiftStoredParams(
  ctx: InterpreterContext,
  count: bigint,
  n: bigint,
): ExecResult {
  if (n > count) {
    return outOfRange(ctx);
  }

  if (n === 0n) {
    return OK;
  }

  const env = ctx.state.env;
  const kept: [bigint, string][] = [];
  for (const [key, value] of [...env]) {
    if (!/^[1-9]\d*$/.test(key)) continue;
    const index = BigInt(key);
    if (index > count) continue;
    env.delete(key);
    if (index > n) kept.push([index - n, value]);
  }

  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [index, value] of kept) {
    env.set(String(index), value);
  }

  env.set("#", String(count - n));
  env.set("@", kept.map(([, value]) => value).join(" "));

  return OK;
}

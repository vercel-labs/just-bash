import type { ExecResult } from "../../types.js";
import { PosixFatalError } from "../errors.js";
import { failure, OK } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleShift(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  const n = args.length > 0 ? leadingInteger(args[0]) : 1n;
  if (n === undefined || n < 0n) {
    const errorMsg = `bash: shift: ${args[0]}: numeric argument required\n`;
    if (ctx.state.options.posix) {
      throw new PosixFatalError(1, "", errorMsg);
    }
    return failure(errorMsg);
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

  if (n > count) {
    return outOfRange(ctx);
  }

  if (n === 0n) {
    return OK;
  }

  const params = storedParams(env, count);
  for (const [index] of params) {
    env.delete(String(index));
  }

  const kept = params.filter(([index]) => index > n);
  for (const [index, value] of kept) {
    env.set(String(index - n), value);
  }

  env.set("#", String(count - n));
  env.set("@", kept.map(([, value]) => value).join(" "));

  return OK;
}

function outOfRange(ctx: InterpreterContext): ExecResult {
  const errorMsg = "bash: shift: shift count out of range\n";
  if (ctx.state.options.posix) {
    throw new PosixFatalError(1, "", errorMsg);
  }
  return failure(errorMsg);
}

function leadingInteger(text: string): bigint | undefined {
  const match = /^\s*([+-]?)0*(\d+)/.exec(text);
  if (!match) return undefined;
  const [, sign, digits] = match;
  const magnitude = BigInt(digits);
  return sign === "-" ? -magnitude : magnitude;
}

function storedParams(
  env: Map<string, string>,
  count: bigint,
): [bigint, string][] {
  if (count <= BigInt(env.size)) {
    const params: [bigint, string][] = [];
    for (let i = 1n; i <= count; i++) {
      const value = env.get(String(i));
      if (value !== undefined) params.push([i, value]);
    }
    return params;
  }

  return [...env]
    .filter(([key]) => /^[1-9]\d*$/.test(key) && BigInt(key) <= count)
    .map(([key, value]): [bigint, string] => [BigInt(key), value])
    .sort(([a], [b]) => (a < b ? -1 : 1));
}

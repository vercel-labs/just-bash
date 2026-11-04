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
  const count = Number.parseInt(env.get("#") || "0", 10);

  if (n > count) {
    const errorMsg = "bash: shift: shift count out of range\n";
    if (ctx.state.options.posix) {
      throw new PosixFatalError(1, "", errorMsg);
    }
    return failure(errorMsg);
  }

  if (n === 0) {
    return OK;
  }

  if (count > Math.max(env.size, ctx.limits.maxArrayElements)) {
    shiftStoredParams(env, count, n);
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

function shiftStoredParams(
  env: Map<string, string>,
  count: number,
  n: number,
): void {
  const kept: [number, string][] = [];
  for (const [key, value] of [...env]) {
    const index = Number(key);
    if (String(index) !== key || !(index >= 1 && index <= count)) continue;
    env.delete(key);
    if (index > n) kept.push([index - n, value]);
  }

  kept.sort((a, b) => a[0] - b[0]);
  for (const [index, value] of kept) {
    env.set(String(index), value);
  }

  env.set("#", String(count - n));
  env.set("@", kept.map(([, value]) => value).join(" "));
}

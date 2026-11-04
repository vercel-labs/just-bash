import type { ExecResult } from "../../types.js";
import { PosixFatalError } from "../errors.js";
import { failure, OK } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

const MAX_ARRAY_LENGTH = 2 ** 27;
const MAX_MAP_SIZE = 2 ** 24;

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

  if (exceedsHostLimits(env, count, n)) {
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

export function exceedsHostLimits(
  env: Map<string, string>,
  count: number,
  n: number,
): boolean {
  if (count > MAX_ARRAY_LENGTH) return true;
  const size = env.size + count - n + (env.has("@") ? 0 : 1);
  if (!(size > MAX_MAP_SIZE)) return false;
  return size - storedParams(env, count).length > MAX_MAP_SIZE;
}

function storedParams(
  env: Map<string, string>,
  count: number,
): [number, string][] {
  const stored: [number, string][] = [];
  for (const [key, value] of env) {
    const index = Number(key);
    if (String(index) === key && index >= 1 && index <= count) {
      stored.push([index, value]);
    }
  }
  return stored;
}

function shiftStoredParams(
  env: Map<string, string>,
  count: number,
  n: number,
): void {
  const kept: [number, string][] = [];
  for (const [index, value] of storedParams(env, count)) {
    env.delete(String(index));
    if (index > n) kept.push([index - n, value]);
  }

  kept.sort((a, b) => a[0] - b[0]);
  for (const [index, value] of kept) {
    env.set(String(index), value);
  }

  const digits = /\d+/.exec(env.get("#") ?? "")?.[0] ?? "0";
  env.set("#", String(BigInt(digits) - BigInt(n)));
  env.set("@", kept.map(([, value]) => value).join(" "));
}

import type { ExecResult } from "../../types.js";
import { failure, success } from "../helpers/result.js";

/** Virtual processes have no OS user/system CPU counters. Never use wall time. */
export function handleTimes(args: string[]): ExecResult {
  const option = args[0];
  if (option?.startsWith("-") && option !== "-" && option !== "--")
    return failure(
      `bash: times: ${option}: invalid option\ntimes: usage: times\n`,
      2,
    );
  return success("0m0.000s 0m0.000s\n0m0.000s 0m0.000s\n");
}

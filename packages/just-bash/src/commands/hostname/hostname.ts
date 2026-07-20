/**
 * hostname - show or set the system's host name
 *
 * Usage: hostname [NAME]
 *
 * In sandboxed environment, always returns "localhost".
 */

import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";

async function hostnameExecute(
  _args: string[],
  _ctx: RuntimeCommandContext,
): Promise<ExecResult> {
  // In sandboxed environment, always return "localhost"
  return { stdout: "localhost\n", stderr: "", exitCode: 0 };
}

export const hostname: RuntimeCommand = {
  name: "hostname",
  execute: hostnameExecute,
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "hostname",
  flags: [],
};

/**
 * whoami - print effective user name
 *
 * Usage: whoami
 *
 * In sandboxed environment, always returns "user".
 */

import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";

async function whoamiExecute(
  _args: string[],
  _ctx: RuntimeCommandContext,
): Promise<ExecResult> {
  // In sandboxed environment, always return "user"
  return { stdout: "user\n", stderr: "", exitCode: 0 };
}

export const whoami: RuntimeCommand = {
  name: "whoami",
  execute: whoamiExecute,
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "whoami",
  flags: [],
};

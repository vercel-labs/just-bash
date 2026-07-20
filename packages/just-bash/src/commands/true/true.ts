import type { ExecResult, RuntimeCommand } from "../../types.js";

export const trueCommand: RuntimeCommand = {
  name: "true",

  async execute(): Promise<ExecResult> {
    return { stdout: "", stderr: "", exitCode: 0 };
  },
};

export const falseCommand: RuntimeCommand = {
  name: "false",

  async execute(): Promise<ExecResult> {
    return { stdout: "", stderr: "", exitCode: 1 };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "true",
  flags: [],
};

export const falseFlagsForFuzzing: CommandFuzzInfo = {
  name: "false",
  flags: [],
};

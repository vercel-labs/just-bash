import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";

const aliasHelp = {
  name: "alias",
  summary: "define or display aliases",
  usage: "alias [name[=value] ...]",
  options: ["    --help display this help and exit"],
};

export const aliasCommand: RuntimeCommand = {
  name: "alias",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(aliasHelp);
    }
    ctx.aliases ??= new Map();
    const aliases = ctx.aliases;

    // No arguments: list all aliases
    if (args.length === 0) {
      let stdout = "";
      for (const [name, value] of aliases) {
        stdout += `alias ${name}='${value}'\n`;
      }
      return { stdout, stderr: "", exitCode: 0 };
    }

    // Process alias definitions
    // Skip "--" option separator (POSIX standard)
    const processArgs = args[0] === "--" ? args.slice(1) : args;
    for (const arg of processArgs) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx === -1) {
        // Show single alias
        if (aliases.get(arg)) {
          return {
            stdout: `alias ${arg}='${aliases.get(arg)}'\n`,
            stderr: "",
            exitCode: 0,
          };
        } else {
          return {
            stdout: "",
            stderr: `alias: ${arg}: not found\n`,
            exitCode: 1,
          };
        }
      } else {
        // Set alias
        const name = arg.slice(0, eqIdx);
        let value = arg.slice(eqIdx + 1);
        // Remove quotes if present
        if (
          (value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))
        ) {
          value = value.slice(1, -1);
        }
        aliases.set(name, value);
      }
    }

    return { stdout: "", stderr: "", exitCode: 0 };
  },
};

export const unaliasCommand: RuntimeCommand = {
  name: "unalias",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp({
        name: "unalias",
        summary: "remove alias definitions",
        usage: "unalias name [name ...]",
        options: [
          "-a      remove all aliases",
          "    --help display this help and exit",
        ],
      });
    }

    if (args.length === 0) {
      return {
        stdout: "",
        stderr: "unalias: usage: unalias [-a] name [name ...]\n",
        exitCode: 1,
      };
    }

    ctx.aliases ??= new Map();
    const aliases = ctx.aliases;
    // Handle -a to remove all aliases
    if (args[0] === "-a") {
      aliases.clear();
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Skip "--" option separator (POSIX standard)
    const processArgs = args[0] === "--" ? args.slice(1) : args;

    let anyError = false;
    let stderr = "";
    for (const name of processArgs) {
      if (aliases.get(name)) {
        aliases.delete(name);
      } else {
        stderr += `unalias: ${name}: not found\n`;
        anyError = true;
      }
    }

    return { stdout: "", stderr, exitCode: anyError ? 1 : 0 };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "alias",
  flags: [],
};

export const unaliasFlagsForFuzzing: CommandFuzzInfo = {
  name: "unalias",
  flags: [{ flag: "-a", type: "boolean" }],
};

/**
 * set - Set/unset shell options builtin
 */

import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

const SET_USAGE = `set: usage: set [-e] [+e] [-o option] [+o option]
Options:
  -e            Exit immediately if a command exits with non-zero status
  +e            Disable -e
  -o errexit    Same as -e
  +o errexit    Disable errexit
  -o pipefail   Return status of last failing command in pipeline
  +o pipefail   Disable pipefail
`;

// Valid short options for set
const VALID_SET_OPTIONS = new Set(["e"]);

// Valid long options for set -o / +o
const VALID_SET_LONG_OPTIONS = new Set(["errexit", "pipefail"]);

export function handleSet(ctx: InterpreterContext, args: string[]): ExecResult {
  if (args.includes("--help")) {
    return { stdout: SET_USAGE, stderr: "", exitCode: 0 };
  }

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-e") {
      ctx.state.options.errexit = true;
    } else if (arg === "+e") {
      ctx.state.options.errexit = false;
    } else if (arg === "-o" && i + 1 < args.length) {
      const optName = args[i + 1];
      if (!VALID_SET_LONG_OPTIONS.has(optName)) {
        return {
          stdout: "",
          stderr: `bash: set: ${optName}: invalid option name\n${SET_USAGE}`,
          exitCode: 1,
        };
      }
      if (optName === "errexit") {
        ctx.state.options.errexit = true;
      } else if (optName === "pipefail") {
        ctx.state.options.pipefail = true;
      }
      i++;
    } else if (arg === "+o" && i + 1 < args.length) {
      const optName = args[i + 1];
      if (!VALID_SET_LONG_OPTIONS.has(optName)) {
        return {
          stdout: "",
          stderr: `bash: set: ${optName}: invalid option name\n${SET_USAGE}`,
          exitCode: 1,
        };
      }
      if (optName === "errexit") {
        ctx.state.options.errexit = false;
      } else if (optName === "pipefail") {
        ctx.state.options.pipefail = false;
      }
      i++;
    } else if (arg === "-o" || arg === "+o") {
      // -o or +o without argument
      return {
        stdout: "",
        stderr: `bash: set: ${arg}: option requires an argument\n${SET_USAGE}`,
        exitCode: 1,
      };
    } else if (arg.startsWith("-") && arg.length > 1 && arg[1] !== "-") {
      // Handle combined flags like -ex
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];
        if (!VALID_SET_OPTIONS.has(flag)) {
          return {
            stdout: "",
            stderr: `bash: set: -${flag}: invalid option\n${SET_USAGE}`,
            exitCode: 1,
          };
        }
        if (flag === "e") {
          ctx.state.options.errexit = true;
        }
      }
    } else if (arg.startsWith("+") && arg.length > 1) {
      // Handle combined flags like +ex
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];
        if (!VALID_SET_OPTIONS.has(flag)) {
          return {
            stdout: "",
            stderr: `bash: set: +${flag}: invalid option\n${SET_USAGE}`,
            exitCode: 1,
          };
        }
        if (flag === "e") {
          ctx.state.options.errexit = false;
        }
      }
    } else if (arg === "--") {
      // End of options, rest are positional parameters (not implemented)
      break;
    } else if (arg.startsWith("-") || arg.startsWith("+")) {
      return {
        stdout: "",
        stderr: `bash: set: ${arg}: invalid option\n${SET_USAGE}`,
        exitCode: 1,
      };
    }
    // Other arguments are positional parameters (not implemented)

    i++;
  }

  return { stdout: "", stderr: "", exitCode: 0 };
}

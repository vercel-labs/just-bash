/**
 * set - Set/unset shell options builtin
 */

import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

const SET_USAGE = `set: usage: set [-eux] [+eux] [-o option] [+o option]
Options:
  -e            Exit immediately if a command exits with non-zero status
  +e            Disable -e
  -u            Treat unset variables as an error when substituting
  +u            Disable -u
  -x            Print commands and their arguments as they are executed
  +x            Disable -x
  -o errexit    Same as -e
  +o errexit    Disable errexit
  -o nounset    Same as -u
  +o nounset    Disable nounset
  -o pipefail   Return status of last failing command in pipeline
  +o pipefail   Disable pipefail
  -o xtrace     Same as -x
  +o xtrace     Disable xtrace
`;

// Valid short options for set
// Note: some options are no-ops but accepted for compatibility
const VALID_SET_OPTIONS = new Set([
  "e", // errexit
  "u", // nounset
  "x", // xtrace
  "f", // noglob (no-op)
  "v", // verbose (no-op)
  "h", // hashall (no-op)
  "C", // noclobber (no-op)
  "n", // noexec (no-op)
  "a", // allexport (no-op)
  "b", // notify (no-op)
  "m", // monitor (no-op)
  "B", // braceexpand (no-op)
  "H", // histexpand (no-op)
  "P", // physical (no-op)
  "T", // functrace (no-op)
  "E", // errtrace (no-op)
  "p", // privileged (no-op)
]);

// Valid long options for set -o / +o
// Note: many are no-ops but accepted for compatibility
const VALID_SET_LONG_OPTIONS = new Set([
  "errexit",
  "pipefail",
  "nounset",
  "xtrace",
  "noclobber",
  "noglob",
  "verbose",
  "noexec",
  "allexport",
  "notify",
  "monitor",
  "braceexpand",
  "histexpand",
  "physical",
  "functrace",
  "errtrace",
  "privileged",
  "hashall",
  "posix",
  "vi",
  "emacs",
  "ignoreeof",
  "interactive-comments",
  "keyword",
  "onecmd",
]);

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
    } else if (arg === "-u") {
      ctx.state.options.nounset = true;
    } else if (arg === "+u") {
      ctx.state.options.nounset = false;
    } else if (arg === "-x") {
      ctx.state.options.xtrace = true;
    } else if (arg === "+x") {
      ctx.state.options.xtrace = false;
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
      } else if (optName === "nounset") {
        ctx.state.options.nounset = true;
      } else if (optName === "xtrace") {
        ctx.state.options.xtrace = true;
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
      } else if (optName === "nounset") {
        ctx.state.options.nounset = false;
      } else if (optName === "xtrace") {
        ctx.state.options.xtrace = false;
      }
      i++;
    } else if (
      arg === "-o" &&
      (i + 1 >= args.length ||
        args[i + 1].startsWith("-") ||
        args[i + 1].startsWith("+"))
    ) {
      // set -o alone prints current option settings
      const options = ctx.state.options;
      const output = `${[
        `errexit         ${options.errexit ? "on" : "off"}`,
        `nounset         ${options.nounset ? "on" : "off"}`,
        `pipefail        ${options.pipefail ? "on" : "off"}`,
        `xtrace          ${options.xtrace ? "on" : "off"}`,
      ].join("\n")}\n`;
      return { stdout: output, stderr: "", exitCode: 0 };
    } else if (
      arg === "+o" &&
      (i + 1 >= args.length ||
        args[i + 1].startsWith("-") ||
        args[i + 1].startsWith("+"))
    ) {
      // set +o prints commands to recreate current settings
      const options = ctx.state.options;
      const output = `${[
        `set ${options.errexit ? "-o" : "+o"} errexit`,
        `set ${options.nounset ? "-o" : "+o"} nounset`,
        `set ${options.pipefail ? "-o" : "+o"} pipefail`,
        `set ${options.xtrace ? "-o" : "+o"} xtrace`,
      ].join("\n")}\n`;
      return { stdout: output, stderr: "", exitCode: 0 };
    } else if (arg.startsWith("-") && arg.length > 1 && arg[1] !== "-") {
      // Handle combined flags like -eu
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
        } else if (flag === "u") {
          ctx.state.options.nounset = true;
        } else if (flag === "x") {
          ctx.state.options.xtrace = true;
        }
      }
    } else if (arg.startsWith("+") && arg.length > 1) {
      // Handle combined flags like +eu
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
        } else if (flag === "u") {
          ctx.state.options.nounset = false;
        } else if (flag === "x") {
          ctx.state.options.xtrace = false;
        }
      }
    } else if (arg === "--") {
      // End of options, rest are positional parameters
      i++;
      setPositionalParameters(ctx, args.slice(i));
      return { stdout: "", stderr: "", exitCode: 0 };
    } else if (arg === "-") {
      // set - disables -x and -v (traditional behavior)
      ctx.state.options.xtrace = false;
      // Also marks end of options, rest are positional parameters
      if (i + 1 < args.length) {
        setPositionalParameters(ctx, args.slice(i + 1));
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    } else if (arg === "+") {
      // set + is just like set -- (end of options)
      if (i + 1 < args.length) {
        setPositionalParameters(ctx, args.slice(i + 1));
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    } else if (arg.startsWith("-") || arg.startsWith("+")) {
      return {
        stdout: "",
        stderr: `bash: set: ${arg}: invalid option\n${SET_USAGE}`,
        exitCode: 1,
      };
    } else {
      // Non-option arguments are positional parameters
      setPositionalParameters(ctx, args.slice(i));
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    i++;
  }

  return { stdout: "", stderr: "", exitCode: 0 };
}

/**
 * Set positional parameters ($1, $2, etc.) and update $@, $*, $#
 */
function setPositionalParameters(
  ctx: InterpreterContext,
  params: string[],
): void {
  // Clear existing positional parameters
  let i = 1;
  while (ctx.state.env[String(i)] !== undefined) {
    delete ctx.state.env[String(i)];
    i++;
  }

  // Set new positional parameters
  for (let j = 0; j < params.length; j++) {
    ctx.state.env[String(j + 1)] = params[j];
  }

  // Update $# (number of parameters)
  ctx.state.env["#"] = String(params.length);

  // Update $@ and $* (all parameters)
  ctx.state.env["@"] = params.join(" ");
  ctx.state.env["*"] = params.join(" ");
}

/**
 * shopt builtin - Shell options
 * Implements bash's shopt builtin for managing shell-specific options
 */

import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

// All supported shopt options
const SHOPT_OPTIONS = [
  "extglob",
  "dotglob",
  "nullglob",
  "failglob",
  "globstar",
  "nocaseglob",
  "nocasematch",
  "expand_aliases",
  "lastpipe",
] as const;

// Options that are recognized but not implemented (stubs that return current state)
const STUB_OPTIONS = [
  "autocd",
  "cdable_vars",
  "cdspell",
  "checkhash",
  "checkjobs",
  "checkwinsize",
  "cmdhist",
  "compat31",
  "compat32",
  "compat40",
  "compat41",
  "compat42",
  "compat43",
  "compat44",
  "complete_fullquote",
  "direxpand",
  "dirspell",
  "execfail",
  "extdebug",
  "extquote",
  "force_fignore",
  "globasciiranges",
  "gnu_errfmt",
  "histappend",
  "histreedit",
  "histverify",
  "hostcomplete",
  "huponexit",
  "inherit_errexit",
  "interactive_comments",
  "lithist",
  "localvar_inherit",
  "localvar_unset",
  "login_shell",
  "mailwarn",
  "no_empty_cmd_completion",
  "nocaseglob",
  "progcomp",
  "progcomp_alias",
  "promptvars",
  "restricted_shell",
  "shift_verbose",
  "sourcepath",
  "xpg_echo",
] as const;

type ShoptOption = (typeof SHOPT_OPTIONS)[number];

function isShoptOption(opt: string): opt is ShoptOption {
  return SHOPT_OPTIONS.includes(opt as ShoptOption);
}

function isStubOption(opt: string): boolean {
  return STUB_OPTIONS.includes(opt as (typeof STUB_OPTIONS)[number]);
}

export function handleShopt(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  // Parse arguments
  let setFlag = false; // -s: set option
  let unsetFlag = false; // -u: unset option
  let printFlag = false; // -p: print in reusable form
  let quietFlag = false; // -q: suppress output, only set exit code
  let oFlag = false; // -o: use set -o option names
  const optionNames: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--") {
      i++;
      break;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];
        switch (flag) {
          case "s":
            setFlag = true;
            break;
          case "u":
            unsetFlag = true;
            break;
          case "p":
            printFlag = true;
            break;
          case "q":
            quietFlag = true;
            break;
          case "o":
            oFlag = true;
            break;
          default:
            return {
              exitCode: 2,
              stdout: "",
              stderr: `shopt: -${flag}: invalid option\n`,
            };
        }
      }
      i++;
    } else {
      break;
    }
  }

  // Remaining args are option names
  while (i < args.length) {
    optionNames.push(args[i]);
    i++;
  }

  // -o flag: use set -o option names instead of shopt options
  if (oFlag) {
    return handleSetOptions(
      ctx,
      optionNames,
      setFlag,
      unsetFlag,
      printFlag,
      quietFlag,
    );
  }

  // If -s and -u are both set, that's an error
  if (setFlag && unsetFlag) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "shopt: cannot set and unset shell options simultaneously\n",
    };
  }

  // No option names: print all options
  if (optionNames.length === 0) {
    if (setFlag || unsetFlag) {
      // -s or -u without option names: print options with that state
      const output: string[] = [];
      for (const opt of SHOPT_OPTIONS) {
        const value = ctx.state.shoptOptions[opt];
        if (setFlag && value) {
          output.push(printFlag ? `shopt -s ${opt}` : `${opt}\t\ton`);
        } else if (unsetFlag && !value) {
          output.push(printFlag ? `shopt -u ${opt}` : `${opt}\t\toff`);
        }
      }
      return {
        exitCode: 0,
        stdout: output.length > 0 ? `${output.join("\n")}\n` : "",
        stderr: "",
      };
    }
    // No flags: print all options
    const output: string[] = [];
    for (const opt of SHOPT_OPTIONS) {
      const value = ctx.state.shoptOptions[opt];
      output.push(
        printFlag
          ? `shopt ${value ? "-s" : "-u"} ${opt}`
          : `${opt}\t\t${value ? "on" : "off"}`,
      );
    }
    return {
      exitCode: 0,
      stdout: `${output.join("\n")}\n`,
      stderr: "",
    };
  }

  // Option names provided
  let hasError = false;
  let stderr = "";
  const output: string[] = [];

  for (const name of optionNames) {
    if (!isShoptOption(name) && !isStubOption(name)) {
      stderr += `shopt: ${name}: invalid shell option name\n`;
      hasError = true;
      continue;
    }

    if (setFlag) {
      // Set the option
      if (isShoptOption(name)) {
        ctx.state.shoptOptions[name] = true;
      }
      // Stub options are silently accepted
    } else if (unsetFlag) {
      // Unset the option
      if (isShoptOption(name)) {
        ctx.state.shoptOptions[name] = false;
      }
      // Stub options are silently accepted
    } else {
      // Query the option
      if (isShoptOption(name)) {
        const value = ctx.state.shoptOptions[name];
        if (quietFlag) {
          if (!value) {
            hasError = true;
          }
        } else if (printFlag) {
          output.push(`shopt ${value ? "-s" : "-u"} ${name}`);
        } else {
          output.push(`${name}\t\t${value ? "on" : "off"}`);
        }
      } else {
        // Stub options report as off
        if (quietFlag) {
          hasError = true;
        } else if (printFlag) {
          output.push(`shopt -u ${name}`);
        } else {
          output.push(`${name}\t\toff`);
        }
      }
    }
  }

  return {
    exitCode: hasError ? 1 : 0,
    stdout: output.length > 0 ? `${output.join("\n")}\n` : "",
    stderr,
  };
}

/**
 * Handle -o flag: use set -o option names
 */
function handleSetOptions(
  ctx: InterpreterContext,
  optionNames: string[],
  setFlag: boolean,
  unsetFlag: boolean,
  printFlag: boolean,
  quietFlag: boolean,
): ExecResult {
  // Map set -o option names to ShellOptions
  const SET_OPTIONS: Record<string, keyof typeof ctx.state.options> = {
    errexit: "errexit",
    pipefail: "pipefail",
    nounset: "nounset",
    xtrace: "xtrace",
    verbose: "verbose",
    posix: "posix",
    allexport: "allexport",
    noclobber: "noclobber",
    noglob: "noglob",
  };

  const ALL_SET_OPTIONS = Object.keys(SET_OPTIONS);

  if (optionNames.length === 0) {
    // Print all set -o options
    const output: string[] = [];
    for (const opt of ALL_SET_OPTIONS) {
      const value = ctx.state.options[SET_OPTIONS[opt]];
      if (setFlag && !value) continue;
      if (unsetFlag && value) continue;
      output.push(
        printFlag
          ? `set ${value ? "-o" : "+o"} ${opt}`
          : `${opt}\t\t${value ? "on" : "off"}`,
      );
    }
    return {
      exitCode: 0,
      stdout: output.length > 0 ? `${output.join("\n")}\n` : "",
      stderr: "",
    };
  }

  let hasError = false;
  let stderr = "";
  const output: string[] = [];

  for (const name of optionNames) {
    if (!(name in SET_OPTIONS)) {
      stderr += `shopt: ${name}: invalid option name\n`;
      hasError = true;
      continue;
    }

    const key = SET_OPTIONS[name];

    if (setFlag) {
      ctx.state.options[key] = true;
    } else if (unsetFlag) {
      ctx.state.options[key] = false;
    } else {
      const value = ctx.state.options[key];
      if (quietFlag) {
        if (!value) {
          hasError = true;
        }
      } else if (printFlag) {
        output.push(`set ${value ? "-o" : "+o"} ${name}`);
      } else {
        output.push(`${name}\t\t${value ? "on" : "off"}`);
      }
    }
  }

  return {
    exitCode: hasError ? 1 : 0,
    stdout: output.length > 0 ? `${output.join("\n")}\n` : "",
    stderr,
  };
}

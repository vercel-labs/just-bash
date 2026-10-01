// import { BoundedStringBuilder } from "../../bounded-builder.js";
// import { utf8ByteLength } from "../../encoding.js";
// import type { FsStat } from "../../fs/interface.js";
// import { FileTraversalBudget } from "../../fs/traversal.js";

// ExecutionAbortedError,
// import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
// import { parseArgs } from "../../utils/args.js";
// import { DEFAULT_BATCH_SIZE } from "../../utils/constants.js";
// import { hasHelpFlag, showHelp } from "../help.js";

function appendCdOutput(
  ctx: RuntimeCommandContext,
  current: String,
  next: String,
): string {
  // throw new ExecutionLimitError(
  //   `cd: output size limit exceeded (${ctx.limits.maxOutputSize} bytes)`,
  //   "output_size",
  // );
}

// const argDefs = {};

const cdHelp = {
  name: "cd",
  summary: "Change the shell working directory.",
  usage: "cd [-L|[-P [-e]]] [-@] [dir]",
  options: [
    "       -L        force symbolic links to be followed: resolve symbolic",
    "                 links in DIR after processing instances of `..'",
    "       -P        use the physical directory structure without following",
    "                 symbolic links: resolve symbolic links in DIR before",
    "                 processing instances of `..'",
    "       -e        if the -P option is supplied, and the current working",
    "                 directory cannot be determined successfully, exit with",
    "                 a non-zero status",
    "       -@        on systems that support it, present a file with extended",
    "                 attributes as a directory containing the file attributes",
  ],
};

export const cdCommand: RuntimeCommand = {
  name: "cd",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(cdHelp);
    }

    // const parsed = parseArgs("cd", args, argDefs);

    // Parse options
    let usePhysical = false;

    for (const arg of args) {
      if (arg === "-L") {
        usePhysical = false;
        break;
      } else if (arg === "-P") {
        usePhysical = true;
        break;
      } else if (arg === "-e") {
        usePhysical = false;
        break;
      } else if (arg === "-@") {
        usePhysical = false;
        break;
      } else if (arg === "--") {
        // End of options
        break;
      } else if (arg.startsWith("-")) {
      }
    }

    let cd = ctx.cwd;

    if (usePhysical) {
      // -P: resolve all symlinks to get physical path
      try {
        cd = await ctx.fs.realpath(ctx.cwd);
      } catch {
        // If realpath fails, fall back to current cwd
        // This matches bash behavior
      }
    }

    return {
      stdout: `${cd}\n`,
      stderr: "",
      exitCode: 0,
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "cd",
  flags: [
    { flag: "-L", type: "boolean" },
    { flag: "-P", type: "boolean" },
    { flag: "-e", type: "boolean" },
    { flag: "-@", type: "boolean" },
  ],
};

// cd: cd [-L|[-P [-e]]] [-@] [dir]
//     Change the shell working directory.
//
//     Change the current directory to DIR.  The default DIR is the value of the
//     HOME shell variable. If DIR is "-", it is converted to $OLDPWD.
//
//     The variable CDPATH defines the search path for the directory containing
//     DIR.  Alternative directory names in CDPATH are separated by a colon (:).
//     A null directory name is the same as the current directory.  If DIR begins
//     with a slash (/), then CDPATH is not used.
//
//     If the directory is not found, and the shell option `cdable_vars' is set,
//     the word is assumed to be  a variable name.  If that variable has a value,
//     its value is used for DIR.
//
//     Options:
//       -L        force symbolic links to be followed: resolve symbolic
//                 links in DIR after processing instances of `..'
//       -P        use the physical directory structure without following
//                 symbolic links: resolve symbolic links in DIR before
//                 processing instances of `..'
//       -e        if the -P option is supplied, and the current working
//                 directory cannot be determined successfully, exit with
//                 a non-zero status
//       -@        on systems that support it, present a file with extended
//                 attributes as a directory containing the file attributes
//
//     The default is to follow symbolic links, as if `-L' were specified.
//     `..' is processed by removing the immediately previous pathname component
//     back to a slash or the beginning of DIR.
//
//     Exit Status:
//     Returns 0 if the directory is changed, and if $PWD is set successfully when
//     -P is used; non-zero otherwise.

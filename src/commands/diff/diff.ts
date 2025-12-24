/**
 * diff - Compare files line by line
 */

import * as Diff from "diff";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const diffHelp = {
  name: "diff",
  summary: "compare files line by line",
  usage: "diff [OPTION]... FILE1 FILE2",
  options: [
    "-u, --unified     output unified diff format (default)",
    "-q, --brief       report only whether files differ",
    "-s, --report-identical-files  report when files are the same",
    "-i, --ignore-case  ignore case differences",
    "    --help        display this help and exit",
  ],
};

export const diffCommand: Command = {
  name: "diff",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) return showHelp(diffHelp);

    let brief = false,
      reportSame = false,
      ignoreCase = false;
    const files: string[] = [];

    for (const arg of args) {
      if (arg === "-u" || arg === "--unified") {
        /* default */
      } else if (arg === "-q" || arg === "--brief") brief = true;
      else if (arg === "-s" || arg === "--report-identical-files")
        reportSame = true;
      else if (arg === "-i" || arg === "--ignore-case") ignoreCase = true;
      else if (arg === "-") files.push("-");
      else if (arg.startsWith("--")) return unknownOption("diff", arg);
      else if (arg.startsWith("-")) {
        for (const c of arg.slice(1)) {
          if (c === "u") {
            /* default */
          } else if (c === "q") brief = true;
          else if (c === "s") reportSame = true;
          else if (c === "i") ignoreCase = true;
          else return unknownOption("diff", `-${c}`);
        }
      } else files.push(arg);
    }

    if (files.length < 2) {
      return { stdout: "", stderr: "diff: missing operand\n", exitCode: 2 };
    }

    let c1: string, c2: string;
    const [f1, f2] = files;

    try {
      c1 =
        f1 === "-"
          ? ctx.stdin
          : await ctx.fs.readFile(ctx.fs.resolvePath(ctx.cwd, f1));
    } catch {
      return {
        stdout: "",
        stderr: `diff: ${f1}: No such file or directory\n`,
        exitCode: 2,
      };
    }

    try {
      c2 =
        f2 === "-"
          ? ctx.stdin
          : await ctx.fs.readFile(ctx.fs.resolvePath(ctx.cwd, f2));
    } catch {
      return {
        stdout: "",
        stderr: `diff: ${f2}: No such file or directory\n`,
        exitCode: 2,
      };
    }

    let t1 = c1,
      t2 = c2;
    if (ignoreCase) {
      t1 = t1.toLowerCase();
      t2 = t2.toLowerCase();
    }

    if (t1 === t2) {
      if (reportSame)
        return {
          stdout: `Files ${f1} and ${f2} are identical\n`,
          stderr: "",
          exitCode: 0,
        };
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    if (brief) {
      return {
        stdout: `Files ${f1} and ${f2} differ\n`,
        stderr: "",
        exitCode: 1,
      };
    }

    const output = Diff.createTwoFilesPatch(f1, f2, c1, c2, "", "", {
      context: 3,
    });
    return { stdout: output, stderr: "", exitCode: 1 };
  },
};

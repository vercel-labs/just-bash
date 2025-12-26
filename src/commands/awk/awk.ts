import { escapeRegex } from "../../interpreter/helpers/regex.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { executeAwkAction, matchesPattern } from "./executor.js";
import { parseAwkProgram } from "./parser.js";
import type { AwkContext } from "./types.js";

const awkHelp = {
  name: "awk",
  summary: "pattern scanning and text processing language",
  usage: "awk [OPTIONS] 'PROGRAM' [FILE...]",
  options: [
    "-F FS      use FS as field separator",
    "-v VAR=VAL assign VAL to variable VAR",
    "    --help display this help and exit",
  ],
};

export const awkCommand: Command = {
  name: "awk",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(awkHelp);
    }

    let fieldSep = /\s+/;
    let fieldSepStr = " ";
    const vars: Record<string, string | number> = {};
    let programIdx = 0;

    // Parse options
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-F" && i + 1 < args.length) {
        fieldSepStr = processEscapes(args[++i]);
        fieldSep = new RegExp(escapeRegex(fieldSepStr));
        programIdx = i + 1;
      } else if (arg.startsWith("-F")) {
        fieldSepStr = processEscapes(arg.slice(2));
        fieldSep = new RegExp(escapeRegex(fieldSepStr));
        programIdx = i + 1;
      } else if (arg === "-v" && i + 1 < args.length) {
        const assignment = args[++i];
        const eqIdx = assignment.indexOf("=");
        if (eqIdx > 0) {
          const varName = assignment.slice(0, eqIdx);
          const varValue = assignment.slice(eqIdx + 1);
          vars[varName] = varValue;
        }
        programIdx = i + 1;
      } else if (arg.startsWith("--")) {
        return unknownOption("awk", arg);
      } else if (arg.startsWith("-") && arg.length > 1) {
        // Check for unknown short options (F and v require args)
        const optChar = arg[1];
        if (optChar !== "F" && optChar !== "v") {
          return unknownOption("awk", `-${optChar}`);
        }
        programIdx = i + 1;
      } else if (!arg.startsWith("-")) {
        programIdx = i;
        break;
      }
    }

    if (programIdx >= args.length) {
      return { stdout: "", stderr: "awk: missing program\n", exitCode: 1 };
    }

    const program = args[programIdx];
    const files = args.slice(programIdx + 1);

    // Get input
    let input: string;
    if (files.length > 0) {
      const contents: string[] = [];
      for (const file of files) {
        try {
          const filePath = ctx.fs.resolvePath(ctx.cwd, file);
          contents.push(await ctx.fs.readFile(filePath));
        } catch {
          return {
            stdout: "",
            stderr: `awk: ${file}: No such file or directory\n`,
            exitCode: 1,
          };
        }
      }
      input = contents.join("");
    } else {
      input = ctx.stdin;
    }

    // Parse program
    const { begin, main, end } = parseAwkProgram(program);

    // Execute
    const awkCtx: AwkContext = {
      FS: fieldSepStr,
      OFS: " ",
      NR: 0,
      NF: 0,
      fields: [],
      line: "",
      vars,
      arrays: {},
      fieldSep,
    };

    let stdout = "";

    // BEGIN block
    if (begin) {
      stdout += executeAwkAction(begin, awkCtx);
    }

    // Process lines
    const lines = input.split("\n");
    // Remove trailing empty line if input ends with newline
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    // Track range state for each rule with a range pattern
    const rangeActive: boolean[] = main.map(() => false);

    // Make lines available in context for getline
    awkCtx.lines = lines;

    awkCtx.lineIndex = -1; // Will be incremented to 0 at start

    while (awkCtx.lineIndex < lines.length - 1) {
      awkCtx.lineIndex++;
      const line = lines[awkCtx.lineIndex];
      awkCtx.NR++;
      awkCtx.line = line;
      awkCtx.fields = line.split(fieldSep);
      awkCtx.NF = awkCtx.fields.length;

      for (let ruleIdx = 0; ruleIdx < main.length; ruleIdx++) {
        const rule = main[ruleIdx];

        // Handle range patterns
        if (rule.range) {
          const startRegex = new RegExp(rule.range.start);
          const endRegex = new RegExp(rule.range.end);

          if (!rangeActive[ruleIdx]) {
            // Not in range - check if we match the start
            if (startRegex.test(line)) {
              rangeActive[ruleIdx] = true;
              stdout += executeAwkAction(rule.action, awkCtx);
              // Check if end also matches (single line range)
              if (endRegex.test(line)) {
                rangeActive[ruleIdx] = false;
              }
            }
          } else {
            // In range - execute action
            stdout += executeAwkAction(rule.action, awkCtx);
            // Check if we match the end
            if (endRegex.test(line)) {
              rangeActive[ruleIdx] = false;
            }
          }
        } else if (matchesPattern(rule.pattern, awkCtx)) {
          stdout += executeAwkAction(rule.action, awkCtx);
        }
      }
    }

    // END block
    if (end) {
      stdout += executeAwkAction(end, awkCtx);
    }

    return { stdout, stderr: "", exitCode: 0 };
  },
};

function processEscapes(str: string): string {
  return str
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\");
}

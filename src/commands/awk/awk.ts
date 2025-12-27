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
        // Support regex field separators - don't escape if it looks like a regex
        fieldSep = createFieldSepRegex(fieldSepStr);
        programIdx = i + 1;
      } else if (arg.startsWith("-F")) {
        fieldSepStr = processEscapes(arg.slice(2));
        fieldSep = createFieldSepRegex(fieldSepStr);
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

    // Parse program first to extract functions
    const { begin, main, end, functions } = parseAwkProgram(program);

    // Execute
    const awkCtx: AwkContext = {
      FS: fieldSepStr,
      OFS: " ",
      NR: 0,
      NF: 0,
      FNR: 0,
      FILENAME: "",
      RSTART: 0,
      RLENGTH: -1,
      fields: [],
      line: "",
      vars,
      arrays: {},
      functions: functions || {},
      fieldSep,
      maxIterations: ctx.limits?.maxAwkIterations,
    };

    let stdout = "";

    // BEGIN block
    if (begin) {
      stdout += executeAwkAction(begin, awkCtx);
      if (awkCtx.shouldExit) {
        return { stdout, stderr: "", exitCode: awkCtx.exitCode || 0 };
      }
    }

    // Collect all file contents with metadata
    interface FileData {
      filename: string;
      lines: string[];
    }
    const fileDataList: FileData[] = [];

    if (files.length > 0) {
      for (const file of files) {
        try {
          const filePath = ctx.fs.resolvePath(ctx.cwd, file);
          const content = await ctx.fs.readFile(filePath);
          const lines = content.split("\n");
          // Remove trailing empty line if content ends with newline
          if (lines.length > 0 && lines[lines.length - 1] === "") {
            lines.pop();
          }
          fileDataList.push({ filename: file, lines });
        } catch {
          return {
            stdout: "",
            stderr: `awk: ${file}: No such file or directory\n`,
            exitCode: 1,
          };
        }
      }
    } else {
      const lines = ctx.stdin.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      fileDataList.push({ filename: "", lines });
    }

    // Track range state for each rule with a range pattern
    const rangeActive: boolean[] = main.map(() => false);

    // Process each file
    for (const fileData of fileDataList) {
      awkCtx.FILENAME = fileData.filename;
      awkCtx.FNR = 0;

      // Make lines available in context for getline
      awkCtx.lines = fileData.lines;
      awkCtx.lineIndex = -1;

      while (awkCtx.lineIndex < fileData.lines.length - 1) {
        awkCtx.lineIndex++;
        const line = fileData.lines[awkCtx.lineIndex];
        awkCtx.NR++;
        awkCtx.FNR++;
        awkCtx.line = line;
        awkCtx.fields = line.split(fieldSep);
        awkCtx.NF = awkCtx.fields.length;

        // Reset next flag for this line
        awkCtx.shouldNext = false;

        for (let ruleIdx = 0; ruleIdx < main.length; ruleIdx++) {
          // Check for exit
          if (awkCtx.shouldExit) break;
          // Check for next (skip remaining rules for this line)
          if (awkCtx.shouldNext) break;

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

        // Check for exit after processing line
        if (awkCtx.shouldExit) break;
      }

      // Check for exit after processing file
      if (awkCtx.shouldExit) break;
    }

    // END block (runs even after exit, unless exit was in BEGIN)
    if (end && !awkCtx.shouldExit) {
      stdout += executeAwkAction(end, awkCtx);
    }

    return { stdout, stderr: "", exitCode: awkCtx.exitCode || 0 };
  },
};

function processEscapes(str: string): string {
  return str
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\");
}

// Create a regex for field separator
// Support both literal strings and regex patterns
function createFieldSepRegex(sep: string): RegExp {
  // Special case: single space means split on runs of whitespace
  if (sep === " ") {
    return /\s+/;
  }

  // Check if it looks like a regex pattern (contains regex metacharacters)
  const regexMetachars = /[[\](){}.*+?^$|\\]/;
  if (regexMetachars.test(sep)) {
    try {
      return new RegExp(sep);
    } catch {
      // Fall back to literal if invalid regex
      return new RegExp(escapeForRegex(sep));
    }
  }

  // Literal string - escape special regex characters
  return new RegExp(escapeForRegex(sep));
}

function escapeForRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

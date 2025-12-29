/**
 * AWK Command - New AST-based Implementation
 *
 * This is the new implementation using proper lexer/parser/interpreter architecture.
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import type { AwkProgram } from "./ast.js";
import { AwkInterpreter, createRuntimeContext } from "./interpreter2.js";
import { AwkParser } from "./parser2.js";

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

export const awkCommand2: Command = {
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

    // Parse program
    const parser = new AwkParser();
    let ast: AwkProgram;
    try {
      ast = parser.parse(program);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { stdout: "", stderr: `awk: ${msg}\n`, exitCode: 1 };
    }

    // Create runtime context
    const runtimeCtx = createRuntimeContext(
      fieldSep,
      ctx.limits?.maxAwkIterations,
    );
    runtimeCtx.FS = fieldSepStr;
    runtimeCtx.vars = { ...vars };

    // Create interpreter
    const interp = new AwkInterpreter(runtimeCtx);
    interp.execute(ast);

    // Execute BEGIN blocks
    interp.executeBegin();
    if (runtimeCtx.shouldExit) {
      return {
        stdout: interp.getOutput(),
        stderr: "",
        exitCode: interp.getExitCode(),
      };
    }

    // Collect file contents
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

    // Process each file
    for (const fileData of fileDataList) {
      runtimeCtx.FILENAME = fileData.filename;
      runtimeCtx.FNR = 0;
      runtimeCtx.lines = fileData.lines;
      runtimeCtx.lineIndex = -1;

      // Use while loop with lineIndex to support getline advancing the line
      while (runtimeCtx.lineIndex < fileData.lines.length - 1) {
        runtimeCtx.lineIndex++;
        interp.executeLine(fileData.lines[runtimeCtx.lineIndex]);
        if (runtimeCtx.shouldExit) break;
      }

      if (runtimeCtx.shouldExit) break;
    }

    // Execute END blocks
    if (!runtimeCtx.shouldExit) {
      interp.executeEnd();
    }

    return {
      stdout: interp.getOutput(),
      stderr: "",
      exitCode: interp.getExitCode(),
    };
  },
};

function processEscapes(str: string): string {
  return str
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\");
}

function createFieldSepRegex(sep: string): RegExp {
  if (sep === " ") {
    return /\s+/;
  }

  const regexMetachars = /[[\](){}.*+?^$|\\]/;
  if (regexMetachars.test(sep)) {
    try {
      return new RegExp(sep);
    } catch {
      return new RegExp(escapeForRegex(sep));
    }
  }

  return new RegExp(escapeForRegex(sep));
}

function escapeForRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

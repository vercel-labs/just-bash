import type { ExecutionLimits } from "../../limits.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import {
  createInitialState,
  type ExecuteContext,
  executeCommands,
} from "./executor.js";
import { parseMultipleScripts } from "./parser.js";
import type { SedCommand, SedExecutionLimits, SedState } from "./types.js";

const sedHelp = {
  name: "sed",
  summary: "stream editor for filtering and transforming text",
  usage: "sed [OPTION]... {script} [input-file]...",
  options: [
    "-n, --quiet, --silent  suppress automatic printing of pattern space",
    "-e script              add the script to commands to be executed",
    "-f script-file         read script from file",
    "-i, --in-place         edit files in place",
    "-E, -r, --regexp-extended  use extended regular expressions",
    "    --help             display this help and exit",
  ],
  description: `Commands:
  s/regexp/replacement/[flags]  substitute
  d                             delete pattern space
  p                             print pattern space
  a\\ text                       append text after line
  i\\ text                       insert text before line
  c\\ text                       change (replace) line with text
  h                             copy pattern space to hold space
  H                             append pattern space to hold space
  g                             copy hold space to pattern space
  G                             append hold space to pattern space
  x                             exchange pattern and hold spaces
  n                             read next line into pattern space
  N                             append next line to pattern space
  y/source/dest/                transliterate characters
  =                             print line number
  b [label]                     branch to label
  t [label]                     branch on substitution
  :label                        define label
  q                             quit

Addresses:
  N                             line number
  $                             last line
  /regexp/                      lines matching regexp
  N,M                           range from line N to M`,
};

function processContent(
  content: string,
  commands: SedCommand[],
  silent: boolean,
  limits?: Required<ExecutionLimits>,
): string {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const totalLines = lines.length;
  let output = "";

  // Persistent hold space across all lines
  let holdSpace = "";
  let _substitutionMade = false;

  // Convert to SedExecutionLimits format
  const sedLimits: SedExecutionLimits | undefined = limits
    ? { maxIterations: limits.maxSedIterations }
    : undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const state: SedState = {
      ...createInitialState(totalLines),
      patternSpace: lines[lineIndex],
      holdSpace: holdSpace,
      lineNumber: lineIndex + 1,
      totalLines,
      substitutionMade: false, // Reset for each new line (T command behavior)
    };

    // Create execution context for N command
    const ctx: ExecuteContext = {
      lines,
      currentLineIndex: lineIndex,
    };

    // Execute commands with support for D command cycle restart
    let cycleIterations = 0;
    const maxCycleIterations = 10000;
    let totalLinesConsumed = 0;
    do {
      cycleIterations++;
      if (cycleIterations > maxCycleIterations) {
        // Prevent infinite loops
        break;
      }

      state.restartCycle = false;
      const linesConsumed = executeCommands(commands, state, ctx, sedLimits);
      totalLinesConsumed += linesConsumed;

      // Update context for next iteration (so N command reads from correct position)
      ctx.currentLineIndex += linesConsumed;
    } while (state.restartCycle && !state.deleted && !state.quit);

    // Update main line index with total lines consumed
    lineIndex += totalLinesConsumed;

    // Preserve state for next line
    holdSpace = state.holdSpace;
    _substitutionMade = state.substitutionMade;

    // Output line numbers from = command
    for (const ln of state.lineNumberOutput) {
      output += `${ln}\n`;
    }

    // Handle insert commands (marked with __INSERT__ prefix)
    const inserts: string[] = [];
    const appends: string[] = [];
    for (const item of state.appendBuffer) {
      if (item.startsWith("__INSERT__")) {
        inserts.push(item.slice(10));
      } else {
        appends.push(item);
      }
    }

    // Output inserts before the line
    for (const text of inserts) {
      output += `${text}\n`;
    }

    // Handle output
    if (!state.deleted) {
      if (silent) {
        if (state.printed) {
          output += `${state.patternSpace}\n`;
        }
      } else {
        output += `${state.patternSpace}\n`;
      }
    }

    // Output appends after the line
    for (const text of appends) {
      output += `${text}\n`;
    }

    // Check for quit command
    if (state.quit) {
      break;
    }
  }

  return output;
}

export const sedCommand: Command = {
  name: "sed",
  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(sedHelp);
    }

    const scripts: string[] = [];
    const scriptFiles: string[] = [];
    let silent = false;
    let inPlace = false;
    let _extendedRegex = false;
    const files: string[] = [];

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-n" || arg === "--quiet" || arg === "--silent") {
        silent = true;
      } else if (arg === "-i" || arg === "--in-place") {
        inPlace = true;
      } else if (arg.startsWith("-i")) {
        inPlace = true;
      } else if (arg === "-E" || arg === "-r" || arg === "--regexp-extended") {
        _extendedRegex = true;
      } else if (arg === "-e") {
        if (i + 1 < args.length) {
          scripts.push(args[++i]);
        }
      } else if (arg === "-f") {
        if (i + 1 < args.length) {
          scriptFiles.push(args[++i]);
        }
      } else if (arg.startsWith("--")) {
        return unknownOption("sed", arg);
      } else if (arg.startsWith("-") && arg.length > 1) {
        for (const c of arg.slice(1)) {
          if (
            c !== "n" &&
            c !== "e" &&
            c !== "f" &&
            c !== "i" &&
            c !== "E" &&
            c !== "r"
          ) {
            return unknownOption("sed", `-${c}`);
          }
        }
        if (arg.includes("n")) silent = true;
        if (arg.includes("i")) inPlace = true;
        if (arg.includes("E") || arg.includes("r")) _extendedRegex = true;
        if (arg.includes("e") && !arg.includes("n") && !arg.includes("i")) {
          if (i + 1 < args.length) {
            scripts.push(args[++i]);
          }
        }
        if (arg.includes("f") && !arg.includes("e")) {
          if (i + 1 < args.length) {
            scriptFiles.push(args[++i]);
          }
        }
      } else if (
        !arg.startsWith("-") &&
        scripts.length === 0 &&
        scriptFiles.length === 0
      ) {
        scripts.push(arg);
      } else if (!arg.startsWith("-")) {
        files.push(arg);
      }
    }

    // Read scripts from -f files
    for (const scriptFile of scriptFiles) {
      const scriptPath = ctx.fs.resolvePath(ctx.cwd, scriptFile);
      try {
        const scriptContent = await ctx.fs.readFile(scriptPath);
        // Split by newlines and add each line as a separate script
        for (const line of scriptContent.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            scripts.push(trimmed);
          }
        }
      } catch {
        return {
          stdout: "",
          stderr: `sed: couldn't open file ${scriptFile}: No such file or directory\n`,
          exitCode: 1,
        };
      }
    }

    if (scripts.length === 0) {
      return {
        stdout: "",
        stderr: "sed: no script specified\n",
        exitCode: 1,
      };
    }

    // Parse all scripts
    const { commands, error } = parseMultipleScripts(scripts, _extendedRegex);
    if (error) {
      return {
        stdout: "",
        stderr: `sed: ${error}\n`,
        exitCode: 1,
      };
    }

    if (commands.length === 0) {
      return {
        stdout: "",
        stderr: "sed: no valid commands\n",
        exitCode: 1,
      };
    }

    let content = "";

    // Read from files or stdin
    if (files.length === 0) {
      content = ctx.stdin;
      const output = processContent(content, commands, silent, ctx.limits);
      return { stdout: output, stderr: "", exitCode: 0 };
    }

    // Handle in-place editing
    if (inPlace) {
      for (const file of files) {
        const filePath = ctx.fs.resolvePath(ctx.cwd, file);
        try {
          const fileContent = await ctx.fs.readFile(filePath);
          const output = processContent(
            fileContent,
            commands,
            silent,
            ctx.limits,
          );
          await ctx.fs.writeFile(filePath, output);
        } catch {
          return {
            stdout: "",
            stderr: `sed: ${file}: No such file or directory\n`,
            exitCode: 1,
          };
        }
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Read all files and process
    for (const file of files) {
      const filePath = ctx.fs.resolvePath(ctx.cwd, file);
      try {
        content += await ctx.fs.readFile(filePath);
      } catch {
        return {
          stdout: "",
          stderr: `sed: ${file}: No such file or directory\n`,
          exitCode: 1,
        };
      }
    }

    const output = processContent(content, commands, silent, ctx.limits);
    return { stdout: output, stderr: "", exitCode: 0 };
  },
};

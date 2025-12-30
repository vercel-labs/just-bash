import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { ExecutionLimits } from "../../limits.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import {
  createInitialState,
  type ExecuteContext,
  executeCommands,
} from "./executor.js";
import { parseMultipleScripts } from "./parser.js";
import type {
  RangeState,
  SedCommand,
  SedExecutionLimits,
  SedState,
} from "./types.js";

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
  l                             list pattern space (escape special chars)
  b [label]                     branch to label
  t [label]                     branch on substitution
  T [label]                     branch if no substitution
  :label                        define label
  q                             quit
  Q                             quit without printing

Addresses:
  N                             line number
  $                             last line
  /regexp/                      lines matching regexp
  N,M                           range from line N to M
  first~step                    every step-th line starting at first`,
};

interface ProcessContentOptions {
  limits?: Required<ExecutionLimits>;
  filename?: string;
  fs?: CommandContext["fs"];
  cwd?: string;
}

async function processContent(
  content: string,
  commands: SedCommand[],
  silent: boolean,
  options: ProcessContentOptions = {},
): Promise<{ output: string; exitCode?: number }> {
  const { limits, filename, fs, cwd } = options;

  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const totalLines = lines.length;
  let output = "";
  let exitCode: number | undefined;

  // Persistent state across all lines
  let holdSpace = "";
  const rangeStates = new Map<string, RangeState>();

  // For file I/O: track line positions for R command, accumulate writes
  const fileLineCache = new Map<string, string[]>();
  const fileLinePositions = new Map<string, number>();
  const fileWrites = new Map<string, string>();

  // Convert to SedExecutionLimits format
  const sedLimits: SedExecutionLimits | undefined = limits
    ? { maxIterations: limits.maxSedIterations }
    : undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const state: SedState = {
      ...createInitialState(totalLines, filename, rangeStates),
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
      state.pendingFileReads = [];
      state.pendingFileWrites = [];

      const linesConsumed = executeCommands(commands, state, ctx, sedLimits);
      totalLinesConsumed += linesConsumed;

      // Process pending file reads
      if (fs && cwd) {
        for (const read of state.pendingFileReads) {
          const filePath = fs.resolvePath(cwd, read.filename);
          try {
            if (read.wholeFile) {
              // r command - read entire file, append after current line
              const fileContent = await fs.readFile(filePath);
              state.appendBuffer.push(fileContent.replace(/\n$/, ""));
            } else {
              // R command - read one line from file
              if (!fileLineCache.has(filePath)) {
                const fileContent = await fs.readFile(filePath);
                fileLineCache.set(filePath, fileContent.split("\n"));
                fileLinePositions.set(filePath, 0);
              }
              const fileLines = fileLineCache.get(filePath);
              const pos = fileLinePositions.get(filePath);
              if (fileLines && pos !== undefined && pos < fileLines.length) {
                state.appendBuffer.push(fileLines[pos]);
                fileLinePositions.set(filePath, pos + 1);
              }
            }
          } catch {
            // File not found - silently ignore (matches GNU sed behavior)
          }
        }

        // Accumulate file writes
        for (const write of state.pendingFileWrites) {
          const filePath = fs.resolvePath(cwd, write.filename);
          const existing = fileWrites.get(filePath) || "";
          fileWrites.set(filePath, existing + write.content);
        }
      }

      // Update context for next iteration (so N command reads from correct position)
      ctx.currentLineIndex += linesConsumed;
    } while (
      state.restartCycle &&
      !state.deleted &&
      !state.quit &&
      !state.quitSilent
    );

    // Update main line index with total lines consumed
    lineIndex += totalLinesConsumed;

    // Preserve state for next line
    holdSpace = state.holdSpace;

    // Output line numbers from = command (and l, F commands)
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

    // Handle output - Q (quitSilent) suppresses the final print
    if (!state.deleted && !state.quitSilent) {
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

    // Check for quit commands
    if (state.quit || state.quitSilent) {
      if (state.exitCode !== undefined) {
        exitCode = state.exitCode;
      }
      break;
    }
  }

  // Flush all accumulated file writes at end
  if (fs && cwd) {
    for (const [filePath, fileContent] of fileWrites) {
      try {
        await fs.writeFile(filePath, fileContent);
      } catch {
        // Write error - silently ignore for now
      }
    }
  }

  return { output, exitCode };
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
    let extendedRegex = false;
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
        extendedRegex = true;
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
        if (arg.includes("E") || arg.includes("r")) extendedRegex = true;
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
    const { commands, error } = parseMultipleScripts(scripts, extendedRegex);
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
      try {
        const result = await processContent(content, commands, silent, {
          limits: ctx.limits,
          fs: ctx.fs,
          cwd: ctx.cwd,
        });
        return {
          stdout: result.output,
          stderr: "",
          exitCode: result.exitCode ?? 0,
        };
      } catch (e) {
        if (e instanceof ExecutionLimitError) {
          return {
            stdout: "",
            stderr: `sed: ${e.message}\n`,
            exitCode: ExecutionLimitError.EXIT_CODE,
          };
        }
        throw e;
      }
    }

    // Handle in-place editing
    if (inPlace) {
      for (const file of files) {
        const filePath = ctx.fs.resolvePath(ctx.cwd, file);
        try {
          const fileContent = await ctx.fs.readFile(filePath);
          const result = await processContent(fileContent, commands, silent, {
            limits: ctx.limits,
            filename: file,
            fs: ctx.fs,
            cwd: ctx.cwd,
          });
          await ctx.fs.writeFile(filePath, result.output);
        } catch (e) {
          if (e instanceof ExecutionLimitError) {
            return {
              stdout: "",
              stderr: `sed: ${e.message}\n`,
              exitCode: ExecutionLimitError.EXIT_CODE,
            };
          }
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
      } catch (e) {
        if (e instanceof ExecutionLimitError) {
          return {
            stdout: "",
            stderr: `sed: ${e.message}\n`,
            exitCode: ExecutionLimitError.EXIT_CODE,
          };
        }
        return {
          stdout: "",
          stderr: `sed: ${file}: No such file or directory\n`,
          exitCode: 1,
        };
      }
    }

    try {
      const result = await processContent(content, commands, silent, {
        limits: ctx.limits,
        filename: files.length === 1 ? files[0] : undefined,
        fs: ctx.fs,
        cwd: ctx.cwd,
      });
      return {
        stdout: result.output,
        stderr: "",
        exitCode: result.exitCode ?? 0,
      };
    } catch (e) {
      if (e instanceof ExecutionLimitError) {
        return {
          stdout: "",
          stderr: `sed: ${e.message}\n`,
          exitCode: ExecutionLimitError.EXIT_CODE,
        };
      }
      throw e;
    }
  },
};

import { decodeBytesToUtf8 } from "../../encoding.js";
import { ExecutionOutputAccumulator } from "../../execution-output.js";
import type { ExecutionScope } from "../../execution-scope.js";
import { shellJoinArgs } from "../../helpers/shell-quote.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { utf8ByteLength } from "../printf/escapes.js";

const xargsHelp = {
  name: "xargs",
  summary: "build and execute command lines from standard input",
  usage: "xargs [OPTION]... [COMMAND [INITIAL-ARGS]]",
  options: [
    "-I REPLACE   replace occurrences of REPLACE with input",
    "-d DELIM     use DELIM as input delimiter (e.g., -d '\\n' for newline)",
    "-n NUM       use at most NUM arguments per command line",
    "-P NUM       run at most NUM processes at a time",
    "-0, --null   items are separated by null, not whitespace",
    "-t, --verbose  print commands before executing",
    "-r, --no-run-if-empty  do not run command if input is empty",
    "    --help   display this help and exit",
  ],
};

function splitExactBounded(
  input: string,
  delimiter: string,
  maxItems: number,
): string[] {
  if (delimiter.length === 0) {
    throw new Error("xargs: delimiter must not be empty");
  }
  const items: string[] = [];
  let start = 0;
  while (start <= input.length) {
    const end = input.indexOf(delimiter, start);
    const item = input.slice(start, end === -1 ? input.length : end);
    if (item.length > 0) {
      if (items.length >= maxItems) {
        throw new ExecutionLimitError(
          `xargs: array element limit exceeded (${maxItems})`,
          "array_elements",
        );
      }
      items.push(item);
    }
    if (end === -1) break;
    start = end + delimiter.length;
  }
  return items;
}

function splitWhitespaceBounded(input: string, maxItems: number): string[] {
  const items: string[] = [];
  let start = -1;
  for (let i = 0; i <= input.length; i++) {
    const isWhitespace = i === input.length || /\s/.test(input[i]);
    if (!isWhitespace && start === -1) start = i;
    if (isWhitespace && start !== -1) {
      if (items.length >= maxItems) {
        throw new ExecutionLimitError(
          `xargs: array element limit exceeded (${maxItems})`,
          "array_elements",
        );
      }
      items.push(input.slice(start, i));
      start = -1;
    }
  }
  return items;
}

export const xargsCommand: Command = {
  name: "xargs",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(xargsHelp);
    }

    let replaceStr: string | null = null;
    let delimiter: string | null = null;
    let maxArgs: number | null = null;
    let maxProcs: number | null = null;
    let nullSeparator = false;
    let verbose = false;
    let noRunIfEmpty = false;
    let commandStart = 0;

    // Parse xargs options
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-I" && i + 1 < args.length) {
        replaceStr = args[++i];
        commandStart = i + 1;
      } else if (arg === "-d" && i + 1 < args.length) {
        // Parse delimiter - handle escape sequences like \n, \t
        const delimArg = args[++i];
        delimiter = delimArg
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\r/g, "\r")
          .replace(/\\0/g, "\0")
          .replace(/\\\\/g, "\\");
        commandStart = i + 1;
      } else if (arg === "-n" && i + 1 < args.length) {
        const value = args[++i];
        const parsedNumber = Number(value);
        if (
          !/^\d+$/.test(value) ||
          !Number.isSafeInteger(parsedNumber) ||
          parsedNumber < 1
        ) {
          return {
            stdout: "",
            stderr: `xargs: invalid number for -n: '${value}'\n`,
            exitCode: 1,
          };
        }
        maxArgs = parsedNumber;
        commandStart = i + 1;
      } else if (arg === "-P" && i + 1 < args.length) {
        const value = args[++i];
        const parsedNumber = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsedNumber)) {
          return {
            stdout: "",
            stderr: `xargs: invalid number for -P: '${value}'\n`,
            exitCode: 1,
          };
        }
        maxProcs = parsedNumber;
        commandStart = i + 1;
      } else if (arg === "-0" || arg === "--null") {
        nullSeparator = true;
        commandStart = i + 1;
      } else if (arg === "-t" || arg === "--verbose") {
        verbose = true;
        commandStart = i + 1;
      } else if (arg === "-r" || arg === "--no-run-if-empty") {
        noRunIfEmpty = true;
        commandStart = i + 1;
      } else if (arg.startsWith("--")) {
        return unknownOption("xargs", arg);
      } else if (arg.startsWith("-") && arg.length > 1) {
        // Check for unknown short options (only boolean flags allowed in combined form)
        for (const c of arg.slice(1)) {
          if (!"0tr".includes(c)) {
            return unknownOption("xargs", `-${c}`);
          }
        }
        // Handle combined short options
        if (arg.includes("0")) nullSeparator = true;
        if (arg.includes("t")) verbose = true;
        if (arg.includes("r")) noRunIfEmpty = true;
        commandStart = i + 1;
      } else if (!arg.startsWith("-")) {
        commandStart = i;
        break;
      }
    }

    // Get command and initial args
    const command = args.slice(commandStart);
    if (command.length === 0) {
      command.push("echo");
    }

    // Parse input. Priority: -0 (null) > -d (custom delimiter) > default
    // (whitespace). xargs' delimiters (`\0`, ASCII whitespace, user-provided
    // single-byte delim) all live in the ASCII range, but the args produced
    // are passed onward as text — decode so multibyte filenames survive.
    const stdinText = decodeBytesToUtf8(ctx.stdin);
    const maxStringLength = Math.min(
      ctx.limits.maxInputBytes,
      ctx.limits.maxStringLength,
    );
    const maxArrayElements = ctx.limits.maxArrayElements;
    const maxIterations = ctx.limits.maxLoopIterations;
    const maxOutputSize = ctx.limits.maxOutputSize;
    if (utf8ByteLength(stdinText) > maxStringLength) {
      throw new ExecutionLimitError(
        `xargs: input size limit exceeded (${maxStringLength} bytes)`,
        "string_length",
      );
    }
    if (maxProcs !== null && maxProcs > maxArrayElements) {
      throw new ExecutionLimitError(
        `xargs: array element limit exceeded (${maxArrayElements})`,
        "array_elements",
      );
    }
    let items: string[];
    if (nullSeparator) {
      items = splitExactBounded(stdinText, "\0", maxArrayElements);
    } else if (delimiter !== null) {
      // Custom delimiter - split on exact string
      // Strip trailing newline from input before splitting (echo adds trailing newlines)
      const input = stdinText.replace(/\n$/, "");
      try {
        items = splitExactBounded(input, delimiter, maxArrayElements);
      } catch (error) {
        if (error instanceof ExecutionLimitError) throw error;
        return {
          stdout: "",
          stderr: "xargs: delimiter must not be empty\n",
          exitCode: 1,
        };
      }
    } else {
      // Default: split on whitespace and trim
      items = splitWhitespaceBounded(stdinText, maxArrayElements);
    }

    if (items.length === 0) {
      if (noRunIfEmpty) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      // With no -r flag, still run the command with no args
      // (echo with no args just outputs newline)
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // Execute commands
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let exitCode = 0;
    let outputBytes = 0;
    let commandIterations = 0;
    const output = ctx.executionScope
      ? new ExecutionOutputAccumulator(
          ctx.executionScope as ExecutionScope,
          "xargs",
        )
      : undefined;
    const appendOutput = (result: ExecResult): void => {
      if (output) {
        output.appendResult(result);
        return;
      }
      const addedBytes =
        utf8ByteLength(result.stdout) + utf8ByteLength(result.stderr);
      if (addedBytes > maxOutputSize - outputBytes) {
        throw new ExecutionLimitError(
          `xargs: output size limit exceeded (${maxOutputSize} bytes)`,
          "output_size",
        );
      }
      if (result.stdout) stdoutChunks.push(result.stdout);
      if (result.stderr) stderrChunks.push(result.stderr);
      outputBytes += addedBytes;
    };
    const appendStderr = (value: string): void => {
      if (output) {
        output.append("stderr", value);
        return;
      }
      const addedBytes = utf8ByteLength(value);
      if (addedBytes > maxOutputSize - outputBytes) {
        throw new ExecutionLimitError(
          `xargs: output size limit exceeded (${maxOutputSize} bytes)`,
          "output_size",
        );
      }
      if (value) stderrChunks.push(value);
      outputBytes += addedBytes;
    };

    // Helper to quote an argument if it contains special characters
    const quoteArg = (arg: string): string => {
      // If arg contains spaces, quotes, or shell metacharacters, quote it
      // Note: \s includes spaces, tabs, and newlines
      if (/[\s"'\\$`!*?[\]{}();&|<>#]/.test(arg)) {
        // Use double quotes and escape characters that are special inside double quotes:
        // backslash, double quote, dollar sign, and backtick
        return `"${arg.replace(/([\\"`$])/g, "\\$1")}"`;
      }
      return arg;
    };

    // Helper to execute a single command via the shell
    const executeCommand = async (cmdArgs: string[]): Promise<ExecResult> => {
      if (++commandIterations > maxIterations) {
        throw new ExecutionLimitError(
          `xargs: iteration limit exceeded (${maxIterations})`,
          "iterations",
        );
      }
      if (cmdArgs.length > maxArrayElements) {
        throw new ExecutionLimitError(
          `xargs: array element limit exceeded (${maxArrayElements})`,
          "array_elements",
        );
      }
      for (const value of cmdArgs) {
        if (utf8ByteLength(value) > maxStringLength) {
          throw new ExecutionLimitError(
            `xargs: string length limit exceeded (${maxStringLength} bytes)`,
            "string_length",
          );
        }
      }
      if (verbose) {
        const cmdLine = cmdArgs.map(quoteArg).join(" ");
        appendStderr(`${cmdLine}\n`);
      }
      // Use ctx.exec to run the command, passing current working directory
      if (ctx.exec) {
        return ctx.exec(shellJoinArgs([cmdArgs[0]]), {
          cwd: ctx.cwd,
          signal: ctx.signal,
          args: cmdArgs.slice(1),
        });
      }
      // Fallback: just output what would be run
      const cmdLine = cmdArgs.map(quoteArg).join(" ");
      return { stdout: `${cmdLine}\n`, stderr: "", exitCode: 0 };
    };

    // Helper to run commands with optional parallelism
    const runCommands = async (cmdArgsList: string[][]): Promise<void> => {
      if (maxProcs !== null && maxProcs > 1) {
        // Run in parallel batches
        for (let i = 0; i < cmdArgsList.length; i += maxProcs) {
          const batch = cmdArgsList.slice(i, i + maxProcs);
          const results = await Promise.all(batch.map(executeCommand));
          for (const result of results) {
            appendOutput(result);
            if (result.exitCode !== 0) {
              exitCode = result.exitCode;
            }
          }
        }
      } else {
        // Sequential execution
        for (const cmdArgs of cmdArgsList) {
          const result = await executeCommand(cmdArgs);
          appendOutput(result);
          if (result.exitCode !== 0) {
            exitCode = result.exitCode;
          }
        }
      }
    };

    if (replaceStr !== null) {
      // -I mode: run command once per item, replacing replaceStr in each argument
      if (items.length > maxIterations) {
        throw new ExecutionLimitError(
          `xargs: iteration limit exceeded (${maxIterations})`,
          "iterations",
        );
      }
      if (replaceStr.length === 0) {
        return {
          stdout: "",
          stderr: "xargs: replacement string must not be empty\n",
          exitCode: 1,
        };
      }
      if (
        command.length > 0 &&
        items.length > Math.floor(maxArrayElements / command.length)
      ) {
        throw new ExecutionLimitError(
          `xargs: array element limit exceeded (${maxArrayElements})`,
          "array_elements",
        );
      }
      const replaceBounded = (template: string, item: string): string => {
        let occurrences = 0;
        let position = 0;
        while (true) {
          position = template.indexOf(replaceStr, position);
          if (position === -1) break;
          occurrences++;
          position += replaceStr.length;
        }
        const prospectiveBytes =
          utf8ByteLength(template) +
          occurrences * (utf8ByteLength(item) - utf8ByteLength(replaceStr));
        if (prospectiveBytes > maxStringLength) {
          throw new ExecutionLimitError(
            `xargs: string length limit exceeded (${maxStringLength} bytes)`,
            "string_length",
          );
        }
        return template.replaceAll(replaceStr, item);
      };
      const cmdArgsList = items.map((item) =>
        command.map((c) => replaceBounded(c, item)),
      );
      await runCommands(cmdArgsList);
    } else if (maxArgs !== null) {
      // -n mode: batch items
      const cmdArgsList: string[][] = [];
      const batchCount = Math.ceil(items.length / maxArgs);
      if (batchCount > Math.min(maxArrayElements, maxIterations)) {
        throw new ExecutionLimitError(
          `xargs: iteration limit exceeded (${maxIterations})`,
          "iterations",
        );
      }
      const prospectiveElements = items.length + batchCount * command.length;
      if (prospectiveElements > maxArrayElements) {
        throw new ExecutionLimitError(
          `xargs: array element limit exceeded (${maxArrayElements})`,
          "array_elements",
        );
      }
      for (let i = 0; i < items.length; i += maxArgs) {
        const batch = items.slice(i, i + maxArgs);
        cmdArgsList.push([...command, ...batch]);
      }
      await runCommands(cmdArgsList);
    } else {
      // Default: all items on one line
      const cmdArgs = [...command, ...items];
      const result = await executeCommand(cmdArgs);
      appendOutput(result);
      exitCode = result.exitCode;
    }

    return (
      output?.build(exitCode) ?? {
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
        exitCode,
      }
    );
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "xargs",
  flags: [
    { flag: "-I", type: "value", valueHint: "string" },
    { flag: "-d", type: "value", valueHint: "delimiter" },
    { flag: "-n", type: "value", valueHint: "number" },
    { flag: "-0", type: "boolean" },
    { flag: "-t", type: "boolean" },
    { flag: "-r", type: "boolean" },
  ],
  stdinType: "text",
};

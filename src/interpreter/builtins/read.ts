/**
 * read - Read a line of input builtin
 */

import type { ExecResult } from "../../types.js";
import { clearArray } from "../helpers/array.js";
import {
  getIfs,
  splitByIfsForRead,
  stripTrailingIfsWhitespace,
} from "../helpers/ifs.js";
import { result } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleRead(
  ctx: InterpreterContext,
  args: string[],
  stdin: string,
): ExecResult {
  // Parse options
  let raw = false;
  let delimiter = "\n";
  let _prompt = "";
  let nchars = -1; // -n option: number of characters to read (with IFS splitting)
  let ncharsExact = -1; // -N option: read exactly N characters (no processing)
  let arrayName: string | null = null; // -a option: read into array
  let fileDescriptor = -1; // -u option: read from file descriptor
  let timeout = -1; // -t option: timeout in seconds
  const varNames: string[] = [];

  let i = 0;
  let invalidNArg = false;

  // Helper to parse smooshed options like -rn1 or -rd ''
  const parseOption = (
    opt: string,
    argIndex: number,
  ): { nextArgIndex: number } => {
    let j = 1; // skip the '-'
    while (j < opt.length) {
      const ch = opt[j];
      if (ch === "r") {
        raw = true;
        j++;
      } else if (ch === "s") {
        // Silent - ignore in non-interactive mode
        j++;
      } else if (ch === "d") {
        // -d requires value: either rest of this arg or next arg
        if (j + 1 < opt.length) {
          delimiter = opt.substring(j + 1);
          return { nextArgIndex: argIndex + 1 };
        } else if (argIndex + 1 < args.length) {
          delimiter = args[argIndex + 1];
          return { nextArgIndex: argIndex + 2 };
        }
        return { nextArgIndex: argIndex + 1 };
      } else if (ch === "n") {
        // -n requires value: either rest of this arg or next arg
        if (j + 1 < opt.length) {
          const numStr = opt.substring(j + 1);
          nchars = Number.parseInt(numStr, 10);
          if (Number.isNaN(nchars) || nchars < 0) {
            invalidNArg = true;
            nchars = 0;
          }
          return { nextArgIndex: argIndex + 1 };
        } else if (argIndex + 1 < args.length) {
          nchars = Number.parseInt(args[argIndex + 1], 10);
          if (Number.isNaN(nchars) || nchars < 0) {
            invalidNArg = true;
            nchars = 0;
          }
          return { nextArgIndex: argIndex + 2 };
        }
        return { nextArgIndex: argIndex + 1 };
      } else if (ch === "N") {
        // -N requires value: either rest of this arg or next arg
        if (j + 1 < opt.length) {
          const numStr = opt.substring(j + 1);
          ncharsExact = Number.parseInt(numStr, 10);
          if (Number.isNaN(ncharsExact) || ncharsExact < 0) {
            invalidNArg = true;
            ncharsExact = 0;
          }
          return { nextArgIndex: argIndex + 1 };
        } else if (argIndex + 1 < args.length) {
          ncharsExact = Number.parseInt(args[argIndex + 1], 10);
          if (Number.isNaN(ncharsExact) || ncharsExact < 0) {
            invalidNArg = true;
            ncharsExact = 0;
          }
          return { nextArgIndex: argIndex + 2 };
        }
        return { nextArgIndex: argIndex + 1 };
      } else if (ch === "a") {
        // -a requires value: either rest of this arg or next arg
        if (j + 1 < opt.length) {
          arrayName = opt.substring(j + 1);
          return { nextArgIndex: argIndex + 1 };
        } else if (argIndex + 1 < args.length) {
          arrayName = args[argIndex + 1];
          return { nextArgIndex: argIndex + 2 };
        }
        return { nextArgIndex: argIndex + 1 };
      } else if (ch === "p") {
        // -p requires value: either rest of this arg or next arg
        if (j + 1 < opt.length) {
          _prompt = opt.substring(j + 1);
          return { nextArgIndex: argIndex + 1 };
        } else if (argIndex + 1 < args.length) {
          _prompt = args[argIndex + 1];
          return { nextArgIndex: argIndex + 2 };
        }
        return { nextArgIndex: argIndex + 1 };
      } else if (ch === "u") {
        // -u requires value: file descriptor number
        if (j + 1 < opt.length) {
          const numStr = opt.substring(j + 1);
          fileDescriptor = Number.parseInt(numStr, 10);
          if (Number.isNaN(fileDescriptor) || fileDescriptor < 0) {
            return { nextArgIndex: -2 }; // signal error (return exit code 1)
          }
          return { nextArgIndex: argIndex + 1 };
        } else if (argIndex + 1 < args.length) {
          fileDescriptor = Number.parseInt(args[argIndex + 1], 10);
          if (Number.isNaN(fileDescriptor) || fileDescriptor < 0) {
            return { nextArgIndex: -2 }; // signal error (return exit code 1)
          }
          return { nextArgIndex: argIndex + 2 };
        }
        return { nextArgIndex: argIndex + 1 };
      } else if (ch === "t") {
        // -t requires value: timeout in seconds (can be float)
        if (j + 1 < opt.length) {
          const numStr = opt.substring(j + 1);
          timeout = Number.parseFloat(numStr);
          if (Number.isNaN(timeout)) {
            timeout = 0;
          }
          return { nextArgIndex: argIndex + 1 };
        } else if (argIndex + 1 < args.length) {
          timeout = Number.parseFloat(args[argIndex + 1]);
          if (Number.isNaN(timeout)) {
            timeout = 0;
          }
          return { nextArgIndex: argIndex + 2 };
        }
        return { nextArgIndex: argIndex + 1 };
      } else if (ch === "e" || ch === "i" || ch === "P") {
        // Interactive options - skip (with potential argument for -i)
        if (ch === "i" && argIndex + 1 < args.length) {
          return { nextArgIndex: argIndex + 2 };
        }
        j++;
      } else {
        // Unknown option, skip
        j++;
      }
    }
    return { nextArgIndex: argIndex + 1 };
  };

  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("-") && arg.length > 1 && arg !== "--") {
      const parseResult = parseOption(arg, i);
      if (parseResult.nextArgIndex === -1) {
        // Invalid argument (e.g., unknown option) - return exit code 2
        return { stdout: "", stderr: "", exitCode: 2 };
      }
      if (parseResult.nextArgIndex === -2) {
        // Invalid argument value (e.g., -u with negative number) - return exit code 1
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      i = parseResult.nextArgIndex;
    } else if (arg === "--") {
      i++;
      // Rest are variable names
      while (i < args.length) {
        varNames.push(args[i]);
        i++;
      }
    } else {
      varNames.push(arg);
      i++;
    }
  }

  // Return error if -n had invalid argument
  if (invalidNArg) {
    return result("", "", 1);
  }

  // Default variable is REPLY
  if (varNames.length === 0 && arrayName === null) {
    varNames.push("REPLY");
  }

  // Note: prompt (-p) would typically output to terminal, but we ignore it in non-interactive mode

  // Handle -t 0: check if input is available without reading
  if (timeout === 0) {
    // In non-interactive mode, check if there's stdin available
    const effectiveStdin = stdin || ctx.state.groupStdin || "";
    // If -u is used, check from fileDescriptors map
    if (fileDescriptor >= 0 && ctx.state.fileDescriptors) {
      const fdContent = ctx.state.fileDescriptors.get(fileDescriptor);
      if (fdContent && fdContent.length > 0) {
        return result("", "", 0); // Input available
      }
      return result("", "", 1); // No input
    }
    // Check regular stdin
    if (effectiveStdin.length > 0) {
      return result("", "", 0); // Input available
    }
    return result("", "", 1); // No input
  }

  // Handle negative timeout - bash returns exit code 1
  if (timeout < 0 && timeout !== -1) {
    return result("", "", 1);
  }

  // Use stdin from parameter, or fall back to groupStdin (for piped groups/while loops)
  // If -u is specified, use the file descriptor content instead
  let effectiveStdin = stdin;

  if (fileDescriptor >= 0) {
    // Read from specified file descriptor
    if (ctx.state.fileDescriptors) {
      effectiveStdin = ctx.state.fileDescriptors.get(fileDescriptor) || "";
    } else {
      effectiveStdin = "";
    }
  } else if (!effectiveStdin && ctx.state.groupStdin !== undefined) {
    effectiveStdin = ctx.state.groupStdin;
  }

  // Handle -d '' (empty delimiter) - reads until NUL byte
  // Empty string delimiter means read until NUL byte (\0)
  const effectiveDelimiter = delimiter === "" ? "\0" : delimiter;

  // Get input
  let line = "";
  let consumed = 0;
  let foundDelimiter = true; // Assume found unless no newline at end

  // Helper to consume from the appropriate source
  const consumeInput = (bytesConsumed: number) => {
    if (fileDescriptor >= 0 && ctx.state.fileDescriptors) {
      ctx.state.fileDescriptors.set(
        fileDescriptor,
        effectiveStdin.substring(bytesConsumed),
      );
    } else if (ctx.state.groupStdin !== undefined && !stdin) {
      ctx.state.groupStdin = effectiveStdin.substring(bytesConsumed);
    }
  };

  if (ncharsExact >= 0) {
    // -N: Read exactly N characters (ignores delimiters, no IFS splitting)
    const toRead = Math.min(ncharsExact, effectiveStdin.length);
    line = effectiveStdin.substring(0, toRead);
    consumed = toRead;
    foundDelimiter = toRead >= ncharsExact;

    // Consume from appropriate source
    consumeInput(consumed);

    // With -N, assign entire content to first variable (no IFS splitting)
    const varName = varNames[0] || "REPLY";
    ctx.state.env[varName] = line;
    // Set remaining variables to empty
    for (let j = 1; j < varNames.length; j++) {
      ctx.state.env[varNames[j]] = "";
    }
    return result("", "", foundDelimiter ? 0 : 1);
  } else if (nchars >= 0) {
    // -n: Read at most N characters (or until delimiter/EOF), then apply IFS splitting
    for (let c = 0; c < effectiveStdin.length && c < nchars; c++) {
      const char = effectiveStdin[c];
      if (char === effectiveDelimiter) {
        consumed = c + 1;
        break;
      }
      line += char;
      consumed = c + 1;
    }
    // Consume from appropriate source
    consumeInput(consumed);
  } else {
    // Read until delimiter, handling line continuation (backslash-newline) if not raw mode
    let remaining = effectiveStdin;
    consumed = 0;

    while (true) {
      const delimIndex = remaining.indexOf(effectiveDelimiter);
      if (delimIndex !== -1) {
        const segment = remaining.substring(0, delimIndex);
        consumed += delimIndex + effectiveDelimiter.length;
        remaining = remaining.substring(delimIndex + effectiveDelimiter.length);

        // Check for line continuation: if line ends with \ and not in raw mode
        // But only for newline delimiter (line continuation doesn't apply to other delimiters)
        if (!raw && effectiveDelimiter === "\n" && segment.endsWith("\\")) {
          // Remove trailing backslash and continue reading
          line += segment.slice(0, -1);
          continue;
        }

        line += segment;
        foundDelimiter = true;
        break;
      } else if (remaining.length > 0) {
        // No delimiter found but have content - read it but return exit code 1
        line += remaining;
        consumed += remaining.length;
        foundDelimiter = false;
        remaining = "";
        break;
      } else {
        // No more input
        if (line.length === 0) {
          // No input at all - return failure
          for (const name of varNames) {
            ctx.state.env[name] = "";
          }
          if (arrayName) {
            clearArray(ctx, arrayName);
          }
          return result("", "", 1);
        }
        foundDelimiter = false;
        break;
      }
    }

    // Consume from appropriate source
    consumeInput(consumed);
  }

  // Remove trailing newline if present and delimiter is newline
  if (effectiveDelimiter === "\n" && line.endsWith("\n")) {
    line = line.slice(0, -1);
  }

  // Helper to process backslash escapes (remove backslashes, keep escaped chars)
  const processBackslashEscapes = (s: string): string => {
    if (raw) return s;
    return s.replace(/\\(.)/g, "$1");
  };

  // If no variable names given (only REPLY), store whole line without IFS splitting
  // This preserves leading/trailing whitespace
  if (varNames.length === 1 && varNames[0] === "REPLY") {
    ctx.state.env.REPLY = processBackslashEscapes(line);
    return result("", "", foundDelimiter ? 0 : 1);
  }

  // Split by IFS (default is space, tab, newline)
  const ifs = getIfs(ctx.state.env);

  // Handle array assignment (-a)
  if (arrayName) {
    // Pass raw flag - splitting respects backslash escapes in non-raw mode
    const { words } = splitByIfsForRead(line, ifs, undefined, raw);
    clearArray(ctx, arrayName);
    // Assign words to array elements, processing backslash escapes after splitting
    for (let j = 0; j < words.length; j++) {
      ctx.state.env[`${arrayName}_${j}`] = processBackslashEscapes(words[j]);
    }
    return result("", "", foundDelimiter ? 0 : 1);
  }

  // Use the advanced IFS splitting for read with proper whitespace/non-whitespace handling
  // Pass raw flag - splitting respects backslash escapes in non-raw mode
  const maxSplit = varNames.length;
  const { words, wordStarts } = splitByIfsForRead(line, ifs, maxSplit, raw);

  // Assign words to variables
  for (let j = 0; j < varNames.length; j++) {
    const name = varNames[j];
    if (j < varNames.length - 1) {
      // Assign single word, processing backslash escapes
      ctx.state.env[name] = processBackslashEscapes(words[j] ?? "");
    } else {
      // Last variable gets all remaining content from original line
      // This preserves original separators (tabs, etc.) but strips trailing IFS
      if (j < wordStarts.length) {
        // Strip trailing IFS first (respects backslash escapes), then process backslashes
        let value = line.substring(wordStarts[j]);
        value = stripTrailingIfsWhitespace(value, ifs, raw);
        value = processBackslashEscapes(value);
        ctx.state.env[name] = value;
      } else {
        ctx.state.env[name] = "";
      }
    }
  }

  return result("", "", foundDelimiter ? 0 : 1);
}

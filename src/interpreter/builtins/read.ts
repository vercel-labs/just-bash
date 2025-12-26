/**
 * read - Read a line of input builtin
 */

import type { ExecResult } from "../../types.js";
import { clearArray } from "../helpers/array.js";
import { escapeRegexCharClass } from "../helpers/regex.js";
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
  let nchars = -1; // -n option: number of characters to read
  let arrayName: string | null = null; // -a option: read into array
  const varNames: string[] = [];

  let i = 0;
  let invalidNArg = false;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "-r") {
      raw = true;
    } else if (arg === "-d" && i + 1 < args.length) {
      delimiter = args[i + 1];
      i++;
    } else if (arg === "-p" && i + 1 < args.length) {
      _prompt = args[i + 1];
      i++;
    } else if (arg === "-n" && i + 1 < args.length) {
      nchars = Number.parseInt(args[i + 1], 10);
      if (Number.isNaN(nchars) || nchars < 0) {
        invalidNArg = true;
        nchars = 0;
      }
      i++;
    } else if (arg === "-a" && i + 1 < args.length) {
      arrayName = args[i + 1];
      i++;
    } else if (arg === "-t") {
      // Timeout - skip the argument, we don't support it
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        i++;
      }
    } else if (arg === "-s") {
      // Silent - ignore in non-interactive mode
    } else if (!arg.startsWith("-")) {
      varNames.push(arg);
    }
    i++;
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

  // Use stdin from parameter, or fall back to groupStdin (for piped groups/while loops)
  let effectiveStdin = stdin;
  if (!effectiveStdin && ctx.state.groupStdin !== undefined) {
    effectiveStdin = ctx.state.groupStdin;
  }

  // Get input
  let line = "";
  let consumed = 0;
  let foundDelimiter = true; // Assume found unless no newline at end

  if (nchars >= 0) {
    // Read exactly N characters (or until delimiter/EOF)
    for (let c = 0; c < effectiveStdin.length && c < nchars; c++) {
      const char = effectiveStdin[c];
      if (char === delimiter) {
        consumed = c + 1;
        break;
      }
      line += char;
      consumed = c + 1;
    }
    // Consume from groupStdin
    if (ctx.state.groupStdin !== undefined && !stdin) {
      ctx.state.groupStdin = effectiveStdin.substring(consumed);
    }
  } else {
    // Read until delimiter, handling line continuation (backslash-newline) if not raw mode
    let remaining = effectiveStdin;
    consumed = 0;

    while (true) {
      const delimIndex = remaining.indexOf(delimiter);
      if (delimIndex !== -1) {
        const segment = remaining.substring(0, delimIndex);
        consumed += delimIndex + delimiter.length;
        remaining = remaining.substring(delimIndex + delimiter.length);

        // Check for line continuation: if line ends with \ and not in raw mode
        if (!raw && segment.endsWith("\\")) {
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

    // Consume from groupStdin
    if (ctx.state.groupStdin !== undefined && !stdin) {
      ctx.state.groupStdin = effectiveStdin.substring(consumed);
    }
  }

  // Remove trailing newline if present and delimiter is newline
  if (delimiter === "\n" && line.endsWith("\n")) {
    line = line.slice(0, -1);
  }

  // Handle backslash escapes unless -r is specified
  if (!raw) {
    // In non-raw mode, backslash-newline is line continuation
    // and backslashes escape the next character
    line = line.replace(/\\(.)/g, "$1");
  }

  // If no variable names given (only REPLY), store whole line without IFS splitting
  // This preserves leading/trailing whitespace
  if (varNames.length === 1 && varNames[0] === "REPLY") {
    ctx.state.env.REPLY = line;
    return result("", "", foundDelimiter ? 0 : 1);
  }

  // Split by IFS (default is space, tab, newline)
  const ifs = ctx.state.env.IFS ?? " \t\n";
  let words: string[] = [];
  let wordStarts: number[] = []; // Track where each word starts in original line
  if (ifs === "") {
    words = [line];
    wordStarts = [0];
  } else {
    // Create regex from IFS characters
    const escapedIfs = escapeRegexCharClass(ifs);
    const ifsRegex = new RegExp(`[${escapedIfs}]+`, "g");
    let lastEnd = 0;
    let match: RegExpExecArray | null;
    // Find leading IFS and strip it
    const leadingMatch = line.match(new RegExp(`^[${escapedIfs}]+`));
    if (leadingMatch) {
      lastEnd = leadingMatch[0].length;
    }
    ifsRegex.lastIndex = lastEnd;
    match = ifsRegex.exec(line);
    while (match !== null) {
      if (match.index > lastEnd) {
        wordStarts.push(lastEnd);
        words.push(line.substring(lastEnd, match.index));
      }
      lastEnd = ifsRegex.lastIndex;
      match = ifsRegex.exec(line);
    }
    if (lastEnd < line.length) {
      wordStarts.push(lastEnd);
      words.push(line.substring(lastEnd));
    }
  }

  // Handle array assignment (-a)
  if (arrayName) {
    clearArray(ctx, arrayName);
    // Assign words to array elements
    for (let j = 0; j < words.length; j++) {
      ctx.state.env[`${arrayName}_${j}`] = words[j];
    }
    return result("", "", foundDelimiter ? 0 : 1);
  }

  // Assign words to variables
  for (let j = 0; j < varNames.length; j++) {
    const name = varNames[j];
    if (j < varNames.length - 1) {
      // Assign single word
      ctx.state.env[name] = words[j] ?? "";
    } else {
      // Last variable gets all remaining content from original line
      // This preserves original separators (tabs, etc.)
      if (j < wordStarts.length) {
        let value = line.substring(wordStarts[j]);
        // Strip trailing IFS whitespace
        const trailingIfsRegex = new RegExp(`[${escapeRegexCharClass(ifs)}]+$`);
        value = value.replace(trailingIfsRegex, "");
        ctx.state.env[name] = value;
      } else {
        ctx.state.env[name] = "";
      }
    }
  }

  return result("", "", foundDelimiter ? 0 : 1);
}

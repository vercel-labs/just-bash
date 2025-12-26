/**
 * read - Read a line of input builtin
 */

import type { ExecResult } from "../../types.js";
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
    return { stdout: "", stderr: "", exitCode: 1 };
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
    // Read until delimiter
    const delimIndex = effectiveStdin.indexOf(delimiter);
    if (delimIndex !== -1) {
      line = effectiveStdin.substring(0, delimIndex);
      consumed = delimIndex + delimiter.length;
      foundDelimiter = true;
      // Consume the line including delimiter from groupStdin
      if (ctx.state.groupStdin !== undefined && !stdin) {
        ctx.state.groupStdin = effectiveStdin.substring(consumed);
      }
    } else if (effectiveStdin.length > 0) {
      // No delimiter found but have content - read it but return exit code 1
      line = effectiveStdin;
      foundDelimiter = false;
      // Consume all of groupStdin
      if (ctx.state.groupStdin !== undefined && !stdin) {
        ctx.state.groupStdin = "";
      }
    } else {
      // No input - return failure
      // Still set variables to empty
      for (const name of varNames) {
        ctx.state.env[name] = "";
      }
      if (arrayName) {
        // Clear array
        for (const key of Object.keys(ctx.state.env)) {
          if (key.startsWith(`${arrayName}_`)) {
            delete ctx.state.env[key];
          }
        }
      }
      return { stdout: "", stderr: "", exitCode: 1 };
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

  // If -n was used with no variable names, store in REPLY without IFS splitting
  if (nchars >= 0 && varNames.length === 1 && varNames[0] === "REPLY") {
    ctx.state.env.REPLY = line;
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  // Split by IFS (default is space, tab, newline)
  const ifs = ctx.state.env.IFS ?? " \t\n";
  let words: string[];
  if (ifs === "") {
    words = [line];
  } else {
    // Create regex from IFS characters
    const ifsRegex = new RegExp(
      `[${ifs.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&")}]+`,
    );
    words = line.split(ifsRegex).filter((w) => w !== "");
  }

  // Handle array assignment (-a)
  if (arrayName) {
    // Clear existing array
    for (const key of Object.keys(ctx.state.env)) {
      if (key.startsWith(`${arrayName}_`)) {
        delete ctx.state.env[key];
      }
    }
    // Assign words to array elements
    for (let j = 0; j < words.length; j++) {
      ctx.state.env[`${arrayName}_${j}`] = words[j];
    }
    return { stdout: "", stderr: "", exitCode: foundDelimiter ? 0 : 1 };
  }

  // Assign words to variables
  for (let j = 0; j < varNames.length; j++) {
    const name = varNames[j];
    if (j < varNames.length - 1) {
      // Assign single word
      ctx.state.env[name] = words[j] ?? "";
    } else {
      // Last variable gets all remaining words
      ctx.state.env[name] = words.slice(j).join(" ");
    }
  }

  return { stdout: "", stderr: "", exitCode: foundDelimiter ? 0 : 1 };
}

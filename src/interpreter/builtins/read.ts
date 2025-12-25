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
  const varNames: string[] = [];

  let i = 0;
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
    } else if (!arg.startsWith("-")) {
      varNames.push(arg);
    }
    i++;
  }

  // Default variable is REPLY
  if (varNames.length === 0) {
    varNames.push("REPLY");
  }

  // Note: prompt (-p) would typically output to terminal, but we ignore it in non-interactive mode

  // Use stdin from parameter, or fall back to groupStdin (for piped groups/while loops)
  let effectiveStdin = stdin;
  if (!effectiveStdin && ctx.state.groupStdin !== undefined) {
    effectiveStdin = ctx.state.groupStdin;
  }

  // Get input line (up to delimiter)
  let line = "";
  const delimIndex = effectiveStdin.indexOf(delimiter);
  if (delimIndex !== -1) {
    line = effectiveStdin.substring(0, delimIndex);
    // Consume the line including delimiter from groupStdin
    if (ctx.state.groupStdin !== undefined && !stdin) {
      ctx.state.groupStdin = effectiveStdin.substring(
        delimIndex + delimiter.length,
      );
    }
  } else if (effectiveStdin.length > 0) {
    line = effectiveStdin;
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
    return { stdout: "", stderr: "", exitCode: 1 };
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

  return { stdout: "", stderr: "", exitCode: 0 };
}

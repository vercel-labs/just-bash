/**
 * mapfile/readarray - Read lines from stdin into an array
 *
 * Usage: mapfile [-d delim] [-n count] [-O origin] [-s count] [-t] [array]
 *        readarray [-d delim] [-n count] [-O origin] [-s count] [-t] [array]
 *
 * Options:
 *   -d delim   Use delim as line delimiter (default: newline)
 *   -n count   Read at most count lines (0 = all)
 *   -O origin  Start assigning at index origin (default: 0)
 *   -s count   Skip first count lines
 *   -t         Remove trailing delimiter from each line
 *   array      Array name (default: MAPFILE)
 */

import type { ExecResult } from "../../types.js";
import { clearArray } from "../helpers/array.js";
import { result } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleMapfile(
  ctx: InterpreterContext,
  args: string[],
  stdin: string,
): ExecResult {
  // Parse options
  let delimiter = "\n";
  let maxCount = 0; // 0 = unlimited
  let origin = 0;
  let skipCount = 0;
  let trimDelimiter = false;
  let arrayName = "MAPFILE";

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "-d" && i + 1 < args.length) {
      delimiter = args[i + 1] || "\n"; // Empty string defaults to newline
      i += 2;
    } else if (arg === "-n" && i + 1 < args.length) {
      maxCount = Number.parseInt(args[i + 1], 10) || 0;
      i += 2;
    } else if (arg === "-O" && i + 1 < args.length) {
      origin = Number.parseInt(args[i + 1], 10) || 0;
      i += 2;
    } else if (arg === "-s" && i + 1 < args.length) {
      skipCount = Number.parseInt(args[i + 1], 10) || 0;
      i += 2;
    } else if (arg === "-t") {
      trimDelimiter = true;
      i++;
    } else if (arg === "-u" || arg === "-C" || arg === "-c") {
      // Skip unsupported options that take arguments
      i += 2;
    } else if (!arg.startsWith("-")) {
      arrayName = arg;
      i++;
    } else {
      // Unknown option, skip
      i++;
    }
  }

  // Use stdin from parameter, or fall back to groupStdin
  let effectiveStdin = stdin;
  if (!effectiveStdin && ctx.state.groupStdin !== undefined) {
    effectiveStdin = ctx.state.groupStdin;
  }

  // Split input by delimiter
  const lines: string[] = [];
  let remaining = effectiveStdin;
  let lineCount = 0;
  let skipped = 0;

  while (remaining.length > 0) {
    const delimIndex = remaining.indexOf(delimiter);

    if (delimIndex === -1) {
      // No more delimiters, add remaining content as last line (if not empty)
      if (remaining.length > 0) {
        if (skipped < skipCount) {
          skipped++;
        } else if (maxCount === 0 || lineCount < maxCount) {
          lines.push(remaining);
          lineCount++;
        }
      }
      break;
    }

    // Found delimiter
    let line = remaining.substring(0, delimIndex);
    if (!trimDelimiter) {
      line += delimiter;
    }

    remaining = remaining.substring(delimIndex + delimiter.length);

    if (skipped < skipCount) {
      skipped++;
      continue;
    }

    if (maxCount > 0 && lineCount >= maxCount) {
      break;
    }

    lines.push(line);
    lineCount++;
  }

  // Clear existing array and store lines
  clearArray(ctx, arrayName);

  for (let j = 0; j < lines.length; j++) {
    ctx.state.env[`${arrayName}_${origin + j}`] = lines[j];
  }

  // Set array length metadata
  if (lines.length > 0) {
    ctx.state.env[`${arrayName}__length`] = String(origin + lines.length);
  }

  // Consume from groupStdin if we used it
  if (ctx.state.groupStdin !== undefined && !stdin) {
    ctx.state.groupStdin = "";
  }

  return result("", "", 0);
}

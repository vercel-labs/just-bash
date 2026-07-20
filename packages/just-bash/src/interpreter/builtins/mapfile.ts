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

import { utf8ByteLength } from "../../encoding.js";
import type { ExecResult } from "../../types.js";
import { ExecutionLimitError } from "../errors.js";
import { clearArray, setArrayElement } from "../helpers/array.js";
import { checkReadonlyError } from "../helpers/readonly.js";
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
      // In bash, -d '' means use NUL byte as delimiter
      delimiter = args[i + 1] === "" ? "\0" : args[i + 1] || "\n";
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

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(arrayName)) {
    return result("", `mapfile: ${arrayName}: not a valid identifier\n`, 1);
  }
  if (!Number.isSafeInteger(origin) || origin < 0) {
    return result("", "mapfile: invalid array origin\n", 1);
  }
  // Authorization precedes parsing/consuming potentially large input.
  checkReadonlyError(ctx, arrayName, "mapfile");

  // Use stdin from parameter, or fall back to groupStdin
  let effectiveStdin = stdin;
  if (!effectiveStdin && ctx.state.groupStdin !== undefined) {
    effectiveStdin = ctx.state.groupStdin;
  }

  // Split input by delimiter
  const lines: string[] = [];
  let cursor = 0;
  let lineCount = 0;
  let skipped = 0;
  const maxArrayElements = ctx.limits.maxArrayElements;

  const pushLine = (line: string): void => {
    if (utf8ByteLength(line) > ctx.limits.maxStringLength) {
      throw new ExecutionLimitError(
        `mapfile: string length limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    }
    lines.push(line);
  };

  while (cursor < effectiveStdin.length) {
    ctx.executionScope.consumeWork(1, "mapfile input");
    const delimIndex = effectiveStdin.indexOf(delimiter, cursor);

    if (delimIndex === -1) {
      // No more delimiters, add remaining content as last line (if not empty)
      if (cursor < effectiveStdin.length) {
        if (skipped < skipCount) {
          skipped++;
        } else if (maxCount === 0 || lineCount < maxCount) {
          // Check array element limit
          // Bash truncates at NUL bytes
          let lastLine = effectiveStdin.slice(cursor);
          const nulIdx = lastLine.indexOf("\0");
          if (nulIdx !== -1) {
            lastLine = lastLine.substring(0, nulIdx);
          }
          if (lines.length >= maxArrayElements) {
            return result(
              "",
              `mapfile: array element limit exceeded (${maxArrayElements})\n`,
              1,
            );
          }
          pushLine(lastLine);
          lineCount++;
        }
      }
      break;
    }

    // Found delimiter
    let line = effectiveStdin.slice(cursor, delimIndex);
    // Bash truncates lines at NUL bytes (unlike 'read' which ignores them)
    const nulIndex = line.indexOf("\0");
    if (nulIndex !== -1) {
      line = line.substring(0, nulIndex);
    }
    // For other delimiters, include unless -t flag is set
    if (!trimDelimiter && delimiter !== "\0") {
      line += delimiter;
    }

    cursor = delimIndex + delimiter.length;

    if (skipped < skipCount) {
      skipped++;
      continue;
    }

    if (maxCount > 0 && lineCount >= maxCount) {
      break;
    }

    // Check array element limit
    if (lines.length >= maxArrayElements) {
      return result(
        "",
        `mapfile: array element limit exceeded (${maxArrayElements})\n`,
        1,
      );
    }
    pushLine(line);
    lineCount++;
  }

  const existingKeys = new Set(
    origin === 0
      ? []
      : (ctx.state.arrays?.get(arrayName)?.elements.keys() ?? []),
  );
  for (let j = 0; j < lines.length; j++) {
    existingKeys.add(String(origin + j));
    if (existingKeys.size > maxArrayElements) {
      return result(
        "",
        `mapfile: array element limit exceeded (${maxArrayElements})\n`,
        1,
      );
    }
  }

  // Clear existing array ONLY if not using -O (offset) option
  // When using -O, we want to preserve existing elements and append starting at origin
  if (origin === 0) {
    clearArray(ctx, arrayName);
  }

  for (let j = 0; j < lines.length; j++) {
    setArrayElement(ctx, arrayName, origin + j, lines[j]);
  }

  // Consume from groupStdin if we used it
  if (ctx.state.groupStdin !== undefined && !stdin) {
    ctx.state.groupStdin = "";
  }

  return result("", "", 0);
}

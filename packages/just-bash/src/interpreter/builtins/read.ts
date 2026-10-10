/**
 * read - Read a line of input builtin
 */

import {
  decodeBytesToUtf8,
  unsafeBytesFromLatin1,
  utf8ByteLength,
} from "../../encoding.js";
import type { ExecResult } from "../../types.js";
import { ExecutionLimitError } from "../errors.js";
import { advanceFd, getFdEntry, readFd } from "../fd-table.js";
import { clearArray, setArrayElement } from "../helpers/array.js";
import {
  getIfs,
  splitByIfsForRead,
  stripTrailingIfsWhitespace,
} from "../helpers/ifs.js";
import { checkReadonlyError } from "../helpers/readonly.js";
import { result } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleRead(
  ctx: InterpreterContext,
  args: string[],
  stdin: string,
  stdinSourceFd = -1,
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

  const destinations = new Set<string>();
  if (arrayName) destinations.add(arrayName);
  for (const name of varNames) destinations.add(name);
  // The -N path assigns REPLY even when -a was also supplied and no explicit
  // scalar destination was given.
  if (ncharsExact >= 0 && varNames.length === 0) destinations.add("REPLY");
  for (const name of destinations) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return result("", `bash: read: \`${name}': not a valid identifier\n`, 1);
    }
    checkReadonlyError(ctx, name, "bash");
  }

  // Note: prompt (-p) would typically output to terminal, but we ignore it in non-interactive mode

  // Handle -t 0: check if input is available without reading
  // In bash, -t 0 is a "poll" operation that always succeeds (returns 0) as long as
  // stdin is valid/readable. It doesn't actually read any data.
  if (timeout === 0) {
    // Clear any variables to empty (read doesn't actually read anything)
    if (arrayName) {
      clearArray(ctx, arrayName);
    } else {
      for (const name of varNames) {
        ctx.state.env.set(name, "");
      }
      if (varNames.length === 0) {
        ctx.state.env.set("REPLY", "");
      }
    }
    return result("", "", 0); // Always succeed - stdin is valid
  }

  // Handle negative timeout - bash returns exit code 1
  if (timeout < 0 && timeout !== -1) {
    return result("", "", 1);
  }

  // Use stdin from parameter, or fall back to groupStdin (for piped groups/while loops)
  // If -u is specified, read from that descriptor's shared position instead.
  let effectiveStdin = stdin;
  // `-u 0` is just stdin, which never lives in the descriptor table.
  // A descriptor saved off stdin (`exec 3<&0`) reads stdin too.
  const savedStdinFd = getFdEntry(ctx, fileDescriptor);
  const readsFromFd =
    fileDescriptor > 0 &&
    !(savedStdinFd?.kind === "dup-in" && savedStdinFd.sourceFd === 0);

  if (readsFromFd) {
    const readable = readFd(ctx, fileDescriptor);
    if ("error" in readable) {
      // bash distinguishes "you named a descriptor that isn't open" from
      // "the descriptor is open but not readable". stdout and stderr are
      // always open and always write-only, so they take the latter even
      // though they never appear in the descriptor table.
      const writeOnly =
        readable.error === "write-only" ||
        fileDescriptor === 1 ||
        fileDescriptor === 2;
      const message = writeOnly
        ? `bash: read: read error: ${fileDescriptor}: Bad file descriptor\n`
        : `bash: read: ${fileDescriptor}: invalid file descriptor: Bad file descriptor\n`;
      return result("", message, 1);
    }
    effectiveStdin = readable.content;
  } else if (!effectiveStdin && ctx.state.groupStdin !== undefined) {
    effectiveStdin = ctx.state.groupStdin;
  }

  // Handle -d '' (empty delimiter) - reads until NUL byte
  // Empty string delimiter means read until NUL byte (\0)
  const effectiveDelimiter = delimiter === "" ? "\0" : delimiter;

  // Get input
  let line = "";
  let lineBytes = 0;
  const appendLine = (value: string): void => {
    const bytes = utf8ByteLength(value);
    if (bytes > ctx.limits.maxStringLength - lineBytes) {
      throw new ExecutionLimitError(
        `read: string length limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    }
    line += value;
    lineBytes += bytes;
  };
  const assertLineLimit = (value: string): void => {
    if (utf8ByteLength(value) > ctx.limits.maxStringLength) {
      throw new ExecutionLimitError(
        `read: string length limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    }
  };
  let consumed = 0;
  let foundDelimiter = true; // Assume found unless no newline at end

  // Advance whichever input this read consumed from. A descriptor carries a
  // single shared position, so the next `read -u N` / `read <&N` continues
  // where this one stopped.
  const consumeInput = (bytesConsumed: number) => {
    if (readsFromFd) {
      advanceFd(ctx, fileDescriptor, bytesConsumed);
    } else if (stdinSourceFd >= 0) {
      // stdin came from `<&N`; move N forward by exactly what was read.
      advanceFd(ctx, stdinSourceFd, bytesConsumed);
    } else if (ctx.state.groupStdin !== undefined && !stdin) {
      ctx.state.groupStdin = effectiveStdin.substring(bytesConsumed);
      if (ctx.state.groupStdinSourceFd !== undefined) {
        advanceFd(ctx, ctx.state.groupStdinSourceFd, bytesConsumed);
      }
    }
  };

  if (ncharsExact >= 0) {
    // -N: Read exactly N characters (ignores delimiters, no IFS splitting)
    const toRead = Math.min(ncharsExact, effectiveStdin.length);
    line = effectiveStdin.substring(0, toRead);
    assertLineLimit(line);
    consumed = toRead;
    foundDelimiter = toRead >= ncharsExact;

    // Consume from appropriate source
    consumeInput(consumed);

    // With -N, assign entire content to first variable (no IFS splitting)
    const varName = varNames[0] || "REPLY";
    ctx.state.env.set(varName, decodeBytesToUtf8(unsafeBytesFromLatin1(line)));
    // Set remaining variables to empty
    for (let j = 1; j < varNames.length; j++) {
      ctx.state.env.set(varNames[j], "");
    }
    return result("", "", foundDelimiter ? 0 : 1);
  } else if (nchars >= 0) {
    // -n: Read at most N characters (or until delimiter/EOF), then apply IFS splitting
    // In non-raw mode, backslash escapes are processed: \X counts as 1 char (the X)
    let charCount = 0;
    let inputPos = 0;
    let hitDelimiter = false;
    while (inputPos < effectiveStdin.length && charCount < nchars) {
      const char = effectiveStdin[inputPos];
      if (char === effectiveDelimiter) {
        consumed = inputPos + 1;
        hitDelimiter = true;
        break;
      }
      if (!raw && char === "\\" && inputPos + 1 < effectiveStdin.length) {
        // Backslash escape: consume both chars, but only count as 1 char
        // The escaped character is kept, backslash is removed
        const nextChar = effectiveStdin[inputPos + 1];
        if (nextChar === effectiveDelimiter && effectiveDelimiter === "\n") {
          // Backslash-newline is a line continuation: consume both, don't count as a char
          // Continue reading from the next line
          inputPos += 2;
          consumed = inputPos;
          continue;
        }
        if (nextChar === effectiveDelimiter) {
          // Backslash-delimiter (non-newline): counts as one char (the escaped delimiter)
          inputPos += 2;
          charCount++;
          appendLine(nextChar);
          consumed = inputPos;
          continue;
        }
        appendLine(nextChar);
        inputPos += 2;
        charCount++;
        consumed = inputPos;
      } else {
        appendLine(char);
        inputPos++;
        charCount++;
        consumed = inputPos;
      }
    }
    // For -n: success if we read enough characters OR if we hit the delimiter
    // Failure (exit 1) only if EOF reached before nchars and before delimiter
    foundDelimiter = charCount >= nchars || hitDelimiter;
    // Consume from appropriate source
    consumeInput(consumed);
  } else {
    // Read until delimiter, handling line continuation (backslash-newline) if not raw mode
    // Backslash-newline continuation is handled regardless of the delimiter - it's a line continuation feature
    // Backslash-delimiter escapes the delimiter, making it literal
    consumed = 0;
    let inputPos = 0;

    while (inputPos < effectiveStdin.length) {
      const char = effectiveStdin[inputPos];

      // Check for delimiter
      if (char === effectiveDelimiter) {
        consumed = inputPos + effectiveDelimiter.length;
        foundDelimiter = true;
        break;
      }

      // In non-raw mode, handle backslash escapes
      if (!raw && char === "\\" && inputPos + 1 < effectiveStdin.length) {
        const nextChar = effectiveStdin[inputPos + 1];

        if (nextChar === "\n") {
          // Backslash-newline is line continuation: skip both, regardless of delimiter
          inputPos += 2;
          continue;
        }

        if (nextChar === effectiveDelimiter) {
          // Backslash-delimiter: escape the delimiter, include it literally
          appendLine(nextChar);
          inputPos += 2;
          continue;
        }

        // Other backslash escapes: keep both for now (will be processed later)
        appendLine(char);
        appendLine(nextChar);
        inputPos += 2;
        continue;
      }

      appendLine(char);
      inputPos++;
    }

    // If we exited the loop without finding a delimiter, we consumed everything
    // foundDelimiter remains at initial value (true) only if we explicitly set it in the loop
    // So check if we actually found the delimiter by seeing if we broke early
    if (inputPos >= effectiveStdin.length) {
      // We reached end of input without finding delimiter
      foundDelimiter = false;
      consumed = inputPos;
      // Check if we got any content
      if (line.length === 0 && effectiveStdin.length === 0) {
        // No input at all - return failure
        for (const name of varNames) {
          ctx.state.env.set(name, "");
        }
        if (arrayName) {
          clearArray(ctx, arrayName);
        }
        return result("", "", 1);
      }
    }

    // Consume from appropriate source
    consumeInput(consumed);
  }

  // stdin holds one char per byte; decode so multibyte characters become single chars
  line = decodeBytesToUtf8(unsafeBytesFromLatin1(line));

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
    ctx.state.env.set("REPLY", processBackslashEscapes(line));
    return result("", "", foundDelimiter ? 0 : 1);
  }

  // Split by IFS (default is space, tab, newline)
  const ifs = getIfs(ctx.state.env);
  const maxArrayElements = ctx.limits.maxArrayElements;

  // Handle array assignment (-a)
  if (arrayName) {
    // Pass raw flag - splitting respects backslash escapes in non-raw mode
    const { words } = splitByIfsForRead(
      line,
      ifs,
      maxArrayElements,
      undefined,
      raw,
    );

    clearArray(ctx, arrayName);
    // Assign words to array elements, processing backslash escapes after splitting
    for (let j = 0; j < words.length; j++) {
      setArrayElement(ctx, arrayName, j, processBackslashEscapes(words[j]));
    }
    return result("", "", foundDelimiter ? 0 : 1);
  }

  // Use the advanced IFS splitting for read with proper whitespace/non-whitespace handling
  // Pass raw flag - splitting respects backslash escapes in non-raw mode
  const maxSplit = varNames.length;
  const { words, wordStarts } = splitByIfsForRead(
    line,
    ifs,
    maxArrayElements,
    maxSplit,
    raw,
  );

  // Assign words to variables
  for (let j = 0; j < varNames.length; j++) {
    const name = varNames[j];
    if (j < varNames.length - 1) {
      // Assign single word, processing backslash escapes
      ctx.state.env.set(name, processBackslashEscapes(words[j] ?? ""));
    } else {
      // Last variable gets all remaining content from original line
      // This preserves original separators (tabs, etc.) but strips trailing IFS
      if (j < wordStarts.length) {
        // Strip trailing IFS first (respects backslash escapes), then process backslashes
        let value = line.substring(wordStarts[j]);
        value = stripTrailingIfsWhitespace(value, ifs, raw);
        value = processBackslashEscapes(value);
        ctx.state.env.set(name, value);
      } else {
        ctx.state.env.set(name, "");
      }
    }
  }

  return result("", "", foundDelimiter ? 0 : 1);
}

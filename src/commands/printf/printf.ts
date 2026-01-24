import { sprintf } from "sprintf-js";
import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { applyWidth, processEscapes } from "./escapes.js";

/**
 * Decode a byte array as UTF-8 with error recovery.
 * Valid UTF-8 sequences are decoded to their Unicode characters.
 * Invalid bytes are preserved as Latin-1 characters (byte value = char code).
 */
function decodeUtf8WithRecovery(bytes: number[]): string {
  let result = "";
  let i = 0;

  while (i < bytes.length) {
    const b0 = bytes[i];

    // ASCII (0xxxxxxx)
    if (b0 < 0x80) {
      result += String.fromCharCode(b0);
      i++;
      continue;
    }

    // 2-byte sequence (110xxxxx 10xxxxxx)
    if ((b0 & 0xe0) === 0xc0) {
      if (
        i + 1 < bytes.length &&
        (bytes[i + 1] & 0xc0) === 0x80 &&
        b0 >= 0xc2 // Reject overlong sequences
      ) {
        const codePoint = ((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
        result += String.fromCharCode(codePoint);
        i += 2;
        continue;
      }
      // Invalid or incomplete - output as Latin-1
      result += String.fromCharCode(b0);
      i++;
      continue;
    }

    // 3-byte sequence (1110xxxx 10xxxxxx 10xxxxxx)
    if ((b0 & 0xf0) === 0xe0) {
      if (
        i + 2 < bytes.length &&
        (bytes[i + 1] & 0xc0) === 0x80 &&
        (bytes[i + 2] & 0xc0) === 0x80
      ) {
        // Check for overlong encoding
        if (b0 === 0xe0 && bytes[i + 1] < 0xa0) {
          // Overlong - output first byte as Latin-1
          result += String.fromCharCode(b0);
          i++;
          continue;
        }
        // Check for surrogate range (U+D800-U+DFFF)
        const codePoint =
          ((b0 & 0x0f) << 12) |
          ((bytes[i + 1] & 0x3f) << 6) |
          (bytes[i + 2] & 0x3f);
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
          // Invalid surrogate - output first byte as Latin-1
          result += String.fromCharCode(b0);
          i++;
          continue;
        }
        result += String.fromCharCode(codePoint);
        i += 3;
        continue;
      }
      // Invalid or incomplete - output as Latin-1
      result += String.fromCharCode(b0);
      i++;
      continue;
    }

    // 4-byte sequence (11110xxx 10xxxxxx 10xxxxxx 10xxxxxx)
    if ((b0 & 0xf8) === 0xf0 && b0 <= 0xf4) {
      if (
        i + 3 < bytes.length &&
        (bytes[i + 1] & 0xc0) === 0x80 &&
        (bytes[i + 2] & 0xc0) === 0x80 &&
        (bytes[i + 3] & 0xc0) === 0x80
      ) {
        // Check for overlong encoding
        if (b0 === 0xf0 && bytes[i + 1] < 0x90) {
          // Overlong - output first byte as Latin-1
          result += String.fromCharCode(b0);
          i++;
          continue;
        }
        const codePoint =
          ((b0 & 0x07) << 18) |
          ((bytes[i + 1] & 0x3f) << 12) |
          ((bytes[i + 2] & 0x3f) << 6) |
          (bytes[i + 3] & 0x3f);
        // Check for valid range (U+10000 to U+10FFFF)
        if (codePoint > 0x10ffff) {
          // Invalid - output first byte as Latin-1
          result += String.fromCharCode(b0);
          i++;
          continue;
        }
        result += String.fromCodePoint(codePoint);
        i += 4;
        continue;
      }
      // Invalid or incomplete - output as Latin-1
      result += String.fromCharCode(b0);
      i++;
      continue;
    }

    // Invalid lead byte (10xxxxxx or 11111xxx) - output as Latin-1
    result += String.fromCharCode(b0);
    i++;
  }

  return result;
}

const printfHelp = {
  name: "printf",
  summary: "format and print data",
  usage: "printf [-v var] FORMAT [ARGUMENT...]",
  options: [
    "    -v var     assign the output to shell variable VAR rather than display it",
    "    --help     display this help and exit",
  ],
  notes: [
    "FORMAT controls the output like in C printf.",
    "Escape sequences: \\n (newline), \\t (tab), \\\\ (backslash)",
    "Format specifiers: %s (string), %d (integer), %f (float), %x (hex), %o (octal), %% (literal %)",
    "Width and precision: %10s (width 10), %.2f (2 decimal places), %010d (zero-padded)",
    "Flags: %- (left-justify), %+ (show sign), %0 (zero-pad)",
  ],
};

export const printfCommand: Command = {
  name: "printf",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(printfHelp);
    }

    if (args.length === 0) {
      return {
        stdout: "",
        stderr: "printf: usage: printf format [arguments]\n",
        exitCode: 2,
      };
    }

    // Parse options
    let targetVar: string | null = null;
    let argIndex = 0;

    while (argIndex < args.length) {
      const arg = args[argIndex];
      if (arg === "--") {
        // End of options
        argIndex++;
        break;
      }
      if (arg === "-v") {
        // Store result in variable
        if (argIndex + 1 >= args.length) {
          return {
            stdout: "",
            stderr: "printf: -v: option requires an argument\n",
            exitCode: 1,
          };
        }
        targetVar = args[argIndex + 1];
        // Validate variable name
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\[[^\]]+\])?$/.test(targetVar)) {
          return {
            stdout: "",
            stderr: `printf: \`${targetVar}': not a valid identifier\n`,
            exitCode: 2,
          };
        }
        argIndex += 2;
      } else if (arg.startsWith("-") && arg !== "-") {
        // Unknown option - treat as format string (bash behavior)
        break;
      } else {
        break;
      }
    }

    if (argIndex >= args.length) {
      return {
        stdout: "",
        stderr: "printf: usage: printf format [arguments]\n",
        exitCode: 1,
      };
    }

    const format = args[argIndex];
    const formatArgs = args.slice(argIndex + 1);

    try {
      // First, process escape sequences in the format string
      const processedFormat = processEscapes(format);

      // Format and handle argument reuse (bash loops through format until all args consumed)
      let output = "";
      let argPos = 0;
      let hadError = false;
      let errorMessage = "";

      // Get TZ from shell environment for strftime formatting
      const tz = ctx.env.TZ;

      do {
        const { result, argsConsumed, error, errMsg, stopped } = formatOnce(
          processedFormat,
          formatArgs,
          argPos,
          tz,
        );
        output += result;
        argPos += argsConsumed;
        if (error) {
          hadError = true;
          if (errMsg) errorMessage = errMsg;
        }
        // If %b with \c was encountered, stop all output immediately
        if (stopped) {
          break;
        }
      } while (argPos < formatArgs.length && argPos > 0);

      // If no args were consumed but format had no specifiers, just output format
      if (argPos === 0 && formatArgs.length > 0) {
        // Format had no specifiers - output once
      }

      // If -v was specified, store in variable instead of printing
      if (targetVar) {
        // Check for array subscript syntax: name[key] or name["key"] or name['key']
        const arrayMatch = targetVar.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\[(['"]?)(.+?)\2\]$/,
        );
        if (arrayMatch) {
          const arrayName = arrayMatch[1];
          let key = arrayMatch[3];
          // Expand variables in the subscript (e.g., $key -> value)
          key = key.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, varName) => {
            return ctx.env[varName] ?? "";
          });
          ctx.env[`${arrayName}_${key}`] = output;
        } else {
          ctx.env[targetVar] = output;
        }
        return { stdout: "", stderr: errorMessage, exitCode: hadError ? 1 : 0 };
      }

      return {
        stdout: output,
        stderr: errorMessage,
        exitCode: hadError ? 1 : 0,
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: `printf: ${getErrorMessage(error)}\n`,
        exitCode: 1,
      };
    }
  },
};

/**
 * Format the string once, consuming args starting at argPos.
 * Returns the formatted result and number of args consumed.
 */
function formatOnce(
  format: string,
  args: string[],
  argPos: number,
  tz?: string,
): {
  result: string;
  argsConsumed: number;
  error: boolean;
  errMsg: string;
  stopped: boolean;
} {
  let result = "";
  let i = 0;
  let argsConsumed = 0;
  let error = false;
  let errMsg = "";

  while (i < format.length) {
    if (format[i] === "%" && i + 1 < format.length) {
      // Parse the format specifier
      const specStart = i;
      i++; // skip %

      // Check for %%
      if (format[i] === "%") {
        result += "%";
        i++;
        continue;
      }

      // Check for %(strftime)T format
      // Format: %[flags][width][.precision](strftime-format)T
      const strftimeMatch = format
        .slice(specStart)
        .match(/^%(-?\d*)(?:\.(\d+))?\(([^)]*)\)T/);
      if (strftimeMatch) {
        const width = strftimeMatch[1] ? parseInt(strftimeMatch[1], 10) : 0;
        const precision = strftimeMatch[2]
          ? parseInt(strftimeMatch[2], 10)
          : -1;
        const strftimeFmt = strftimeMatch[3];
        const fullMatch = strftimeMatch[0];

        // Get the timestamp argument
        const arg = args[argPos + argsConsumed] || "";
        argsConsumed++;

        // Parse timestamp - empty or -1 means current time, -2 means shell start time
        let timestamp: number;
        if (arg === "" || arg === "-1") {
          timestamp = Math.floor(Date.now() / 1000);
        } else if (arg === "-2") {
          // Shell start time - use current time as approximation
          timestamp = Math.floor(Date.now() / 1000);
        } else {
          timestamp = parseInt(arg, 10) || 0;
        }

        // Format using strftime
        let formatted = formatStrftime(strftimeFmt, timestamp, tz);

        // Apply precision (truncate)
        if (precision >= 0 && formatted.length > precision) {
          formatted = formatted.slice(0, precision);
        }

        // Apply width
        if (width !== 0) {
          const absWidth = Math.abs(width);
          if (formatted.length < absWidth) {
            if (width < 0) {
              // Left-justify
              formatted = formatted.padEnd(absWidth, " ");
            } else {
              // Right-justify
              formatted = formatted.padStart(absWidth, " ");
            }
          }
        }

        result += formatted;
        i = specStart + fullMatch.length;
        continue;
      }

      // Parse flags
      while (i < format.length && "+-0 #'".includes(format[i])) {
        i++;
      }

      // Parse width (can be * to read from args)
      let widthFromArg = false;
      if (format[i] === "*") {
        widthFromArg = true;
        i++;
      } else {
        while (i < format.length && /\d/.test(format[i])) {
          i++;
        }
      }

      // Parse precision
      let precisionFromArg = false;
      if (format[i] === ".") {
        i++;
        if (format[i] === "*") {
          precisionFromArg = true;
          i++;
        } else {
          while (i < format.length && /\d/.test(format[i])) {
            i++;
          }
        }
      }

      // Parse length modifier
      if (i < format.length && "hlL".includes(format[i])) {
        i++;
      }

      // Get specifier
      const specifier = format[i] || "";
      i++;

      const fullSpec = format.slice(specStart, i);

      // Handle width/precision from args
      let adjustedSpec = fullSpec;
      if (widthFromArg) {
        const w = parseInt(args[argPos + argsConsumed] || "0", 10);
        argsConsumed++;
        adjustedSpec = adjustedSpec.replace("*", String(w));
      }
      if (precisionFromArg) {
        const p = parseInt(args[argPos + argsConsumed] || "0", 10);
        argsConsumed++;
        adjustedSpec = adjustedSpec.replace(".*", `.${p}`);
      }

      // Get the argument
      const arg = args[argPos + argsConsumed] || "";
      argsConsumed++;

      // Format based on specifier
      const { value, parseError, parseErrMsg, stopped } = formatValue(
        adjustedSpec,
        specifier,
        arg,
      );
      result += value;
      if (parseError) {
        error = true;
        if (parseErrMsg) errMsg = parseErrMsg;
      }
      // If %b with \c was encountered, stop all output immediately
      if (stopped) {
        return { result, argsConsumed, error, errMsg, stopped: true };
      }
    } else {
      result += format[i];
      i++;
    }
  }

  return { result, argsConsumed, error, errMsg, stopped: false };
}

/**
 * Format a single value with the given specifier
 */
function formatValue(
  spec: string,
  specifier: string,
  arg: string,
): {
  value: string;
  parseError: boolean;
  parseErrMsg: string;
  stopped?: boolean;
} {
  let parseError = false;
  let parseErrMsg = "";

  switch (specifier) {
    case "d":
    case "i": {
      const num = parseIntArg(arg);
      parseError = lastParseError;
      if (parseError) parseErrMsg = `printf: ${arg}: invalid number\n`;
      return { value: formatInteger(spec, num), parseError, parseErrMsg };
    }
    case "o": {
      const num = parseIntArg(arg);
      parseError = lastParseError;
      if (parseError) parseErrMsg = `printf: ${arg}: invalid number\n`;
      return { value: formatOctal(spec, num), parseError, parseErrMsg };
    }
    case "u": {
      const num = parseIntArg(arg);
      parseError = lastParseError;
      if (parseError) parseErrMsg = `printf: ${arg}: invalid number\n`;
      // For unsigned with negative, convert to unsigned representation
      const unsignedNum = num < 0 ? num >>> 0 : num;
      return {
        value: formatInteger(spec.replace("u", "d"), unsignedNum),
        parseError,
        parseErrMsg,
      };
    }
    case "x":
    case "X": {
      const num = parseIntArg(arg);
      parseError = lastParseError;
      if (parseError) parseErrMsg = `printf: ${arg}: invalid number\n`;
      return { value: formatHex(spec, num), parseError, parseErrMsg };
    }
    case "e":
    case "E":
    case "f":
    case "F":
    case "g":
    case "G": {
      const num = parseFloat(arg) || 0;
      return {
        value: formatFloat(spec, specifier, num),
        parseError: false,
        parseErrMsg: "",
      };
    }
    case "c": {
      // Character - take first BYTE of UTF-8 encoding (not first Unicode character)
      // This matches bash behavior where %c outputs a single byte, not a full character
      if (arg === "") {
        return { value: "", parseError: false, parseErrMsg: "" };
      }
      // Encode the string to UTF-8 and take just the first byte
      const encoder = new TextEncoder();
      const bytes = encoder.encode(arg);
      const firstByte = bytes[0];
      // Convert byte back to a character (as Latin-1 / ISO-8859-1)
      return {
        value: String.fromCharCode(firstByte),
        parseError: false,
        parseErrMsg: "",
      };
    }
    case "s":
      return {
        value: formatString(spec, arg),
        parseError: false,
        parseErrMsg: "",
      };
    case "q":
      // Shell quoting with width support
      return {
        value: formatQuoted(spec, arg),
        parseError: false,
        parseErrMsg: "",
      };
    case "b": {
      // Interpret escape sequences in arg
      // Returns {value, stopped} - if stopped is true, \c was encountered
      const bResult = processBEscapes(arg);
      return {
        value: bResult.value,
        parseError: false,
        parseErrMsg: "",
        stopped: bResult.stopped,
      };
    }
    default:
      try {
        return {
          value: sprintf(spec, arg),
          parseError: false,
          parseErrMsg: "",
        };
      } catch {
        return {
          value: "",
          parseError: true,
          parseErrMsg: `printf: [sprintf] unexpected placeholder\n`,
        };
      }
  }
}

/**
 * Error flag for invalid integer parsing - set by parseIntArg
 */
let lastParseError = false;

/**
 * Parse an integer argument, handling bash-style character notation ('a' = 97)
 */
function parseIntArg(arg: string): number {
  lastParseError = false;

  // Only trim leading whitespace - trailing whitespace triggers error but we still parse
  const trimmed = arg.trimStart();
  const hasTrailingWhitespace = trimmed !== trimmed.trimEnd();

  // Continue parsing with trimmed value - but set error flag later if there's trailing whitespace
  arg = trimmed.trimEnd();

  // Handle character notation: 'x' or "x" gives ASCII value
  // Also handle \'x and \"x (escaped quotes, which shell may pass through)
  if (arg.startsWith("'") && arg.length >= 2) {
    return arg.charCodeAt(1);
  }
  if (arg.startsWith('"') && arg.length >= 2) {
    return arg.charCodeAt(1);
  }
  if (arg.startsWith("\\'") && arg.length >= 3) {
    return arg.charCodeAt(2);
  }
  if (arg.startsWith('\\"') && arg.length >= 3) {
    return arg.charCodeAt(2);
  }

  // Handle + prefix (e.g., +42)
  if (arg.startsWith("+")) {
    arg = arg.slice(1);
  }

  // Handle hex
  if (arg.startsWith("0x") || arg.startsWith("0X")) {
    const num = parseInt(arg, 16);
    if (Number.isNaN(num)) {
      lastParseError = true;
      return 0;
    }
    if (hasTrailingWhitespace) lastParseError = true;
    return num;
  }

  // Handle octal
  if (arg.startsWith("0") && arg.length > 1 && /^-?0[0-7]+$/.test(arg)) {
    if (hasTrailingWhitespace) lastParseError = true;
    return parseInt(arg, 8) || 0;
  }

  // Reject arbitrary base notation like 64#a (valid in arithmetic but not printf)
  // Bash parses the number before # and returns that with error status
  if (/^\d+#/.test(arg)) {
    lastParseError = true;
    const match = arg.match(/^(\d+)#/);
    return match ? parseInt(match[1], 10) : 0;
  }

  // Check for invalid characters
  if (arg !== "" && !/^-?\d+$/.test(arg)) {
    lastParseError = true;
    // Try to parse what we can (bash behavior: 3abc -> 3, but sets error)
    const num = parseInt(arg, 10);
    return Number.isNaN(num) ? 0 : num;
  }

  // Set error flag if there was trailing whitespace
  if (hasTrailingWhitespace) lastParseError = true;

  return parseInt(arg, 10) || 0;
}

/**
 * Format an integer with precision support (bash-style: precision means min digits)
 */
function formatInteger(spec: string, num: number): string {
  // Parse the spec: %[flags][width][.precision]d
  // Note: %6.d means precision 0 (dot with no digits)
  const match = spec.match(/^%([- +#0']*)(\d*)(\.(\d*))?[diu]$/);
  if (!match) {
    return sprintf(spec.replace(/\.\d*/, ""), num);
  }

  const flags = match[1] || "";
  const width = match[2] ? parseInt(match[2], 10) : 0;
  // If there's a dot (match[3]), precision is match[4] or 0 if empty
  const precision =
    match[3] !== undefined ? (match[4] ? parseInt(match[4], 10) : 0) : -1;

  const negative = num < 0;
  const absNum = Math.abs(num);
  let numStr = String(absNum);

  // Apply precision (minimum digits with zero-padding)
  if (precision >= 0) {
    numStr = numStr.padStart(precision, "0");
  }

  // Add sign
  let sign = "";
  if (negative) {
    sign = "-";
  } else if (flags.includes("+")) {
    sign = "+";
  } else if (flags.includes(" ")) {
    sign = " ";
  }

  let result = sign + numStr;

  // Apply width
  if (width > result.length) {
    if (flags.includes("-")) {
      result = result.padEnd(width, " ");
    } else if (flags.includes("0") && precision < 0) {
      // Zero-pad only if no precision specified
      result = sign + numStr.padStart(width - sign.length, "0");
    } else {
      result = result.padStart(width, " ");
    }
  }

  return result;
}

/**
 * Format octal with precision support
 */
function formatOctal(spec: string, num: number): string {
  const match = spec.match(/^%([- +#0']*)(\d*)(\.(\d*))?o$/);
  if (!match) {
    return sprintf(spec, num);
  }

  const flags = match[1] || "";
  const width = match[2] ? parseInt(match[2], 10) : 0;
  const precision =
    match[3] !== undefined ? (match[4] ? parseInt(match[4], 10) : 0) : -1;

  let numStr = Math.abs(num).toString(8);

  if (precision >= 0) {
    numStr = numStr.padStart(precision, "0");
  }

  if (flags.includes("#") && !numStr.startsWith("0")) {
    numStr = `0${numStr}`;
  }

  let result = numStr;
  if (width > result.length) {
    if (flags.includes("-")) {
      result = result.padEnd(width, " ");
    } else if (flags.includes("0") && precision < 0) {
      result = result.padStart(width, "0");
    } else {
      result = result.padStart(width, " ");
    }
  }

  return result;
}

/**
 * Format hex with precision support
 */
function formatHex(spec: string, num: number): string {
  const isUpper = spec.includes("X");
  const match = spec.match(/^%([- +#0']*)(\d*)(\.(\d*))?[xX]$/);
  if (!match) {
    return sprintf(spec, num);
  }

  const flags = match[1] || "";
  const width = match[2] ? parseInt(match[2], 10) : 0;
  const precision =
    match[3] !== undefined ? (match[4] ? parseInt(match[4], 10) : 0) : -1;

  let numStr = Math.abs(num).toString(16);
  if (isUpper) numStr = numStr.toUpperCase();

  if (precision >= 0) {
    numStr = numStr.padStart(precision, "0");
  }

  let prefix = "";
  if (flags.includes("#") && num !== 0) {
    prefix = isUpper ? "0X" : "0x";
  }

  let result = prefix + numStr;
  if (width > result.length) {
    if (flags.includes("-")) {
      result = result.padEnd(width, " ");
    } else if (flags.includes("0") && precision < 0) {
      result = prefix + numStr.padStart(width - prefix.length, "0");
    } else {
      result = result.padStart(width, " ");
    }
  }

  return result;
}

/**
 * Shell-quote a string (for %q)
 * Bash uses backslash escaping for printable chars, $'...' only for control chars
 */
function shellQuote(str: string): string {
  if (str === "") {
    return "''";
  }
  // If string contains only safe characters, return as-is
  if (/^[a-zA-Z0-9_./-]+$/.test(str)) {
    return str;
  }

  // Check if we need $'...' syntax (for control chars, newlines, high bytes, etc.)
  // High bytes (0x80-0xff) need escaping as they are not printable ASCII
  const needsDollarQuote = /[\x00-\x1f\x7f-\xff]/.test(str);

  if (needsDollarQuote) {
    // Use $'...' format with escape sequences for control characters
    let result = "$'";
    for (const char of str) {
      const code = char.charCodeAt(0);
      if (char === "'") {
        result += "\\'";
      } else if (char === "\\") {
        result += "\\\\";
      } else if (char === "\n") {
        result += "\\n";
      } else if (char === "\t") {
        result += "\\t";
      } else if (char === "\r") {
        result += "\\r";
      } else if (char === "\x07") {
        result += "\\a";
      } else if (char === "\b") {
        result += "\\b";
      } else if (char === "\f") {
        result += "\\f";
      } else if (char === "\v") {
        result += "\\v";
      } else if (char === "\x1b") {
        result += "\\E";
      } else if (code < 32 || (code >= 127 && code <= 255)) {
        // Use octal escapes like bash does for control chars and high bytes (0x80-0xFF)
        // Valid Unicode chars (code > 255) are left unescaped
        result += `\\${code.toString(8).padStart(3, "0")}`;
      } else if (char === '"') {
        result += '\\"';
      } else {
        result += char;
      }
    }
    result += "'";
    return result;
  }

  // Use backslash escaping for printable special characters
  let result = "";
  for (const char of str) {
    // Characters that need backslash escaping
    if (" \t|&;<>()$`\\\"'*?[#~=%!{}".includes(char)) {
      result += `\\${char}`;
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * Format a string with %s, respecting width and precision
 * Note: %06s should NOT zero-pad (0 flag is ignored for strings)
 */
function formatString(spec: string, str: string): string {
  const match = spec.match(/^%(-?)(\d*)(\.(\d*))?s$/);
  if (!match) {
    return sprintf(spec.replace(/0+(?=\d)/, ""), str);
  }

  const leftJustify = match[1] === "-";
  const widthVal = match[2] ? parseInt(match[2], 10) : 0;
  // Precision for strings means max length (truncate)
  // %.s or %0.s means precision 0 (empty string)
  const precision =
    match[3] !== undefined ? (match[4] ? parseInt(match[4], 10) : 0) : -1;

  // Use shared width/alignment utility
  const width = leftJustify ? -widthVal : widthVal;
  return applyWidth(str, width, precision);
}

/**
 * Format a quoted string with %q, respecting width
 */
function formatQuoted(spec: string, str: string): string {
  const quoted = shellQuote(str);

  const match = spec.match(/^%(-?)(\d*)q$/);
  if (!match) {
    return quoted;
  }

  const leftJustify = match[1] === "-";
  const width = match[2] ? parseInt(match[2], 10) : 0;

  let result = quoted;
  if (width > result.length) {
    if (leftJustify) {
      result = result.padEnd(width, " ");
    } else {
      result = result.padStart(width, " ");
    }
  }

  return result;
}

/**
 * Format floating point with default precision and # flag support
 */
function formatFloat(spec: string, specifier: string, num: number): string {
  // Parse spec to extract flags, width, precision
  const match = spec.match(/^%([- +#0']*)(\d*)(\.(\d*))?[eEfFgG]$/);
  if (!match) {
    return sprintf(spec, num);
  }

  const flags = match[1] || "";
  const width = match[2] ? parseInt(match[2], 10) : 0;
  // Default precision is 6 for f/e, but %.f means precision 0
  const precision =
    match[3] !== undefined ? (match[4] ? parseInt(match[4], 10) : 0) : 6;

  let result: string;
  const lowerSpec = specifier.toLowerCase();

  if (lowerSpec === "e") {
    result = num.toExponential(precision);
    // Ensure exponent has at least 2 digits (e+0 -> e+00)
    result = result.replace(/e([+-])(\d)$/, "e$10$2");
    if (specifier === "E") result = result.toUpperCase();
  } else if (lowerSpec === "f") {
    result = num.toFixed(precision);
    // # flag for %f: always show decimal point even if precision is 0
    if (flags.includes("#") && precision === 0 && !result.includes(".")) {
      result += ".";
    }
  } else if (lowerSpec === "g") {
    // %g: use shortest representation between %e and %f
    result = num.toPrecision(precision || 1);
    // # flag: keep trailing zeros (do not omit zeros in fraction)
    // Without #: remove trailing zeros and unnecessary decimal point
    if (!flags.includes("#")) {
      result = result.replace(/\.?0+$/, "");
      result = result.replace(/\.?0+e/, "e");
    }
    // Ensure exponent has at least 2 digits if present
    result = result.replace(/e([+-])(\d)$/, "e$10$2");
    if (specifier === "G") result = result.toUpperCase();
  } else {
    result = num.toString();
  }

  // Handle sign
  if (num >= 0) {
    if (flags.includes("+")) {
      result = `+${result}`;
    } else if (flags.includes(" ")) {
      result = ` ${result}`;
    }
  }

  // Handle width
  if (width > result.length) {
    if (flags.includes("-")) {
      result = result.padEnd(width, " ");
    } else if (flags.includes("0")) {
      const signPrefix = result.match(/^[+ -]/)?.[0] || "";
      const numPart = signPrefix ? result.slice(1) : result;
      result = signPrefix + numPart.padStart(width - signPrefix.length, "0");
    } else {
      result = result.padStart(width, " ");
    }
  }

  return result;
}

/**
 * Process escape sequences in %b argument
 * Similar to processEscapes but with additional features:
 * - \c stops output (discards rest of string and rest of format)
 * - \uHHHH unicode escapes
 * - Octal can be \NNN or \0NNN
 * Returns {value, stopped} - stopped is true if \c was encountered
 */
function processBEscapes(str: string): { value: string; stopped: boolean } {
  let result = "";
  let i = 0;

  while (i < str.length) {
    if (str[i] === "\\" && i + 1 < str.length) {
      const next = str[i + 1];
      switch (next) {
        case "n":
          result += "\n";
          i += 2;
          break;
        case "t":
          result += "\t";
          i += 2;
          break;
        case "r":
          result += "\r";
          i += 2;
          break;
        case "\\":
          result += "\\";
          i += 2;
          break;
        case "a":
          result += "\x07";
          i += 2;
          break;
        case "b":
          result += "\b";
          i += 2;
          break;
        case "f":
          result += "\f";
          i += 2;
          break;
        case "v":
          result += "\v";
          i += 2;
          break;
        case "c":
          // \c stops all output - return immediately with stopped flag
          return { value: result, stopped: true };
        case "x": {
          // \xHH - hex escape (1-2 hex digits)
          // Collect consecutive \xHH escapes and decode as UTF-8 with error recovery
          const bytes: number[] = [];
          let j = i;
          while (j + 1 < str.length && str[j] === "\\" && str[j + 1] === "x") {
            let hex = "";
            let k = j + 2;
            while (k < str.length && k < j + 4 && /[0-9a-fA-F]/.test(str[k])) {
              hex += str[k];
              k++;
            }
            if (hex) {
              bytes.push(parseInt(hex, 16));
              j = k;
            } else {
              break;
            }
          }

          if (bytes.length > 0) {
            // Decode bytes as UTF-8 with error recovery
            result += decodeUtf8WithRecovery(bytes);
            i = j;
          } else {
            result += "\\x";
            i += 2;
          }
          break;
        }
        case "u": {
          // \uHHHH - unicode escape (1-4 hex digits)
          let hex = "";
          let j = i + 2;
          while (j < str.length && j < i + 6 && /[0-9a-fA-F]/.test(str[j])) {
            hex += str[j];
            j++;
          }
          if (hex) {
            result += String.fromCodePoint(parseInt(hex, 16));
            i = j;
          } else {
            result += "\\u";
            i += 2;
          }
          break;
        }
        case "0": {
          // \0NNN - octal escape (0-3 digits after the 0)
          let octal = "";
          let j = i + 2;
          while (j < str.length && j < i + 5 && /[0-7]/.test(str[j])) {
            octal += str[j];
            j++;
          }
          if (octal) {
            result += String.fromCharCode(parseInt(octal, 8));
          } else {
            result += "\0"; // Just \0 is NUL
          }
          i = j;
          break;
        }
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7": {
          // \NNN - octal escape (1-3 digits, no leading 0)
          let octal = "";
          let j = i + 1;
          while (j < str.length && j < i + 4 && /[0-7]/.test(str[j])) {
            octal += str[j];
            j++;
          }
          result += String.fromCharCode(parseInt(octal, 8));
          i = j;
          break;
        }
        default:
          // Unknown escape, keep as-is
          result += str[i];
          i++;
      }
    } else {
      result += str[i];
      i++;
    }
  }

  return { value: result, stopped: false };
}

/**
 * Format a Unix timestamp using strftime-like format directives.
 * Uses the provided timezone if set, otherwise uses system default.
 */
function formatStrftime(
  format: string,
  timestamp: number,
  tz?: string,
): string {
  const date = new Date(timestamp * 1000);

  // Build result by replacing format directives
  let result = "";
  let i = 0;

  while (i < format.length) {
    if (format[i] === "%" && i + 1 < format.length) {
      const directive = format[i + 1];
      const formatted = formatStrftimeDirective(date, directive, tz);
      if (formatted !== null) {
        result += formatted;
        i += 2;
      } else {
        // Unknown directive, keep as-is
        result += format[i];
        i++;
      }
    } else {
      result += format[i];
      i++;
    }
  }

  return result;
}

/**
 * Get date/time parts in a specific timezone using Intl.DateTimeFormat.
 * Returns an object with year, month, day, hour, minute, second, weekday.
 */
function getDatePartsInTimezone(
  date: Date,
  tz?: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
    timeZone: tz,
  };

  try {
    const formatter = new Intl.DateTimeFormat("en-US", options);
    const parts = formatter.formatToParts(date);

    const getValue = (type: string) =>
      parts.find((p) => p.type === type)?.value || "";

    const year = parseInt(getValue("year"), 10);
    const month = parseInt(getValue("month"), 10);
    const day = parseInt(getValue("day"), 10);
    let hour = parseInt(getValue("hour"), 10);
    // Handle edge case where hour12: false still shows 24 as 00
    if (hour === 24) hour = 0;
    const minute = parseInt(getValue("minute"), 10);
    const second = parseInt(getValue("second"), 10);

    // Convert weekday name to number (0-6, Sunday=0)
    const weekdayName = getValue("weekday");
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const weekday = weekdayMap[weekdayName] ?? date.getDay();

    return { year, month, day, hour, minute, second, weekday };
  } catch {
    // Fallback to local time if timezone is invalid
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      weekday: date.getDay(),
    };
  }
}

/**
 * Format a single strftime directive.
 * Returns null for unknown directives.
 */
function formatStrftimeDirective(
  date: Date,
  directive: string,
  tz?: string,
): string | null {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");

  // Get date parts in the specified timezone
  const parts = getDatePartsInTimezone(date, tz);

  switch (directive) {
    // Date components
    case "Y": // Full year (e.g., 2019)
      return String(parts.year);
    case "y": // Year without century (00-99)
      return pad2(parts.year % 100);
    case "C": // Century (e.g., 20)
      return String(Math.floor(parts.year / 100));
    case "m": // Month (01-12)
      return pad2(parts.month);
    case "d": // Day of month (01-31)
      return pad2(parts.day);
    case "e": // Day of month, space-padded ( 1-31)
      return String(parts.day).padStart(2, " ");
    case "j": // Day of year (001-366)
      return pad3(getDayOfYearForParts(parts.year, parts.month, parts.day));

    // Time components
    case "H": // Hour (00-23)
      return pad2(parts.hour);
    case "I": // Hour (01-12)
      return pad2(((parts.hour + 11) % 12) + 1);
    case "M": // Minute (00-59)
      return pad2(parts.minute);
    case "S": // Second (00-59)
      return pad2(parts.second);
    case "p": // AM/PM
      return parts.hour < 12 ? "AM" : "PM";
    case "P": // am/pm
      return parts.hour < 12 ? "am" : "pm";

    // Weekday
    case "A": // Full weekday name
      return [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ][parts.weekday];
    case "a": // Abbreviated weekday name
      return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parts.weekday];
    case "u": // Day of week (1-7, Monday=1)
      return String(parts.weekday === 0 ? 7 : parts.weekday);
    case "w": // Day of week (0-6, Sunday=0)
      return String(parts.weekday);

    // Month names
    case "B": // Full month name
      return [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ][parts.month - 1];
    case "b": // Abbreviated month name
    case "h": // Same as %b
      return [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ][parts.month - 1];

    // Week number
    case "U": // Week number (Sunday as first day, 00-53)
      return pad2(getWeekNumberForParts(parts.year, parts.month, parts.day, 0));
    case "W": // Week number (Monday as first day, 00-53)
      return pad2(getWeekNumberForParts(parts.year, parts.month, parts.day, 1));
    case "V": // ISO week number (01-53)
      return pad2(getISOWeekNumberForParts(parts.year, parts.month, parts.day));

    // Combined formats
    case "D": // %m/%d/%y
      return `${pad2(parts.month)}/${pad2(parts.day)}/${pad2(parts.year % 100)}`;
    case "F": // %Y-%m-%d
      return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
    case "T": // %H:%M:%S
      return `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
    case "R": // %H:%M
      return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
    case "r": // %I:%M:%S %p
      return `${pad2(((parts.hour + 11) % 12) + 1)}:${pad2(parts.minute)}:${pad2(parts.second)} ${parts.hour < 12 ? "AM" : "PM"}`;

    // Timezone
    case "z": // Timezone offset (+/-HHMM)
      return getTimezoneOffset(date, tz);
    case "Z": // Timezone name
      return getTimezoneName(date, tz);

    // Misc
    case "n": // Newline
      return "\n";
    case "t": // Tab
      return "\t";
    case "%": // Literal %
      return "%";
    case "s": // Unix timestamp
      return String(Math.floor(date.getTime() / 1000));

    default:
      return null;
  }
}

/**
 * Get timezone offset string (+/-HHMM) for a specific timezone.
 */
function getTimezoneOffset(date: Date, tz?: string): string {
  const pad2 = (n: number) => String(n).padStart(2, "0");

  if (!tz) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const hours = Math.floor(Math.abs(offset) / 60);
    const mins = Math.abs(offset) % 60;
    return `${sign}${pad2(hours)}${pad2(mins)}`;
  }

  try {
    // Get offset by comparing UTC time with timezone time
    const utcFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const tzFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const utcParts = utcFormatter.formatToParts(date);
    const tzParts = tzFormatter.formatToParts(date);

    const getVal = (parts: Intl.DateTimeFormatPart[], type: string): number => {
      let val = parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
      if (type === "hour" && val === 24) val = 0;
      return val;
    };

    const utcMins =
      getVal(utcParts, "day") * 24 * 60 +
      getVal(utcParts, "hour") * 60 +
      getVal(utcParts, "minute");
    const tzMins =
      getVal(tzParts, "day") * 24 * 60 +
      getVal(tzParts, "hour") * 60 +
      getVal(tzParts, "minute");

    let offset = tzMins - utcMins;
    // Handle day boundary wrap
    if (offset > 12 * 60) offset -= 24 * 60;
    if (offset < -12 * 60) offset += 24 * 60;

    const sign = offset >= 0 ? "+" : "-";
    const hours = Math.floor(Math.abs(offset) / 60);
    const mins = Math.abs(offset) % 60;
    return `${sign}${pad2(hours)}${pad2(mins)}`;
  } catch {
    // Fallback
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const hours = Math.floor(Math.abs(offset) / 60);
    const mins = Math.abs(offset) % 60;
    return `${sign}${pad2(hours)}${pad2(mins)}`;
  }
}

/**
 * Get timezone name for a specific timezone.
 */
function getTimezoneName(date: Date, tz?: string): string {
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZoneName: "short",
      timeZone: tz,
    };
    return date.toLocaleTimeString("en-US", options).split(" ").pop() || "";
  } catch {
    return (
      date
        .toLocaleTimeString("en-US", { timeZoneName: "short" })
        .split(" ")
        .pop() || ""
    );
  }
}

/**
 * Get day of year (1-366) from year/month/day parts.
 */
function getDayOfYearForParts(
  year: number,
  month: number,
  day: number,
): number {
  // Days in each month (non-leap year)
  const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  // Check for leap year
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (isLeap) daysInMonth[2] = 29;

  let dayOfYear = day;
  for (let m = 1; m < month; m++) {
    dayOfYear += daysInMonth[m];
  }
  return dayOfYear;
}

/**
 * Get week number (0-53) from year/month/day parts.
 * @param firstDay - 0 for Sunday, 1 for Monday
 */
function getWeekNumberForParts(
  year: number,
  month: number,
  day: number,
  firstDay: number,
): number {
  // Get day of week for Jan 1
  const jan1 = new Date(year, 0, 1);
  const yearStartDay = jan1.getDay();
  const dayOfYear = getDayOfYearForParts(year, month, day);

  // Adjust for first day of week
  const daysBeforeFirstWeek = (7 + yearStartDay - firstDay) % 7;
  if (dayOfYear <= daysBeforeFirstWeek) {
    return 0;
  }
  return Math.floor((dayOfYear - 1 - daysBeforeFirstWeek) / 7) + 1;
}

/**
 * Get ISO week number (1-53) from year/month/day parts.
 * Week 1 is the week containing January 4th
 */
function getISOWeekNumberForParts(
  year: number,
  month: number,
  day: number,
): number {
  // Create a date object for calculations
  const tempDate = new Date(year, month - 1, day);
  tempDate.setHours(0, 0, 0, 0);
  // Set to Thursday in current week (ISO weeks start on Monday)
  tempDate.setDate(tempDate.getDate() + 3 - ((tempDate.getDay() + 6) % 7));
  // Get first Thursday of year
  const firstThursday = new Date(tempDate.getFullYear(), 0, 4);
  firstThursday.setDate(
    firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7),
  );
  // Calculate week number
  const diff = tempDate.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}

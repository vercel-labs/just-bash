import { sprintf } from "sprintf-js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";

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

      do {
        const { result, argsConsumed } = formatOnce(
          processedFormat,
          formatArgs,
          argPos,
        );
        output += result;
        argPos += argsConsumed;
      } while (argPos < formatArgs.length && argPos > 0);

      // If no args were consumed but format had no specifiers, just output format
      if (argPos === 0 && formatArgs.length > 0) {
        // Format had no specifiers - output once
      }

      // If -v was specified, store in variable instead of printing
      if (targetVar) {
        ctx.env[targetVar] = output;
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      return { stdout: output, stderr: "", exitCode: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: "", stderr: `printf: ${message}\n`, exitCode: 1 };
    }
  },
};

/**
 * Process escape sequences in the format string
 */
function processEscapes(str: string): string {
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
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7": {
          // Octal escape sequence
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
        case "x":
          // Hex escape sequence
          if (
            i + 3 < str.length &&
            /[0-9a-fA-F]{2}/.test(str.slice(i + 2, i + 4))
          ) {
            result += String.fromCharCode(
              parseInt(str.slice(i + 2, i + 4), 16),
            );
            i += 4;
          } else {
            result += str[i];
            i++;
          }
          break;
        default:
          result += str[i];
          i++;
      }
    } else {
      result += str[i];
      i++;
    }
  }

  return result;
}

/**
 * Format the string once, consuming args starting at argPos.
 * Returns the formatted result and number of args consumed.
 */
function formatOnce(
  format: string,
  args: string[],
  argPos: number,
): { result: string; argsConsumed: number } {
  let result = "";
  let i = 0;
  let argsConsumed = 0;

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
      result += formatValue(adjustedSpec, specifier, arg);
    } else {
      result += format[i];
      i++;
    }
  }

  return { result, argsConsumed };
}

/**
 * Format a single value with the given specifier
 */
function formatValue(spec: string, specifier: string, arg: string): string {
  switch (specifier) {
    case "d":
    case "i": {
      const num = parseIntArg(arg);
      return formatInteger(spec, num);
    }
    case "o": {
      const num = parseIntArg(arg);
      return formatOctal(spec, num);
    }
    case "u": {
      const num = Math.abs(parseIntArg(arg));
      return formatInteger(spec.replace("u", "d"), num);
    }
    case "x":
    case "X": {
      const num = parseIntArg(arg);
      return formatHex(spec, num);
    }
    case "e":
    case "E":
    case "f":
    case "F":
    case "g":
    case "G": {
      const num = parseFloat(arg) || 0;
      return sprintf(spec, num);
    }
    case "c":
      // Character - take first char
      return arg.charAt(0) || "";
    case "s":
      return sprintf(spec, arg);
    case "q":
      // Shell quoting
      return shellQuote(arg);
    case "b":
      // Interpret escape sequences in arg
      return processEscapes(arg);
    default:
      return sprintf(spec, arg);
  }
}

/**
 * Parse an integer argument, handling bash-style character notation ('a' = 97)
 */
function parseIntArg(arg: string): number {
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
  // Handle hex
  if (arg.startsWith("0x") || arg.startsWith("0X")) {
    return parseInt(arg, 16) || 0;
  }
  // Handle octal
  if (arg.startsWith("0") && arg.length > 1 && /^0[0-7]+$/.test(arg)) {
    return parseInt(arg, 8) || 0;
  }
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
  const precision = match[3] !== undefined ? (match[4] ? parseInt(match[4], 10) : 0) : -1;

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
  const precision = match[3] !== undefined ? (match[4] ? parseInt(match[4], 10) : 0) : -1;

  let numStr = Math.abs(num).toString(8);

  if (precision >= 0) {
    numStr = numStr.padStart(precision, "0");
  }

  if (flags.includes("#") && !numStr.startsWith("0")) {
    numStr = "0" + numStr;
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
  const precision = match[3] !== undefined ? (match[4] ? parseInt(match[4], 10) : 0) : -1;

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
 * Bash uses backslash escaping for printable special chars, $'...' for control chars
 */
function shellQuote(str: string): string {
  if (str === "") {
    return "''";
  }
  // If string contains only safe characters, return as-is
  if (/^[a-zA-Z0-9_./-]+$/.test(str)) {
    return str;
  }

  // Check if we need $'...' syntax (for control chars, newlines, etc.)
  const needsDollarQuote = /[\x00-\x1f\x7f]/.test(str);

  if (needsDollarQuote) {
    // Use $'...' syntax for strings with control characters
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
      } else if (code < 32 || code > 126) {
        result += "\\x" + code.toString(16).padStart(2, "0");
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
      result += "\\" + char;
    } else {
      result += char;
    }
  }
  return result;
}

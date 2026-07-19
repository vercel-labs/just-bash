/**
 * Prompt expansion
 *
 * Handles prompt escape sequences for ${var@P} transformation and PS1/PS2/PS3/PS4.
 */

import { utf8ByteLength } from "../../commands/printf/escapes.js";
import { ExecutionLimitError } from "../errors.js";
import type { InterpreterContext } from "../types.js";

function boundedAppender(maxBytes: number): {
  append: (value: string) => void;
  build: () => string;
} {
  const chunks: string[] = [];
  let bytes = 0;
  return {
    append(value: string): void {
      const valueBytes = utf8ByteLength(value);
      if (valueBytes > maxBytes - bytes) {
        throw new ExecutionLimitError(
          `prompt expansion exceeds string length limit (${maxBytes} bytes)`,
          "string_length",
        );
      }
      if (value) chunks.push(value);
      bytes += valueBytes;
    },
    build: () => chunks.join(""),
  };
}

/**
 * Simple strftime implementation for prompt \D{format}
 * Only supports common format specifiers
 */
function simpleStrftime(format: string, date: Date, maxBytes: number): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");

  // If format is empty, use locale default time format (like %X)
  if (format === "") {
    const h = pad(date.getHours());
    const m = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    return `${h}:${m}:${s}`;
  }

  const result = boundedAppender(maxBytes);
  let i = 0;
  while (i < format.length) {
    if (format[i] === "%") {
      if (i + 1 >= format.length) {
        result.append("%");
        i++;
        continue;
      }
      const spec = format[i + 1];
      switch (spec) {
        case "H":
          result.append(pad(date.getHours()));
          break;
        case "M":
          result.append(pad(date.getMinutes()));
          break;
        case "S":
          result.append(pad(date.getSeconds()));
          break;
        case "d":
          result.append(pad(date.getDate()));
          break;
        case "m":
          result.append(pad(date.getMonth() + 1));
          break;
        case "Y":
          result.append(String(date.getFullYear()));
          break;
        case "y":
          result.append(pad(date.getFullYear() % 100));
          break;
        case "I": {
          let h = date.getHours() % 12;
          if (h === 0) h = 12;
          result.append(pad(h));
          break;
        }
        case "p":
          result.append(date.getHours() < 12 ? "AM" : "PM");
          break;
        case "P":
          result.append(date.getHours() < 12 ? "am" : "pm");
          break;
        case "%":
          result.append("%");
          break;
        case "a": {
          const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          result.append(days[date.getDay()]);
          break;
        }
        case "b": {
          const months = [
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
          ];
          result.append(months[date.getMonth()]);
          break;
        }
        default:
          // Unknown specifier - pass through
          result.append(`%${spec}`);
      }
      i += 2;
    } else {
      result.append(format[i]);
      i++;
    }
  }
  return result.build();
}

/**
 * Expand prompt escape sequences (${var@P} transformation)
 * Interprets backslash escapes used in PS1, PS2, PS3, PS4 prompt strings.
 *
 * Supported escapes:
 * - \a - bell (ASCII 07)
 * - \e - escape (ASCII 033)
 * - \n - newline
 * - \r - carriage return
 * - \\ - literal backslash
 * - \$ - $ for regular user, # for root (always $ here)
 * - \[ and \] - non-printing sequence delimiters (removed)
 * - \u - username
 * - \h - short hostname (up to first .)
 * - \H - full hostname
 * - \w - current working directory
 * - \W - basename of current working directory
 * - \d - date (Weekday Month Day format)
 * - \t - time HH:MM:SS (24-hour)
 * - \T - time HH:MM:SS (12-hour)
 * - \@ - time HH:MM AM/PM (12-hour)
 * - \A - time HH:MM (24-hour)
 * - \D{format} - strftime format
 * - \s - shell name
 * - \v - bash version (major.minor)
 * - \V - bash version (major.minor.patch)
 * - \j - number of jobs
 * - \l - terminal device basename
 * - \# - command number
 * - \! - history number
 * - \NNN - octal character code
 */
export function expandPrompt(ctx: InterpreterContext, value: string): string {
  const result = boundedAppender(ctx.limits.maxStringLength);
  let i = 0;

  // Get environment values for prompt escapes
  const user =
    ctx.state.env.get("USER") || ctx.state.env.get("LOGNAME") || "user";
  const hostname = ctx.state.env.get("HOSTNAME") || "localhost";
  const shortHost = hostname.split(".")[0];
  const pwd = ctx.state.env.get("PWD") || "/";
  const home = ctx.state.env.get("HOME") || "/";

  // Replace $HOME with ~ in pwd for \w
  const tildeExpanded = pwd.startsWith(home)
    ? `~${pwd.slice(home.length)}`
    : pwd;
  const pwdBasename = pwd.split("/").pop() || pwd;

  // Get date/time values
  const now = new Date();
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
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
  ];

  // Command number (we'll use a simple counter from the state if available)
  const cmdNum = ctx.state.env.get("__COMMAND_NUMBER") || "1";

  while (i < value.length) {
    const char = value[i];

    if (char === "\\") {
      if (i + 1 >= value.length) {
        // Trailing backslash
        result.append("\\");
        i++;
        continue;
      }

      const next = value[i + 1];

      // Check for octal escape \NNN (1-3 digits)
      if (next >= "0" && next <= "7") {
        let octalStr = "";
        let j = i + 1;
        while (
          j < value.length &&
          j < i + 4 &&
          value[j] >= "0" &&
          value[j] <= "7"
        ) {
          octalStr += value[j];
          j++;
        }
        // Parse octal, wrap around at 256 (e.g., \555 = 365 octal = 245 decimal, wraps to 109 = 'm')
        const code = Number.parseInt(octalStr, 8) % 256;
        result.append(String.fromCharCode(code));
        i = j;
        continue;
      }

      switch (next) {
        case "\\":
          result.append("\\");
          i += 2;
          break;
        case "a":
          result.append("\x07"); // Bell
          i += 2;
          break;
        case "e":
          result.append("\x1b"); // Escape
          i += 2;
          break;
        case "n":
          result.append("\n");
          i += 2;
          break;
        case "r":
          result.append("\r");
          i += 2;
          break;
        case "$":
          // $ for regular user, # for root - we always use $ since we're not running as root
          result.append("$");
          i += 2;
          break;
        case "[":
        case "]":
          // Non-printing sequence delimiters - just remove them
          i += 2;
          break;
        case "u":
          result.append(user);
          i += 2;
          break;
        case "h":
          result.append(shortHost);
          i += 2;
          break;
        case "H":
          result.append(hostname);
          i += 2;
          break;
        case "w":
          result.append(tildeExpanded);
          i += 2;
          break;
        case "W":
          result.append(pwdBasename);
          i += 2;
          break;
        case "d": {
          // Date: Weekday Month Day
          const dayStr = String(now.getDate()).padStart(2, " ");
          result.append(
            `${weekdays[now.getDay()]} ${months[now.getMonth()]} ${dayStr}`,
          );
          i += 2;
          break;
        }
        case "t": {
          // Time: HH:MM:SS (24-hour)
          const h = String(now.getHours()).padStart(2, "0");
          const m = String(now.getMinutes()).padStart(2, "0");
          const s = String(now.getSeconds()).padStart(2, "0");
          result.append(`${h}:${m}:${s}`);
          i += 2;
          break;
        }
        case "T": {
          // Time: HH:MM:SS (12-hour)
          let h = now.getHours() % 12;
          if (h === 0) h = 12;
          const hStr = String(h).padStart(2, "0");
          const m = String(now.getMinutes()).padStart(2, "0");
          const s = String(now.getSeconds()).padStart(2, "0");
          result.append(`${hStr}:${m}:${s}`);
          i += 2;
          break;
        }
        case "@": {
          // Time: HH:MM AM/PM (12-hour)
          let h = now.getHours() % 12;
          if (h === 0) h = 12;
          const hStr = String(h).padStart(2, "0");
          const m = String(now.getMinutes()).padStart(2, "0");
          const ampm = now.getHours() < 12 ? "AM" : "PM";
          result.append(`${hStr}:${m} ${ampm}`);
          i += 2;
          break;
        }
        case "A": {
          // Time: HH:MM (24-hour)
          const h = String(now.getHours()).padStart(2, "0");
          const m = String(now.getMinutes()).padStart(2, "0");
          result.append(`${h}:${m}`);
          i += 2;
          break;
        }
        case "D":
          // strftime format: \D{format}
          if (i + 2 < value.length && value[i + 2] === "{") {
            const closeIdx = value.indexOf("}", i + 3);
            if (closeIdx !== -1) {
              const format = value.slice(i + 3, closeIdx);
              // Simple strftime implementation for common formats
              result.append(
                simpleStrftime(format, now, ctx.limits.maxStringLength),
              );
              i = closeIdx + 1;
            } else {
              // No closing brace - treat literally
              result.append("\\D");
              i += 2;
            }
          } else {
            result.append("\\D");
            i += 2;
          }
          break;
        case "s":
          // Shell name
          result.append("bash");
          i += 2;
          break;
        case "v":
          // Version: major.minor
          result.append("5.0"); // Pretend to be bash 5.0
          i += 2;
          break;
        case "V":
          // Version: major.minor.patch
          result.append("5.0.0"); // Pretend to be bash 5.0.0
          i += 2;
          break;
        case "j":
          // Number of jobs - we don't track jobs, so return 0
          result.append("0");
          i += 2;
          break;
        case "l":
          // Terminal device basename - we're not in a real terminal
          result.append("tty");
          i += 2;
          break;
        case "#":
          // Command number
          result.append(cmdNum);
          i += 2;
          break;
        case "!":
          // History number - same as command number
          result.append(cmdNum);
          i += 2;
          break;
        case "x":
          // \xNN hex literals are NOT supported in bash prompt expansion
          // Just pass through as literal
          result.append("\\x");
          i += 2;
          break;
        default:
          // Unknown escape - pass through as literal
          result.append(`\\${next}`);
          i += 2;
      }
    } else {
      result.append(char);
      i++;
    }
  }

  return result.build();
}

import type { AwkContext } from "./types.js";

// String functions for awk

export function awkMatch(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): number {
  if (args.length < 2) {
    ctx.RSTART = 0;
    ctx.RLENGTH = -1;
    return 0;
  }
  const str = String(evaluateExpr(args[0], ctx));
  let pattern = args[1].trim();

  // Remove surrounding slashes if present
  if (pattern.startsWith("/") && pattern.endsWith("/")) {
    pattern = pattern.slice(1, -1);
  }

  try {
    const regex = new RegExp(pattern);
    const match = regex.exec(str);
    if (match) {
      ctx.RSTART = match.index + 1; // 1-indexed
      ctx.RLENGTH = match[0].length;
      return ctx.RSTART;
    }
  } catch {
    // Invalid regex
  }

  ctx.RSTART = 0;
  ctx.RLENGTH = -1;
  return 0;
}

export function awkGensub(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): string {
  if (args.length < 3) return "";

  let pattern = String(evaluateExpr(args[0], ctx));
  const replacement = String(evaluateExpr(args[1], ctx));
  const how = String(evaluateExpr(args[2], ctx));
  const target =
    args.length >= 4 ? String(evaluateExpr(args[3], ctx)) : ctx.line;

  // Remove surrounding slashes if present
  if (pattern.startsWith("/") && pattern.endsWith("/")) {
    pattern = pattern.slice(1, -1);
  }

  try {
    // Determine if global or specific occurrence
    const isGlobal = how.toLowerCase() === "g";
    const occurrenceNum = isGlobal ? 0 : parseInt(how, 10) || 1;

    if (isGlobal) {
      const regex = new RegExp(pattern, "g");
      return target.replace(regex, (match, ...groups) => {
        return processGensub(replacement, match, groups.slice(0, -2));
      });
    } else {
      // Replace Nth occurrence
      let count = 0;
      const regex = new RegExp(pattern, "g");
      return target.replace(regex, (match, ...groups) => {
        count++;
        if (count === occurrenceNum) {
          return processGensub(replacement, match, groups.slice(0, -2));
        }
        return match;
      });
    }
  } catch {
    return target;
  }
}

// Process gensub replacement with backreferences
function processGensub(
  replacement: string,
  match: string,
  groups: string[],
): string {
  let result = "";
  let i = 0;
  while (i < replacement.length) {
    if (replacement[i] === "\\" && i + 1 < replacement.length) {
      const next = replacement[i + 1];
      if (next === "&") {
        result += "&";
        i += 2;
      } else if (next === "0") {
        result += match;
        i += 2;
      } else if (next >= "1" && next <= "9") {
        const idx = parseInt(next, 10) - 1;
        result += groups[idx] || "";
        i += 2;
      } else if (next === "n") {
        result += "\n";
        i += 2;
      } else if (next === "t") {
        result += "\t";
        i += 2;
      } else {
        result += next;
        i += 2;
      }
    } else if (replacement[i] === "&") {
      result += match;
      i++;
    } else {
      result += replacement[i];
      i++;
    }
  }
  return result;
}

export function awkLength(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): number {
  if (args.length === 0) {
    return ctx.line.length;
  }
  const str = String(evaluateExpr(args[0], ctx));
  return str.length;
}

export function awkSubstr(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): string {
  if (args.length < 2) return "";
  const str = String(evaluateExpr(args[0], ctx));
  const start = Number(evaluateExpr(args[1], ctx)) - 1; // awk is 1-indexed
  if (args.length >= 3) {
    const len = Number(evaluateExpr(args[2], ctx));
    return str.substr(Math.max(0, start), len);
  }
  return str.substr(Math.max(0, start));
}

export function awkIndex(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): number {
  if (args.length < 2) return 0;
  const str = String(evaluateExpr(args[0], ctx));
  const target = String(evaluateExpr(args[1], ctx));
  const idx = str.indexOf(target);
  return idx === -1 ? 0 : idx + 1; // awk is 1-indexed
}

export function awkSplit(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): number {
  if (args.length < 2) return 0;
  const str = String(evaluateExpr(args[0], ctx));
  const arrayName = args[1].trim();
  const sep = args.length >= 3 ? String(evaluateExpr(args[2], ctx)) : ctx.FS;

  const parts = str.split(sep === " " ? /\s+/ : sep);

  // Initialize array if needed
  if (!ctx.arrays[arrayName]) {
    ctx.arrays[arrayName] = {};
  }

  // Clear array and populate with split results (1-indexed)
  ctx.arrays[arrayName] = {};
  for (let i = 0; i < parts.length; i++) {
    ctx.arrays[arrayName][String(i + 1)] = parts[i];
  }

  return parts.length;
}

export function awkSub(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): number {
  if (args.length < 2) return 0;
  const pattern = String(evaluateExpr(args[0], ctx));
  const replacement = String(evaluateExpr(args[1], ctx));
  const targetVar = args.length >= 3 ? args[2].trim() : "$0";

  let target: string;
  if (targetVar === "$0") {
    target = ctx.line;
  } else if (targetVar.startsWith("$")) {
    const idx = parseInt(targetVar.slice(1), 10) - 1;
    target = ctx.fields[idx] || "";
  } else {
    target = String(ctx.vars[targetVar] ?? "");
  }

  const regex = new RegExp(pattern);
  const newTarget = target.replace(regex, replacement);
  const changed = newTarget !== target ? 1 : 0;

  // Update the target
  if (targetVar === "$0") {
    ctx.line = newTarget;
  } else if (targetVar.startsWith("$")) {
    const idx = parseInt(targetVar.slice(1), 10) - 1;
    ctx.fields[idx] = newTarget;
  } else {
    ctx.vars[targetVar] = newTarget;
  }

  return changed;
}

export function awkGsub(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): number {
  if (args.length < 2) return 0;
  const pattern = String(evaluateExpr(args[0], ctx));
  const replacement = String(evaluateExpr(args[1], ctx));
  const targetVar = args.length >= 3 ? args[2].trim() : "$0";

  let target: string;
  if (targetVar === "$0") {
    target = ctx.line;
  } else if (targetVar.startsWith("$")) {
    const idx = parseInt(targetVar.slice(1), 10) - 1;
    target = ctx.fields[idx] || "";
  } else {
    target = String(ctx.vars[targetVar] ?? "");
  }

  const regex = new RegExp(pattern, "g");
  const matches = target.match(regex);
  const count = matches ? matches.length : 0;
  const newTarget = target.replace(regex, replacement);

  // Update the target
  if (targetVar === "$0") {
    ctx.line = newTarget;
  } else if (targetVar.startsWith("$")) {
    const idx = parseInt(targetVar.slice(1), 10) - 1;
    ctx.fields[idx] = newTarget;
  } else {
    ctx.vars[targetVar] = newTarget;
  }

  return count;
}

export function awkTolower(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): string {
  if (args.length === 0) return "";
  const str = String(evaluateExpr(args[0], ctx));
  return str.toLowerCase();
}

export function awkToupper(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): string {
  if (args.length === 0) return "";
  const str = String(evaluateExpr(args[0], ctx));
  return str.toUpperCase();
}

export function awkSprintf(
  args: string[],
  ctx: AwkContext,
  evaluateExpr: (expr: string, ctx: AwkContext) => string | number,
): string {
  if (args.length === 0) return "";
  const format = String(evaluateExpr(args[0], ctx));
  const values = args.slice(1);

  let valueIdx = 0;
  let result = "";
  let i = 0;

  while (i < format.length) {
    if (format[i] === "%" && i + 1 < format.length) {
      // Parse format specifier: %[flags][width][.precision]specifier
      let j = i + 1;
      // Skip flags
      while (j < format.length && /[-+ #0]/.test(format[j])) j++;
      // Skip width
      while (j < format.length && /\d/.test(format[j])) j++;
      // Skip precision
      if (format[j] === ".") {
        j++;
        while (j < format.length && /\d/.test(format[j])) j++;
      }

      const spec = format[j];
      if (spec === "s" || spec === "d" || spec === "i" || spec === "f") {
        const val = values[valueIdx] ? evaluateExpr(values[valueIdx], ctx) : "";
        result += String(val);
        valueIdx++;
        i = j + 1;
      } else if (spec === "%") {
        result += "%";
        i = j + 1;
      } else {
        result += format[i++];
      }
    } else if (format[i] === "\\" && i + 1 < format.length) {
      const esc = format[i + 1];
      if (esc === "n") result += "\n";
      else if (esc === "t") result += "\t";
      else if (esc === "r") result += "\r";
      else result += esc;
      i += 2;
    } else {
      result += format[i++];
    }
  }

  return result;
}

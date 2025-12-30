/**
 * AWK Built-in Functions
 *
 * Implementation of AWK built-in functions for the AST-based interpreter.
 */

import type { AwkExpr } from "./ast.js";
import type { AwkRuntimeContext } from "./interpreter/context.js";
import type { AwkValue } from "./interpreter/types.js";

/**
 * Interface for evaluating expressions (passed from interpreter)
 */
export interface AwkEvaluator {
  evalExpr: (expr: AwkExpr) => Promise<AwkValue>;
}

export type AwkBuiltinFn = (
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
) => AwkValue | Promise<AwkValue>;

// Helper functions for type conversion
function toNumber(val: AwkValue): number {
  if (typeof val === "number") return val;
  const n = parseFloat(val);
  return Number.isNaN(n) ? 0 : n;
}

function toAwkString(val: AwkValue): string {
  if (typeof val === "string") return val;
  if (Number.isInteger(val)) return String(val);
  return String(val);
}

// ─── String Functions ───────────────────────────────────────────

async function awkLength(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) {
    return ctx.line.length;
  }
  const str = toAwkString(await evaluator.evalExpr(args[0]));
  return str.length;
}

async function awkSubstr(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (args.length < 2) return "";
  const str = toAwkString(await evaluator.evalExpr(args[0]));
  const start = Math.floor(toNumber(await evaluator.evalExpr(args[1]))) - 1;

  if (args.length >= 3) {
    const len = Math.floor(toNumber(await evaluator.evalExpr(args[2])));
    return str.substr(Math.max(0, start), len);
  }
  return str.substr(Math.max(0, start));
}

async function awkIndex(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length < 2) return 0;
  const str = toAwkString(await evaluator.evalExpr(args[0]));
  const target = toAwkString(await evaluator.evalExpr(args[1]));
  const idx = str.indexOf(target);
  return idx === -1 ? 0 : idx + 1;
}

async function awkSplit(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length < 2) return 0;
  const str = toAwkString(await evaluator.evalExpr(args[0]));

  const arrayExpr = args[1];
  if (arrayExpr.type !== "variable") {
    return 0;
  }
  const arrayName = arrayExpr.name;

  let sep: string | RegExp = ctx.FS;
  if (args.length >= 3) {
    const sepVal = toAwkString(await evaluator.evalExpr(args[2]));
    sep = sepVal === " " ? /\s+/ : sepVal;
  } else if (ctx.FS === " ") {
    sep = /\s+/;
  }

  const parts = str.split(sep);

  ctx.arrays[arrayName] = {};
  for (let i = 0; i < parts.length; i++) {
    ctx.arrays[arrayName][String(i + 1)] = parts[i];
  }

  return parts.length;
}

async function awkSub(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length < 2) return 0;

  let pattern: string;
  if (args[0].type === "regex") {
    pattern = args[0].pattern;
  } else {
    pattern = toAwkString(await evaluator.evalExpr(args[0]));
    if (pattern.startsWith("/") && pattern.endsWith("/")) {
      pattern = pattern.slice(1, -1);
    }
  }

  const replacement = toAwkString(await evaluator.evalExpr(args[1]));

  let targetName = "$0";
  if (args.length >= 3) {
    const targetExpr = args[2];
    if (targetExpr.type === "variable") {
      targetName = targetExpr.name;
    } else if (targetExpr.type === "field") {
      const idx = Math.floor(
        toNumber(await evaluator.evalExpr(targetExpr.index)),
      );
      targetName = `$${idx}`;
    }
  }

  let target: string;
  if (targetName === "$0") {
    target = ctx.line;
  } else if (targetName.startsWith("$")) {
    const idx = parseInt(targetName.slice(1), 10) - 1;
    target = ctx.fields[idx] || "";
  } else {
    target = toAwkString(ctx.vars[targetName] ?? "");
  }

  try {
    const regex = new RegExp(pattern);
    const newTarget = target.replace(regex, createSubReplacer(replacement));
    const changed = newTarget !== target ? 1 : 0;

    if (targetName === "$0") {
      ctx.line = newTarget;
      ctx.fields =
        ctx.FS === " "
          ? newTarget.trim().split(/\s+/).filter(Boolean)
          : newTarget.split(ctx.fieldSep);
      ctx.NF = ctx.fields.length;
    } else if (targetName.startsWith("$")) {
      const idx = parseInt(targetName.slice(1), 10) - 1;
      while (ctx.fields.length <= idx) ctx.fields.push("");
      ctx.fields[idx] = newTarget;
      ctx.NF = ctx.fields.length;
      ctx.line = ctx.fields.join(ctx.OFS);
    } else {
      ctx.vars[targetName] = newTarget;
    }

    return changed;
  } catch {
    return 0;
  }
}

async function awkGsub(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length < 2) return 0;

  let pattern: string;
  if (args[0].type === "regex") {
    pattern = args[0].pattern;
  } else {
    pattern = toAwkString(await evaluator.evalExpr(args[0]));
    if (pattern.startsWith("/") && pattern.endsWith("/")) {
      pattern = pattern.slice(1, -1);
    }
  }

  const replacement = toAwkString(await evaluator.evalExpr(args[1]));

  let targetName = "$0";
  if (args.length >= 3) {
    const targetExpr = args[2];
    if (targetExpr.type === "variable") {
      targetName = targetExpr.name;
    } else if (targetExpr.type === "field") {
      const idx = Math.floor(
        toNumber(await evaluator.evalExpr(targetExpr.index)),
      );
      targetName = `$${idx}`;
    }
  }

  let target: string;
  if (targetName === "$0") {
    target = ctx.line;
  } else if (targetName.startsWith("$")) {
    const idx = parseInt(targetName.slice(1), 10) - 1;
    target = ctx.fields[idx] || "";
  } else {
    target = toAwkString(ctx.vars[targetName] ?? "");
  }

  try {
    const regex = new RegExp(pattern, "g");
    const matches = target.match(regex);
    const count = matches ? matches.length : 0;
    const newTarget = target.replace(regex, createSubReplacer(replacement));

    if (targetName === "$0") {
      ctx.line = newTarget;
      ctx.fields =
        ctx.FS === " "
          ? newTarget.trim().split(/\s+/).filter(Boolean)
          : newTarget.split(ctx.fieldSep);
      ctx.NF = ctx.fields.length;
    } else if (targetName.startsWith("$")) {
      const idx = parseInt(targetName.slice(1), 10) - 1;
      while (ctx.fields.length <= idx) ctx.fields.push("");
      ctx.fields[idx] = newTarget;
      ctx.NF = ctx.fields.length;
      ctx.line = ctx.fields.join(ctx.OFS);
    } else {
      ctx.vars[targetName] = newTarget;
    }

    return count;
  } catch {
    return 0;
  }
}

function createSubReplacer(replacement: string): (match: string) => string {
  return (match: string) => {
    let result = "";
    let i = 0;
    while (i < replacement.length) {
      if (replacement[i] === "\\" && i + 1 < replacement.length) {
        const next = replacement[i + 1];
        if (next === "&") {
          result += "&";
          i += 2;
        } else if (next === "\\") {
          result += "\\";
          i += 2;
        } else {
          result += replacement[i + 1];
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
  };
}

async function awkMatch(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length < 2) {
    ctx.RSTART = 0;
    ctx.RLENGTH = -1;
    return 0;
  }

  const str = toAwkString(await evaluator.evalExpr(args[0]));

  let pattern: string;
  if (args[1].type === "regex") {
    pattern = args[1].pattern;
  } else {
    pattern = toAwkString(await evaluator.evalExpr(args[1]));
    if (pattern.startsWith("/") && pattern.endsWith("/")) {
      pattern = pattern.slice(1, -1);
    }
  }

  try {
    const regex = new RegExp(pattern);
    const match = regex.exec(str);
    if (match) {
      ctx.RSTART = match.index + 1;
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

async function awkGensub(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (args.length < 3) return "";

  let pattern: string;
  if (args[0].type === "regex") {
    pattern = args[0].pattern;
  } else {
    pattern = toAwkString(await evaluator.evalExpr(args[0]));
    if (pattern.startsWith("/") && pattern.endsWith("/")) {
      pattern = pattern.slice(1, -1);
    }
  }

  const replacement = toAwkString(await evaluator.evalExpr(args[1]));
  const how = toAwkString(await evaluator.evalExpr(args[2]));
  const target =
    args.length >= 4
      ? toAwkString(await evaluator.evalExpr(args[3]))
      : ctx.line;

  try {
    const isGlobal = how.toLowerCase() === "g";
    const occurrenceNum = isGlobal ? 0 : parseInt(how, 10) || 1;

    if (isGlobal) {
      const regex = new RegExp(pattern, "g");
      return target.replace(regex, (match, ...groups) =>
        processGensub(replacement, match, groups.slice(0, -2)),
      );
    } else {
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

async function awkTolower(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (args.length === 0) return "";
  return toAwkString(await evaluator.evalExpr(args[0])).toLowerCase();
}

async function awkToupper(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (args.length === 0) return "";
  return toAwkString(await evaluator.evalExpr(args[0])).toUpperCase();
}

async function awkSprintf(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<string> {
  if (args.length === 0) return "";
  const format = toAwkString(await evaluator.evalExpr(args[0]));
  const values: AwkValue[] = [];
  for (let i = 1; i < args.length; i++) {
    values.push(await evaluator.evalExpr(args[i]));
  }
  return formatPrintf(format, values);
}

// ─── Math Functions ─────────────────────────────────────────────

async function awkInt(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 0;
  return Math.floor(toNumber(await evaluator.evalExpr(args[0])));
}

async function awkSqrt(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 0;
  return Math.sqrt(toNumber(await evaluator.evalExpr(args[0])));
}

async function awkSin(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 0;
  return Math.sin(toNumber(await evaluator.evalExpr(args[0])));
}

async function awkCos(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 0;
  return Math.cos(toNumber(await evaluator.evalExpr(args[0])));
}

async function awkAtan2(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  const y = args.length > 0 ? toNumber(await evaluator.evalExpr(args[0])) : 0;
  const x = args.length > 1 ? toNumber(await evaluator.evalExpr(args[1])) : 0;
  return Math.atan2(y, x);
}

async function awkLog(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 0;
  return Math.log(toNumber(await evaluator.evalExpr(args[0])));
}

async function awkExp(
  args: AwkExpr[],
  _ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  if (args.length === 0) return 1;
  return Math.exp(toNumber(await evaluator.evalExpr(args[0])));
}

function awkRand(
  _args: AwkExpr[],
  ctx: AwkRuntimeContext,
  _evaluator: AwkEvaluator,
): number {
  return ctx.random ? ctx.random() : Math.random();
}

async function awkSrand(
  args: AwkExpr[],
  ctx: AwkRuntimeContext,
  evaluator: AwkEvaluator,
): Promise<number> {
  const seed =
    args.length > 0 ? toNumber(await evaluator.evalExpr(args[0])) : Date.now();
  ctx.vars._srand_seed = seed;
  return seed;
}

// ─── Unsupported Functions ──────────────────────────────────────

function unsupported(name: string, reason: string): AwkBuiltinFn {
  return () => {
    throw new Error(`${name}() is not supported - ${reason}`);
  };
}

function unimplemented(name: string): AwkBuiltinFn {
  return () => {
    throw new Error(`function '${name}()' is not implemented`);
  };
}

// ─── Printf Formatting ──────────────────────────────────────────

export function formatPrintf(format: string, values: AwkValue[]): string {
  let valueIdx = 0;
  let result = "";
  let i = 0;

  while (i < format.length) {
    if (format[i] === "%" && i + 1 < format.length) {
      let j = i + 1;
      let flags = "";
      let width = "";
      let precision = "";

      while (j < format.length && /[-+ #0]/.test(format[j])) {
        flags += format[j++];
      }

      while (j < format.length && /\d/.test(format[j])) {
        width += format[j++];
      }

      if (format[j] === ".") {
        j++;
        while (j < format.length && /\d/.test(format[j])) {
          precision += format[j++];
        }
      }

      const spec = format[j];
      const val = values[valueIdx];

      switch (spec) {
        case "s": {
          let str = val !== undefined ? String(val) : "";
          if (precision) {
            str = str.substring(0, parseInt(precision, 10));
          }
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else {
              str = str.padStart(w);
            }
          }
          result += str;
          valueIdx++;
          break;
        }

        case "d":
        case "i": {
          let num = val !== undefined ? Math.floor(Number(val)) : 0;
          if (Number.isNaN(num)) num = 0;
          let str = String(num);
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else if (flags.includes("0") && !flags.includes("-")) {
              const sign = num < 0 ? "-" : "";
              str =
                sign +
                Math.abs(num)
                  .toString()
                  .padStart(w - sign.length, "0");
            } else {
              str = str.padStart(w);
            }
          }
          result += str;
          valueIdx++;
          break;
        }

        case "f": {
          let num = val !== undefined ? Number(val) : 0;
          if (Number.isNaN(num)) num = 0;
          const prec = precision ? parseInt(precision, 10) : 6;
          let str = num.toFixed(prec);
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else {
              str = str.padStart(w);
            }
          }
          result += str;
          valueIdx++;
          break;
        }

        case "e":
        case "E": {
          let num = val !== undefined ? Number(val) : 0;
          if (Number.isNaN(num)) num = 0;
          const prec = precision ? parseInt(precision, 10) : 6;
          let str = num.toExponential(prec);
          if (spec === "E") str = str.toUpperCase();
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else {
              str = str.padStart(w);
            }
          }
          result += str;
          valueIdx++;
          break;
        }

        case "g":
        case "G": {
          let num = val !== undefined ? Number(val) : 0;
          if (Number.isNaN(num)) num = 0;
          const prec = precision ? parseInt(precision, 10) : 6;
          const exp = num !== 0 ? Math.floor(Math.log10(Math.abs(num))) : 0;
          let str: string;
          if (num === 0) {
            str = "0";
          } else if (exp < -4 || exp >= prec) {
            str = num.toExponential(prec - 1);
            if (spec === "G") str = str.toUpperCase();
          } else {
            str = num.toPrecision(prec);
          }
          str = str.replace(/\.?0+$/, "").replace(/\.?0+e/, "e");
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("-")) {
              str = str.padEnd(w);
            } else {
              str = str.padStart(w);
            }
          }
          result += str;
          valueIdx++;
          break;
        }

        case "x":
        case "X": {
          let num = val !== undefined ? Math.floor(Number(val)) : 0;
          if (Number.isNaN(num)) num = 0;
          let str = Math.abs(num).toString(16);
          if (spec === "X") str = str.toUpperCase();
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("0")) {
              str = str.padStart(w, "0");
            } else if (flags.includes("-")) {
              str = str.padEnd(w);
            } else {
              str = str.padStart(w);
            }
          }
          result += num < 0 ? `-${str}` : str;
          valueIdx++;
          break;
        }

        case "o": {
          let num = val !== undefined ? Math.floor(Number(val)) : 0;
          if (Number.isNaN(num)) num = 0;
          let str = Math.abs(num).toString(8);
          if (width) {
            const w = parseInt(width, 10);
            if (flags.includes("0")) {
              str = str.padStart(w, "0");
            } else if (flags.includes("-")) {
              str = str.padEnd(w);
            } else {
              str = str.padStart(w);
            }
          }
          result += num < 0 ? `-${str}` : str;
          valueIdx++;
          break;
        }

        case "c": {
          if (typeof val === "number") {
            result += String.fromCharCode(val);
          } else {
            result += String(val ?? "").charAt(0) || "";
          }
          valueIdx++;
          break;
        }

        case "%":
          result += "%";
          break;

        default:
          result += format.substring(i, j + 1);
      }
      i = j + 1;
    } else if (format[i] === "\\" && i + 1 < format.length) {
      const esc = format[i + 1];
      switch (esc) {
        case "n":
          result += "\n";
          break;
        case "t":
          result += "\t";
          break;
        case "r":
          result += "\r";
          break;
        case "\\":
          result += "\\";
          break;
        default:
          result += esc;
      }
      i += 2;
    } else {
      result += format[i++];
    }
  }

  return result;
}

// ─── Built-in Function Registry ─────────────────────────────────

export const awkBuiltins: Record<string, AwkBuiltinFn> = {
  // String functions
  length: awkLength,
  substr: awkSubstr,
  index: awkIndex,
  split: awkSplit,
  sub: awkSub,
  gsub: awkGsub,
  match: awkMatch,
  gensub: awkGensub,
  tolower: awkTolower,
  toupper: awkToupper,
  sprintf: awkSprintf,

  // Math functions
  int: awkInt,
  sqrt: awkSqrt,
  sin: awkSin,
  cos: awkCos,
  atan2: awkAtan2,
  log: awkLog,
  exp: awkExp,
  rand: awkRand,
  srand: awkSrand,

  // Unsupported functions (security/sandboxing)
  system: unsupported(
    "system",
    "shell execution not allowed in sandboxed environment",
  ),
  close: unsupported("close", "file operations not allowed"),
  fflush: unsupported("fflush", "file operations not allowed"),

  // Unimplemented functions
  systime: unimplemented("systime"),
  mktime: unimplemented("mktime"),
  strftime: unimplemented("strftime"),
};

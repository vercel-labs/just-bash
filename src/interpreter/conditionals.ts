/**
 * Conditional Expression Evaluation
 *
 * Handles:
 * - [[ ... ]] conditional commands
 * - [ ... ] and test commands
 * - File tests (-f, -d, -e, etc.)
 * - String tests (-z, -n, =, !=)
 * - Numeric comparisons (-eq, -ne, -lt, etc.)
 * - Pattern matching (==, =~)
 */

import type { ConditionalExpressionNode } from "../ast/types.js";
import type { ExecResult } from "../types.js";
import { expandWord } from "./expansion.js";
import type { InterpreterContext } from "./types.js";

export async function evaluateConditional(
  ctx: InterpreterContext,
  expr: ConditionalExpressionNode,
): Promise<boolean> {
  switch (expr.type) {
    case "CondBinary": {
      const left = await expandWord(ctx, expr.left);
      const right = await expandWord(ctx, expr.right);

      switch (expr.operator) {
        case "==":
        case "=":
          return matchPattern(left, right);
        case "!=":
          return !matchPattern(left, right);
        case "=~": {
          try {
            const regex = new RegExp(right);
            const match = left.match(regex);
            if (match) {
              ctx.state.env.BASH_REMATCH = match[0];
              for (let i = 1; i < match.length; i++) {
                ctx.state.env[`BASH_REMATCH_${i}`] = match[i] || "";
              }
            }
            return match !== null;
          } catch {
            return false;
          }
        }
        case "<":
          return left < right;
        case ">":
          return left > right;
        case "-eq":
          return Number.parseInt(left, 10) === Number.parseInt(right, 10);
        case "-ne":
          return Number.parseInt(left, 10) !== Number.parseInt(right, 10);
        case "-lt":
          return Number.parseInt(left, 10) < Number.parseInt(right, 10);
        case "-le":
          return Number.parseInt(left, 10) <= Number.parseInt(right, 10);
        case "-gt":
          return Number.parseInt(left, 10) > Number.parseInt(right, 10);
        case "-ge":
          return Number.parseInt(left, 10) >= Number.parseInt(right, 10);
        case "-nt":
        case "-ot":
        case "-ef":
          return false;
        default:
          return false;
      }
    }

    case "CondUnary": {
      const operand = await expandWord(ctx, expr.operand);

      switch (expr.operator) {
        case "-z":
          return operand === "";
        case "-n":
          return operand !== "";
        case "-e":
        case "-a":
          return await ctx.fs.exists(resolvePath(ctx, operand));
        case "-f": {
          const path = resolvePath(ctx, operand);
          if (await ctx.fs.exists(path)) {
            const stat = await ctx.fs.stat(path);
            return stat.isFile;
          }
          return false;
        }
        case "-d": {
          const path = resolvePath(ctx, operand);
          if (await ctx.fs.exists(path)) {
            const stat = await ctx.fs.stat(path);
            return stat.isDirectory;
          }
          return false;
        }
        case "-r":
        case "-w":
        case "-x":
          return await ctx.fs.exists(resolvePath(ctx, operand));
        case "-s": {
          const path = resolvePath(ctx, operand);
          if (await ctx.fs.exists(path)) {
            const content = await ctx.fs.readFile(path);
            return content.length > 0;
          }
          return false;
        }
        case "-L":
        case "-h": {
          const path = resolvePath(ctx, operand);
          if (await ctx.fs.exists(path)) {
            const stat = await ctx.fs.lstat(path);
            return stat.isSymbolicLink;
          }
          return false;
        }
        case "-v":
          return operand in ctx.state.env;
        default:
          return false;
      }
    }

    case "CondNot":
      return !(await evaluateConditional(ctx, expr.operand));

    case "CondAnd": {
      const left = await evaluateConditional(ctx, expr.left);
      if (!left) return false;
      return await evaluateConditional(ctx, expr.right);
    }

    case "CondOr": {
      const left = await evaluateConditional(ctx, expr.left);
      if (left) return true;
      return await evaluateConditional(ctx, expr.right);
    }

    case "CondGroup":
      return await evaluateConditional(ctx, expr.expression);

    case "CondWord": {
      const value = await expandWord(ctx, expr.word);
      return value !== "";
    }

    default:
      return false;
  }
}

export async function evaluateTestArgs(
  ctx: InterpreterContext,
  args: string[],
): Promise<ExecResult> {
  if (args.length === 0) {
    return { stdout: "", stderr: "", exitCode: 1 };
  }

  if (args.length === 1) {
    return { stdout: "", stderr: "", exitCode: args[0] ? 0 : 1 };
  }

  if (args.length === 2) {
    const op = args[0];
    const operand = args[1];

    switch (op) {
      case "-z":
        return { stdout: "", stderr: "", exitCode: operand === "" ? 0 : 1 };
      case "-n":
        return { stdout: "", stderr: "", exitCode: operand !== "" ? 0 : 1 };
      case "-e":
      case "-a": {
        const exists = await ctx.fs.exists(resolvePath(ctx, operand));
        return { stdout: "", stderr: "", exitCode: exists ? 0 : 1 };
      }
      case "-f": {
        const path = resolvePath(ctx, operand);
        if (await ctx.fs.exists(path)) {
          const stat = await ctx.fs.stat(path);
          return { stdout: "", stderr: "", exitCode: stat.isFile ? 0 : 1 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      case "-d": {
        const path = resolvePath(ctx, operand);
        if (await ctx.fs.exists(path)) {
          const stat = await ctx.fs.stat(path);
          return {
            stdout: "",
            stderr: "",
            exitCode: stat.isDirectory ? 0 : 1,
          };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      case "-r":
      case "-w":
      case "-x": {
        const exists = await ctx.fs.exists(resolvePath(ctx, operand));
        return { stdout: "", stderr: "", exitCode: exists ? 0 : 1 };
      }
      case "-s": {
        const path = resolvePath(ctx, operand);
        if (await ctx.fs.exists(path)) {
          const content = await ctx.fs.readFile(path);
          return {
            stdout: "",
            stderr: "",
            exitCode: content.length > 0 ? 0 : 1,
          };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      case "!":
        return { stdout: "", stderr: "", exitCode: operand ? 1 : 0 };
      default:
        return { stdout: "", stderr: "", exitCode: 1 };
    }
  }

  if (args.length === 3) {
    const left = args[0];
    const op = args[1];
    const right = args[2];

    switch (op) {
      case "=":
      case "==":
        return {
          stdout: "",
          stderr: "",
          exitCode: matchPattern(left, right) ? 0 : 1,
        };
      case "!=":
        return {
          stdout: "",
          stderr: "",
          exitCode: !matchPattern(left, right) ? 0 : 1,
        };
      case "-eq":
        return {
          stdout: "",
          stderr: "",
          exitCode:
            Number.parseInt(left, 10) === Number.parseInt(right, 10) ? 0 : 1,
        };
      case "-ne":
        return {
          stdout: "",
          stderr: "",
          exitCode:
            Number.parseInt(left, 10) !== Number.parseInt(right, 10) ? 0 : 1,
        };
      case "-lt":
        return {
          stdout: "",
          stderr: "",
          exitCode:
            Number.parseInt(left, 10) < Number.parseInt(right, 10) ? 0 : 1,
        };
      case "-le":
        return {
          stdout: "",
          stderr: "",
          exitCode:
            Number.parseInt(left, 10) <= Number.parseInt(right, 10) ? 0 : 1,
        };
      case "-gt":
        return {
          stdout: "",
          stderr: "",
          exitCode:
            Number.parseInt(left, 10) > Number.parseInt(right, 10) ? 0 : 1,
        };
      case "-ge":
        return {
          stdout: "",
          stderr: "",
          exitCode:
            Number.parseInt(left, 10) >= Number.parseInt(right, 10) ? 0 : 1,
        };
      default:
        return { stdout: "", stderr: "", exitCode: 1 };
    }
  }

  // Handle compound expressions with -a (AND) and -o (OR)
  const result = await evaluateTestExpr(ctx, args, 0);
  return { stdout: "", stderr: "", exitCode: result.value ? 0 : 1 };
}

// Recursive expression evaluator for test command
async function evaluateTestExpr(
  ctx: InterpreterContext,
  args: string[],
  pos: number,
): Promise<{ value: boolean; pos: number }> {
  return evaluateTestOr(ctx, args, pos);
}

async function evaluateTestOr(
  ctx: InterpreterContext,
  args: string[],
  pos: number,
): Promise<{ value: boolean; pos: number }> {
  let { value, pos: newPos } = await evaluateTestAnd(ctx, args, pos);
  while (args[newPos] === "-o") {
    const right = await evaluateTestAnd(ctx, args, newPos + 1);
    value = value || right.value;
    newPos = right.pos;
  }
  return { value, pos: newPos };
}

async function evaluateTestAnd(
  ctx: InterpreterContext,
  args: string[],
  pos: number,
): Promise<{ value: boolean; pos: number }> {
  let { value, pos: newPos } = await evaluateTestNot(ctx, args, pos);
  while (args[newPos] === "-a") {
    const right = await evaluateTestNot(ctx, args, newPos + 1);
    value = value && right.value;
    newPos = right.pos;
  }
  return { value, pos: newPos };
}

async function evaluateTestNot(
  ctx: InterpreterContext,
  args: string[],
  pos: number,
): Promise<{ value: boolean; pos: number }> {
  if (args[pos] === "!") {
    const { value, pos: newPos } = await evaluateTestNot(ctx, args, pos + 1);
    return { value: !value, pos: newPos };
  }
  return evaluateTestPrimary(ctx, args, pos);
}

async function evaluateTestPrimary(
  ctx: InterpreterContext,
  args: string[],
  pos: number,
): Promise<{ value: boolean; pos: number }> {
  const token = args[pos];

  // Parentheses grouping
  if (token === "(") {
    const { value, pos: newPos } = await evaluateTestExpr(ctx, args, pos + 1);
    // Skip closing )
    return { value, pos: args[newPos] === ")" ? newPos + 1 : newPos };
  }

  // Unary file tests
  const fileOps = ["-e", "-a", "-f", "-d", "-r", "-w", "-x", "-s", "-L", "-h"];
  if (fileOps.includes(token)) {
    const operand = args[pos + 1] ?? "";
    const path = resolvePath(ctx, operand);

    let value = false;
    switch (token) {
      case "-e":
      case "-a":
        value = await ctx.fs.exists(path);
        break;
      case "-f":
        if (await ctx.fs.exists(path)) {
          const stat = await ctx.fs.stat(path);
          value = stat.isFile;
        }
        break;
      case "-d":
        if (await ctx.fs.exists(path)) {
          const stat = await ctx.fs.stat(path);
          value = stat.isDirectory;
        }
        break;
      case "-r":
      case "-w":
      case "-x":
        value = await ctx.fs.exists(path);
        break;
      case "-s":
        if (await ctx.fs.exists(path)) {
          const content = await ctx.fs.readFile(path);
          value = content.length > 0;
        }
        break;
      case "-L":
      case "-h":
        if (await ctx.fs.exists(path)) {
          const stat = await ctx.fs.lstat(path);
          value = stat.isSymbolicLink;
        }
        break;
    }
    return { value, pos: pos + 2 };
  }

  // Unary string tests
  if (token === "-z") {
    const operand = args[pos + 1] ?? "";
    return { value: operand === "", pos: pos + 2 };
  }
  if (token === "-n") {
    const operand = args[pos + 1] ?? "";
    return { value: operand !== "", pos: pos + 2 };
  }

  // Check for binary operators
  const next = args[pos + 1];
  if (next === "=" || next === "==" || next === "!=") {
    const left = token;
    const right = args[pos + 2] ?? "";
    const isEqual = matchPattern(left, right);
    return { value: next === "!=" ? !isEqual : isEqual, pos: pos + 3 };
  }

  const numericOps = ["-eq", "-ne", "-lt", "-le", "-gt", "-ge"];
  if (numericOps.includes(next)) {
    const left = Number.parseInt(token, 10);
    const right = Number.parseInt(args[pos + 2] ?? "0", 10);
    let value = false;
    switch (next) {
      case "-eq":
        value = left === right;
        break;
      case "-ne":
        value = left !== right;
        break;
      case "-lt":
        value = left < right;
        break;
      case "-le":
        value = left <= right;
        break;
      case "-gt":
        value = left > right;
        break;
      case "-ge":
        value = left >= right;
        break;
    }
    return { value, pos: pos + 3 };
  }

  // Single argument: true if non-empty
  return { value: token !== undefined && token !== "", pos: pos + 1 };
}

export function matchPattern(value: string, pattern: string): boolean {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    // Handle backslash escapes - next char is literal
    if (char === "\\") {
      if (i + 1 < pattern.length) {
        const next = pattern[i + 1];
        // Escape regex special chars
        if (/[\\^$.|+(){}[\]*?]/.test(next)) {
          regex += `\\${next}`;
        } else {
          regex += next;
        }
        i++; // Skip the escaped character
      } else {
        regex += "\\\\"; // Trailing backslash
      }
    } else if (char === "*") {
      regex += ".*";
    } else if (char === "?") {
      regex += ".";
    } else if (char === "[") {
      const closeIdx = pattern.indexOf("]", i + 1);
      if (closeIdx !== -1) {
        regex += pattern.slice(i, closeIdx + 1);
        i = closeIdx;
      } else {
        regex += "\\[";
      }
    } else if (/[\\^$.|+(){}]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  regex += "$";

  return new RegExp(regex).test(value);
}

function resolvePath(ctx: InterpreterContext, path: string): string {
  return ctx.fs.resolvePath(ctx.state.cwd, path);
}

import {
  awkGensub,
  awkGsub,
  awkIndex,
  awkLength,
  awkMatch,
  awkSplit,
  awkSprintf,
  awkSub,
  awkSubstr,
  awkTolower,
  awkToupper,
} from "./functions.js";
import type { AwkContext } from "./types.js";

export function evaluateExpression(
  expr: string,
  ctx: AwkContext,
): string | number {
  expr = expr.trim();

  // String literal
  if (expr.startsWith('"') && expr.endsWith('"')) {
    return processEscapesInString(expr.slice(1, -1));
  }

  // Function calls
  const funcMatch = expr.match(/^(\w+)\s*\((.*)\)$/);
  if (funcMatch) {
    const funcName = funcMatch[1];
    const argsStr = funcMatch[2];
    const args = splitFunctionArgs(argsStr);

    switch (funcName) {
      case "length":
        return awkLength(args, ctx, evaluateExpression);
      case "substr":
        return awkSubstr(args, ctx, evaluateExpression);
      case "index":
        return awkIndex(args, ctx, evaluateExpression);
      case "split":
        return awkSplit(args, ctx, evaluateExpression);
      case "sub":
        return awkSub(args, ctx, evaluateExpression);
      case "gsub":
        return awkGsub(args, ctx, evaluateExpression);
      case "match":
        return awkMatch(args, ctx, evaluateExpression);
      case "gensub":
        return awkGensub(args, ctx, evaluateExpression);
      case "tolower":
        return awkTolower(args, ctx, evaluateExpression);
      case "toupper":
        return awkToupper(args, ctx, evaluateExpression);
      case "sprintf":
        return awkSprintf(args, ctx, evaluateExpression);
      case "int":
        return Math.floor(Number(evaluateExpression(args[0] || "0", ctx)));
      case "sqrt":
        return Math.sqrt(Number(evaluateExpression(args[0] || "0", ctx)));
      case "sin":
        return Math.sin(Number(evaluateExpression(args[0] || "0", ctx)));
      case "cos":
        return Math.cos(Number(evaluateExpression(args[0] || "0", ctx)));
      case "log":
        return Math.log(Number(evaluateExpression(args[0] || "0", ctx)));
      case "exp":
        return Math.exp(Number(evaluateExpression(args[0] || "0", ctx)));
      case "atan2": {
        const y = Number(evaluateExpression(args[0] || "0", ctx));
        const x = Number(evaluateExpression(args[1] || "0", ctx));
        return Math.atan2(y, x);
      }
      case "rand":
        return ctx.random ? ctx.random() : Math.random();
      case "srand": {
        // In real awk, srand() seeds the random number generator
        // We'll just return a value and the random will work with Math.random()
        const seed =
          args.length > 0
            ? Number(evaluateExpression(args[0], ctx))
            : Date.now();
        // Store seed for reference (doesn't actually change behavior)
        ctx.vars._srand_seed = seed;
        return seed;
      }
      // Unimplemented functions - error with clear message
      case "systime":
      case "mktime":
      case "strftime":
        throw new Error(`function '${funcName}()' is not implemented`);
      // Unsupported functions - security/sandboxing reasons
      case "system":
        throw new Error(
          "system() is not supported - shell execution not allowed in sandboxed environment",
        );
      case "close":
        throw new Error(
          "close() is not supported - file operations not allowed",
        );
      case "fflush":
        throw new Error(
          "fflush() is not supported - file operations not allowed",
        );
      case "nextfile":
        throw new Error("nextfile is not supported - use 'next' instead");
    }

    // Check for user-defined function
    if (ctx.functions?.[funcName]) {
      return executeUserFunction(funcName, args, ctx);
    }
  }

  // Array access: arr[key]
  const arrayMatch = expr.match(/^(\w+)\[(.+)\]$/);
  if (arrayMatch) {
    const arrayName = arrayMatch[1];
    const keyExpr = arrayMatch[2];
    const key = String(evaluateExpression(keyExpr, ctx));
    if (ctx.arrays[arrayName]) {
      return ctx.arrays[arrayName][key] ?? "";
    }
    return "";
  }

  // Field reference $n or $(expr)
  if (expr.startsWith("$")) {
    if (expr.startsWith("$(")) {
      // Dynamic field: $(expr)
      const innerExpr = expr.slice(2, -1);
      const n = Number(evaluateExpression(innerExpr, ctx));
      if (n === 0) return ctx.line;
      return ctx.fields[n - 1] || "";
    }
    const fieldMatch = expr.match(/^\$(\d+)$/);
    if (fieldMatch) {
      const n = parseInt(fieldMatch[1], 10);
      if (n === 0) return ctx.line;
      return ctx.fields[n - 1] || "";
    }
  }

  // Built-in variables
  if (expr === "NR") return ctx.NR;
  if (expr === "NF") return ctx.NF;
  if (expr === "FNR") return ctx.FNR;
  if (expr === "FS") return ctx.FS;
  if (expr === "OFS") return ctx.OFS;
  if (expr === "FILENAME") return ctx.FILENAME;
  if (expr === "RSTART") return ctx.RSTART;
  if (expr === "RLENGTH") return ctx.RLENGTH;

  // Variable (defined)
  if (ctx.vars[expr] !== undefined) {
    return ctx.vars[expr];
  }

  // Ternary operator: condition ? true_expr : false_expr
  const ternaryMatch = expr.match(/^(.+?)\s*\?\s*(.+?)\s*:\s*(.+)$/);
  if (ternaryMatch) {
    const condition = evaluateCondition(ternaryMatch[1].trim(), ctx);
    return condition
      ? evaluateExpression(ternaryMatch[2].trim(), ctx)
      : evaluateExpression(ternaryMatch[3].trim(), ctx);
  }

  // Power operator (highest precedence among arithmetic) - check for ^ and **
  const powerMatch = expr.match(/^(.+?)\s*(\^|\*\*)\s*(.+)$/);
  if (powerMatch) {
    const left = Number(evaluateExpression(powerMatch[1], ctx));
    const right = Number(evaluateExpression(powerMatch[3], ctx));
    return left ** right;
  }

  // Arithmetic - check BEFORE concatenation
  const arithMatchSpaced = expr.match(/^(.+?)\s+([+\-*/%])\s+(.+)$/);
  if (arithMatchSpaced) {
    const left = Number(evaluateExpression(arithMatchSpaced[1], ctx));
    const right = Number(evaluateExpression(arithMatchSpaced[3], ctx));
    switch (arithMatchSpaced[2]) {
      case "+":
        return left + right;
      case "-":
        return left - right;
      case "*":
        return left * right;
      case "/":
        return right !== 0 ? left / right : 0;
      case "%":
        return left % right;
    }
  }

  // Arithmetic without spaces for simple identifiers - handles chained operations like x*x*x
  // Parse from left to right for all arithmetic operators
  const arithMatchNoSpace = expr.match(
    /^([a-zA-Z_]\w*|\$\d+|\d+(?:\.\d+)?)\s*([+\-*/%])\s*(.+)$/,
  );
  if (arithMatchNoSpace) {
    const left = Number(evaluateExpression(arithMatchNoSpace[1], ctx));
    const right = Number(evaluateExpression(arithMatchNoSpace[3], ctx));
    switch (arithMatchNoSpace[2]) {
      case "+":
        return left + right;
      case "-":
        return left - right;
      case "*":
        return left * right;
      case "/":
        return right !== 0 ? left / right : 0;
      case "%":
        return left % right;
    }
  }

  // Concatenation
  if (expr.includes("$") || expr.includes('"')) {
    return evaluateConcatenation(expr, ctx);
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(expr)) {
    return parseFloat(expr);
  }

  // Uninitialized variable - return empty string
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(expr)) {
    return "";
  }

  return expr;
}

function splitFunctionArgs(argsStr: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (ch === '"' && argsStr[i - 1] !== "\\") {
      inString = !inString;
      current += ch;
    } else if (!inString && ch === "(") {
      depth++;
      current += ch;
    } else if (!inString && ch === ")") {
      depth--;
      current += ch;
    } else if (!inString && ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    result.push(current.trim());
  }
  return result;
}

function processEscapesInString(str: string): string {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\");
}

function evaluateConcatenation(expr: string, ctx: AwkContext): string {
  let result = "";
  let i = 0;

  while (i < expr.length) {
    // Skip whitespace
    while (i < expr.length && /\s/.test(expr[i])) i++;
    if (i >= expr.length) break;

    if (expr[i] === '"') {
      // String literal
      let str = "";
      i++; // skip opening quote
      while (i < expr.length && expr[i] !== '"') {
        if (expr[i] === "\\" && i + 1 < expr.length) {
          const next = expr[i + 1];
          if (next === "n") str += "\n";
          else if (next === "t") str += "\t";
          else if (next === "r") str += "\r";
          else str += next;
          i += 2;
        } else {
          str += expr[i++];
        }
      }
      i++; // skip closing quote
      result += str;
    } else if (expr[i] === "$") {
      // Field reference
      i++; // skip $
      let numStr = "";
      while (i < expr.length && /\d/.test(expr[i])) {
        numStr += expr[i++];
      }
      const n = parseInt(numStr, 10);
      result += n === 0 ? ctx.line : ctx.fields[n - 1] || "";
    } else {
      // Variable or literal
      let token = "";
      while (i < expr.length && !/[\s$"]/.test(expr[i])) {
        token += expr[i++];
      }
      if (token === "NR") result += ctx.NR;
      else if (token === "NF") result += ctx.NF;
      else if (ctx.vars[token] !== undefined) result += ctx.vars[token];
      else result += token;
    }
  }

  return result;
}

export function evaluateCondition(condition: string, ctx: AwkContext): boolean {
  condition = condition.trim();

  // Handle && (AND) conditions
  if (condition.includes("&&")) {
    const parts = splitLogicalOp(condition, "&&");
    return parts.every((part) => evaluateCondition(part, ctx));
  }

  // Handle || (OR) conditions
  if (condition.includes("||")) {
    const parts = splitLogicalOp(condition, "||");
    return parts.some((part) => evaluateCondition(part, ctx));
  }

  // Handle ! (NOT)
  if (condition.startsWith("!")) {
    return !evaluateCondition(condition.slice(1).trim(), ctx);
  }

  // Handle parentheses
  if (condition.startsWith("(") && condition.endsWith(")")) {
    return evaluateCondition(condition.slice(1, -1), ctx);
  }

  // Regex pattern
  if (condition.startsWith("/") && condition.endsWith("/")) {
    const regex = new RegExp(condition.slice(1, -1));
    return regex.test(ctx.line);
  }

  // "in" operator for arrays: key in array
  const inMatch = condition.match(/^(.+)\s+in\s+(\w+)$/);
  if (inMatch) {
    const key = String(evaluateExpression(inMatch[1].trim(), ctx));
    const arrayName = inMatch[2];
    return !!(
      ctx.arrays[arrayName] && ctx.arrays[arrayName][key] !== undefined
    );
  }

  // NR comparisons
  const nrMatch = condition.match(/^NR\s*(==|!=|>|<|>=|<=)\s*(\d+)$/);
  if (nrMatch) {
    const op = nrMatch[1];
    const val = parseInt(nrMatch[2], 10);
    return compareValues(ctx.NR, op, val);
  }

  // $n ~ /pattern/
  const fieldRegex = condition.match(/^\$(\d+)\s*~\s*\/([^/]+)\/$/);
  if (fieldRegex) {
    const fieldNum = parseInt(fieldRegex[1], 10);
    const pattern = fieldRegex[2];
    const fieldVal = fieldNum === 0 ? ctx.line : ctx.fields[fieldNum - 1] || "";
    return new RegExp(pattern).test(fieldVal);
  }

  // $n !~ /pattern/
  const fieldNotRegex = condition.match(/^\$(\d+)\s*!~\s*\/([^/]+)\/$/);
  if (fieldNotRegex) {
    const fieldNum = parseInt(fieldNotRegex[1], 10);
    const pattern = fieldNotRegex[2];
    const fieldVal = fieldNum === 0 ? ctx.line : ctx.fields[fieldNum - 1] || "";
    return !new RegExp(pattern).test(fieldVal);
  }

  // Generic comparisons: expr op expr
  const compMatch = condition.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (compMatch) {
    const leftExpr = compMatch[1].trim();
    const op = compMatch[2];
    const rightExpr = compMatch[3].trim();

    const leftVal = evaluateExpression(leftExpr, ctx);
    const rightVal = evaluateExpression(rightExpr, ctx);

    return compareValues(leftVal, op, rightVal);
  }

  // Truthy value check
  const val = evaluateExpression(condition, ctx);
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") return val !== "";
  return Boolean(val);
}

function splitLogicalOp(expr: string, op: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '"' && expr[i - 1] !== "\\") {
      inString = !inString;
    }
    if (!inString) {
      if (expr[i] === "(") depth++;
      else if (expr[i] === ")") depth--;
      else if (depth === 0 && expr.slice(i, i + op.length) === op) {
        parts.push(current.trim());
        current = "";
        i += op.length - 1;
        continue;
      }
    }
    current += expr[i];
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function compareValues(
  left: number | string,
  op: string,
  right: number | string,
): boolean {
  const leftNum = typeof left === "number" ? left : parseFloat(String(left));
  const rightNum =
    typeof right === "number" ? right : parseFloat(String(right));

  const useNumeric = !Number.isNaN(leftNum) && !Number.isNaN(rightNum);

  if (useNumeric) {
    switch (op) {
      case "==":
        return leftNum === rightNum;
      case "!=":
        return leftNum !== rightNum;
      case ">":
        return leftNum > rightNum;
      case "<":
        return leftNum < rightNum;
      case ">=":
        return leftNum >= rightNum;
      case "<=":
        return leftNum <= rightNum;
    }
  } else {
    const leftStr = String(left);
    const rightStr = String(right);
    switch (op) {
      case "==":
        return leftStr === rightStr;
      case "!=":
        return leftStr !== rightStr;
      case ">":
        return leftStr > rightStr;
      case "<":
        return leftStr < rightStr;
      case ">=":
        return leftStr >= rightStr;
      case "<=":
        return leftStr <= rightStr;
    }
  }
  return false;
}

const DEFAULT_MAX_FUNCTION_DEPTH = 100;

// Execute a user-defined function
function executeUserFunction(
  name: string,
  args: string[],
  ctx: AwkContext,
): string | number {
  const func = ctx.functions[name];
  if (!func) {
    throw new Error(`awk: undefined function '${name}'`);
  }

  // Track recursion depth
  const depthKey = "__func_depth__";
  const currentDepth = (ctx.vars[depthKey] as number) || 0;
  if (currentDepth >= DEFAULT_MAX_FUNCTION_DEPTH) {
    throw new Error(
      `awk: function '${name}' exceeded maximum recursion depth (${DEFAULT_MAX_FUNCTION_DEPTH})`,
    );
  }
  ctx.vars[depthKey] = currentDepth + 1;

  // Save current local variables
  const savedVars: Record<string, string | number | undefined> = {};
  for (const param of func.params) {
    savedVars[param] = ctx.vars[param];
  }

  // Bind parameters
  for (let i = 0; i < func.params.length; i++) {
    if (i < args.length) {
      ctx.vars[func.params[i]] = evaluateExpression(args[i], ctx);
    } else {
      ctx.vars[func.params[i]] = "";
    }
  }

  // Execute function body - import executeAwkAction dynamically to avoid circular deps
  // For now, we evaluate the body as an expression (limited but avoids circular import)
  let result: string | number = "";
  try {
    // Look for return statement
    const returnMatch = func.body.match(/return\s+(.+)/);
    if (returnMatch) {
      result = evaluateExpression(returnMatch[1].trim(), ctx);
    }
  } finally {
    // Restore saved variables
    for (const param of func.params) {
      const saved = savedVars[param];
      if (saved !== undefined) {
        ctx.vars[param] = saved;
      } else {
        delete ctx.vars[param];
      }
    }
    ctx.vars[depthKey] = currentDepth;
  }

  return result;
}

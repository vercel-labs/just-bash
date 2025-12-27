import { ExecutionLimitError } from "../../interpreter/errors.js";
import { evaluateCondition, evaluateExpression } from "./expressions.js";
import { findMatchingBrace } from "./parser.js";
import type { AwkContext } from "./types.js";

const DEFAULT_MAX_ITERATIONS = 10000;

export function executeAwkAction(action: string, ctx: AwkContext): string {
  let output = "";
  const statements = parseStatements(action);

  for (const stmt of statements) {
    output += executeStatement(stmt, ctx);
    // Check for control flow flags that should stop execution
    if (ctx.shouldNext || ctx.shouldExit || ctx.loopBreak || ctx.loopContinue) {
      break;
    }
  }

  return output;
}

function parseStatements(action: string): string[] {
  const statements: string[] = [];
  let current = "";
  let braceDepth = 0;
  let parenDepth = 0;
  let inString = false;

  for (let i = 0; i < action.length; i++) {
    const ch = action[i];

    if (ch === '"' && action[i - 1] !== "\\") {
      inString = !inString;
    }

    if (!inString) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      else if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
      else if (
        (ch === ";" || ch === "\n") &&
        braceDepth === 0 &&
        parenDepth === 0
      ) {
        if (current.trim()) {
          statements.push(current.trim());
        }
        current = "";
        continue;
      }
    }

    current += ch;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

function executeStatement(stmt: string, ctx: AwkContext): string {
  stmt = stmt.trim();
  if (!stmt) return "";

  // Handle if/else
  if (stmt.startsWith("if")) {
    return executeIf(stmt, ctx);
  }

  // Handle while
  if (stmt.startsWith("while")) {
    return executeWhile(stmt, ctx);
  }

  // Handle do-while
  if (stmt.startsWith("do")) {
    return executeDoWhile(stmt, ctx);
  }

  // Handle for
  if (stmt.startsWith("for")) {
    return executeFor(stmt, ctx);
  }

  // Handle print statement
  if (stmt === "print" || stmt === "print $0") {
    return `${ctx.line}\n`;
  }

  if (stmt.startsWith("print ")) {
    const printArgs = stmt.slice(6).trim();
    return `${evaluatePrintArgs(printArgs, ctx)}\n`;
  }

  if (stmt.startsWith("printf ")) {
    const printfArgs = stmt.slice(7).trim();
    return evaluatePrintf(printfArgs, ctx);
  }

  // Handle next (skip to next line)
  if (stmt === "next") {
    ctx.shouldNext = true;
    return "";
  }

  // Handle exit
  if (stmt === "exit" || stmt.startsWith("exit ")) {
    ctx.shouldExit = true;
    if (stmt.startsWith("exit ")) {
      const codeExpr = stmt.slice(5).trim();
      ctx.exitCode = Number(evaluateExpression(codeExpr, ctx)) || 0;
    } else {
      ctx.exitCode = 0;
    }
    return "";
  }

  // Handle break (for loops)
  if (stmt === "break") {
    ctx.loopBreak = true;
    return "";
  }

  // Handle continue (for loops)
  if (stmt === "continue") {
    ctx.loopContinue = true;
    return "";
  }

  // Handle getline
  if (stmt === "getline" || stmt.startsWith("getline ")) {
    return handleGetline(stmt, ctx);
  }

  // Handle delete array[key]
  const deleteMatch = stmt.match(/^delete\s+(\w+)\[(.+)\]$/);
  if (deleteMatch) {
    const arrayName = deleteMatch[1];
    const keyExpr = deleteMatch[2];
    const key = String(evaluateExpression(keyExpr, ctx));
    if (ctx.arrays[arrayName]) {
      delete ctx.arrays[arrayName][key];
    }
    return "";
  }

  // Handle array assignment: arr[key] = value
  const arrayAssign = stmt.match(/^(\w+)\[(.+)\]\s*=\s*(.+)$/);
  if (arrayAssign) {
    const arrayName = arrayAssign[1];
    const keyExpr = arrayAssign[2];
    const valueExpr = arrayAssign[3];

    if (!ctx.arrays[arrayName]) {
      ctx.arrays[arrayName] = {};
    }

    const key = String(evaluateExpression(keyExpr, ctx));
    const value = evaluateExpression(valueExpr, ctx);
    ctx.arrays[arrayName][key] = value;
    return "";
  }

  // Handle increment/decrement: var++, var--, ++var, --var
  if (stmt.match(/^(\w+)\+\+$/)) {
    const varName = stmt.slice(0, -2);
    const current = Number(ctx.vars[varName]) || 0;
    ctx.vars[varName] = current + 1;
    return "";
  }

  if (stmt.match(/^(\w+)--$/)) {
    const varName = stmt.slice(0, -2);
    const current = Number(ctx.vars[varName]) || 0;
    ctx.vars[varName] = current - 1;
    return "";
  }

  if (stmt.match(/^\+\+(\w+)$/)) {
    const varName = stmt.slice(2);
    const current = Number(ctx.vars[varName]) || 0;
    ctx.vars[varName] = current + 1;
    return "";
  }

  if (stmt.match(/^--(\w+)$/)) {
    const varName = stmt.slice(2);
    const current = Number(ctx.vars[varName]) || 0;
    ctx.vars[varName] = current - 1;
    return "";
  }

  // Handle array element increment: arr[key]++
  const arrayIncMatch = stmt.match(/^(\w+)\[(.+)\]\+\+$/);
  if (arrayIncMatch) {
    const arrayName = arrayIncMatch[1];
    const keyExpr = arrayIncMatch[2];
    if (!ctx.arrays[arrayName]) ctx.arrays[arrayName] = {};
    const key = String(evaluateExpression(keyExpr, ctx));
    const current = Number(ctx.arrays[arrayName][key]) || 0;
    ctx.arrays[arrayName][key] = current + 1;
    return "";
  }

  // Handle compound assignment: +=, -=, *=, /=
  if (stmt.includes("+=")) {
    const eqIdx = stmt.indexOf("+=");
    const target = stmt.slice(0, eqIdx).trim();
    const expr = stmt.slice(eqIdx + 2).trim();
    const value = Number(evaluateExpression(expr, ctx)) || 0;

    // Check if it's array element
    const arrMatch = target.match(/^(\w+)\[(.+)\]$/);
    if (arrMatch) {
      const arrayName = arrMatch[1];
      const keyExpr = arrMatch[2];
      if (!ctx.arrays[arrayName]) ctx.arrays[arrayName] = {};
      const key = String(evaluateExpression(keyExpr, ctx));
      const current = Number(ctx.arrays[arrayName][key]) || 0;
      ctx.arrays[arrayName][key] = current + value;
    } else {
      const current = Number(ctx.vars[target]) || 0;
      ctx.vars[target] = current + value;
    }
    return "";
  }

  if (stmt.includes("-=")) {
    const eqIdx = stmt.indexOf("-=");
    const varName = stmt.slice(0, eqIdx).trim();
    const expr = stmt.slice(eqIdx + 2).trim();
    const current = Number(ctx.vars[varName]) || 0;
    const value = Number(evaluateExpression(expr, ctx)) || 0;
    ctx.vars[varName] = current - value;
    return "";
  }

  if (stmt.includes("*=")) {
    const eqIdx = stmt.indexOf("*=");
    const varName = stmt.slice(0, eqIdx).trim();
    const expr = stmt.slice(eqIdx + 2).trim();
    const current = Number(ctx.vars[varName]) || 0;
    const value = Number(evaluateExpression(expr, ctx)) || 0;
    ctx.vars[varName] = current * value;
    return "";
  }

  if (stmt.includes("/=")) {
    const eqIdx = stmt.indexOf("/=");
    const varName = stmt.slice(0, eqIdx).trim();
    const expr = stmt.slice(eqIdx + 2).trim();
    const current = Number(ctx.vars[varName]) || 0;
    const value = Number(evaluateExpression(expr, ctx)) || 0;
    ctx.vars[varName] = value !== 0 ? current / value : 0;
    return "";
  }

  // Simple variable assignment
  if (
    stmt.includes("=") &&
    !stmt.includes("==") &&
    !stmt.includes("!=") &&
    !stmt.includes(">=") &&
    !stmt.includes("<=")
  ) {
    const eqIdx = stmt.indexOf("=");
    const varName = stmt.slice(0, eqIdx).trim();
    const expr = stmt.slice(eqIdx + 1).trim();
    ctx.vars[varName] = evaluateExpression(expr, ctx);
    return "";
  }

  // Function call as statement (e.g., gsub(), sub())
  const funcMatch = stmt.match(/^(\w+)\s*\((.+)\)$/);
  if (funcMatch) {
    evaluateExpression(stmt, ctx);
    return "";
  }

  return "";
}

function executeIf(stmt: string, ctx: AwkContext): string {
  // Parse: if (condition) { body } [else { body }] or if (condition) statement
  const condStart = stmt.indexOf("(");
  if (condStart === -1) return "";

  // Find matching paren for condition
  let depth = 1;
  let condEnd = condStart + 1;
  while (condEnd < stmt.length && depth > 0) {
    if (stmt[condEnd] === "(") depth++;
    else if (stmt[condEnd] === ")") depth--;
    condEnd++;
  }
  condEnd--; // Point to closing paren

  const condition = stmt.slice(condStart + 1, condEnd).trim();
  const afterCond = stmt.slice(condEnd + 1).trim();

  let thenBody: string;
  let elseBody: string | null = null;
  let afterThen: string;

  if (afterCond.startsWith("{")) {
    const braceEnd = findMatchingBrace(afterCond, 0);
    thenBody = afterCond.slice(1, braceEnd).trim();
    afterThen = afterCond.slice(braceEnd + 1).trim();
  } else {
    // Single statement without braces
    const semiIdx = afterCond.indexOf(";");
    if (semiIdx !== -1) {
      thenBody = afterCond.slice(0, semiIdx).trim();
      afterThen = afterCond.slice(semiIdx + 1).trim();
    } else {
      // Check for else without semicolon
      const elseIdx = afterCond.indexOf(" else ");
      if (elseIdx !== -1) {
        thenBody = afterCond.slice(0, elseIdx).trim();
        afterThen = afterCond.slice(elseIdx + 1).trim();
      } else {
        thenBody = afterCond;
        afterThen = "";
      }
    }
  }

  // Check for else
  if (afterThen.startsWith("else")) {
    const elseContent = afterThen.slice(4).trim();
    if (elseContent.startsWith("{")) {
      const braceEnd = findMatchingBrace(elseContent, 0);
      elseBody = elseContent.slice(1, braceEnd).trim();
    } else if (elseContent.startsWith("if")) {
      // else if
      elseBody = elseContent;
    } else {
      // Single statement
      const semiIdx = elseContent.indexOf(";");
      elseBody =
        semiIdx !== -1 ? elseContent.slice(0, semiIdx).trim() : elseContent;
    }
  }

  if (evaluateCondition(condition, ctx)) {
    return executeAwkAction(thenBody, ctx);
  } else if (elseBody) {
    return executeAwkAction(elseBody, ctx);
  }

  return "";
}

function executeWhile(stmt: string, ctx: AwkContext): string {
  // Parse: while (condition) { body }
  const condStart = stmt.indexOf("(");
  if (condStart === -1) return "";

  let depth = 1;
  let condEnd = condStart + 1;
  while (condEnd < stmt.length && depth > 0) {
    if (stmt[condEnd] === "(") depth++;
    else if (stmt[condEnd] === ")") depth--;
    condEnd++;
  }
  condEnd--;

  const condition = stmt.slice(condStart + 1, condEnd).trim();
  const afterCond = stmt.slice(condEnd + 1).trim();

  let body: string;
  if (afterCond.startsWith("{")) {
    const braceEnd = findMatchingBrace(afterCond, 0);
    body = afterCond.slice(1, braceEnd).trim();
  } else {
    body = afterCond;
  }

  let output = "";
  let iterations = 0;
  const maxIterations = ctx.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  while (evaluateCondition(condition, ctx)) {
    iterations++;
    if (iterations > maxIterations) {
      throw new ExecutionLimitError(
        `awk: while loop exceeded maximum iterations (${maxIterations})`,
        "iterations",
        output,
      );
    }

    // Reset continue flag
    ctx.loopContinue = false;

    output += executeAwkAction(body, ctx);

    // Check for break
    if (ctx.loopBreak) {
      ctx.loopBreak = false;
      break;
    }
    // Check for exit/next
    if (ctx.shouldExit || ctx.shouldNext) {
      break;
    }
  }

  return output;
}

function executeDoWhile(stmt: string, ctx: AwkContext): string {
  // Parse: do { body } while (condition)
  const doMatch = stmt.match(/^do\s*\{/);
  if (!doMatch) return "";

  const bodyStart = stmt.indexOf("{");
  const bodyEnd = findMatchingBrace(stmt, bodyStart);
  if (bodyEnd === -1) return "";

  const body = stmt.slice(bodyStart + 1, bodyEnd).trim();
  const afterBody = stmt.slice(bodyEnd + 1).trim();

  // Extract while condition
  const whileMatch = afterBody.match(/^while\s*\((.+)\)\s*;?$/);
  if (!whileMatch) return "";

  const condition = whileMatch[1].trim();

  let output = "";
  let iterations = 0;
  const maxIterations = ctx.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  do {
    iterations++;
    if (iterations > maxIterations) {
      throw new ExecutionLimitError(
        `awk: do-while loop exceeded maximum iterations (${maxIterations})`,
        "iterations",
        output,
      );
    }

    // Reset continue flag
    ctx.loopContinue = false;

    output += executeAwkAction(body, ctx);

    // Check for break
    if (ctx.loopBreak) {
      ctx.loopBreak = false;
      break;
    }
    // Check for exit/next
    if (ctx.shouldExit || ctx.shouldNext) {
      break;
    }
  } while (evaluateCondition(condition, ctx));

  return output;
}

function executeFor(stmt: string, ctx: AwkContext): string {
  // Handle two forms:
  // 1. C-style: for (init; condition; increment) { body }
  // 2. for-in: for (var in array) { body }

  const parenStart = stmt.indexOf("(");
  if (parenStart === -1) return "";

  let depth = 1;
  let parenEnd = parenStart + 1;
  while (parenEnd < stmt.length && depth > 0) {
    if (stmt[parenEnd] === "(") depth++;
    else if (stmt[parenEnd] === ")") depth--;
    parenEnd++;
  }
  parenEnd--;

  const forExpr = stmt.slice(parenStart + 1, parenEnd).trim();
  const afterParen = stmt.slice(parenEnd + 1).trim();

  let body: string;
  if (afterParen.startsWith("{")) {
    const braceEnd = findMatchingBrace(afterParen, 0);
    body = afterParen.slice(1, braceEnd).trim();
  } else {
    body = afterParen;
  }

  // Check for for-in syntax: var in array
  const forInMatch = forExpr.match(/^(\w+)\s+in\s+(\w+)$/);
  if (forInMatch) {
    const varName = forInMatch[1];
    const arrayName = forInMatch[2];
    let output = "";

    if (ctx.arrays[arrayName]) {
      for (const key of Object.keys(ctx.arrays[arrayName])) {
        ctx.vars[varName] = key;

        // Reset continue flag
        ctx.loopContinue = false;

        output += executeAwkAction(body, ctx);

        // Check for break
        if (ctx.loopBreak) {
          ctx.loopBreak = false;
          break;
        }
        // Check for exit/next
        if (ctx.shouldExit || ctx.shouldNext) {
          break;
        }
      }
    }

    return output;
  }

  // C-style for loop: init; condition; increment
  const parts = forExpr.split(";").map((p) => p.trim());
  if (parts.length !== 3) return "";

  const [init, condition, increment] = parts;

  // Execute init
  if (init) {
    executeStatement(init, ctx);
  }

  let output = "";
  let iterations = 0;
  const maxIterations = ctx.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  while (!condition || evaluateCondition(condition, ctx)) {
    iterations++;
    if (iterations > maxIterations) {
      throw new ExecutionLimitError(
        `awk: for loop exceeded maximum iterations (${maxIterations})`,
        "iterations",
        output,
      );
    }

    // Reset continue flag
    ctx.loopContinue = false;

    output += executeAwkAction(body, ctx);

    // Check for break
    if (ctx.loopBreak) {
      ctx.loopBreak = false;
      break;
    }
    // Check for exit/next
    if (ctx.shouldExit || ctx.shouldNext) {
      break;
    }

    if (increment) {
      executeStatement(increment, ctx);
    }
  }

  return output;
}

function evaluatePrintArgs(args: string, ctx: AwkContext): string {
  const parts: string[] = [];
  const argList = splitPrintArgs(args);

  for (const arg of argList) {
    parts.push(String(evaluateExpression(arg.trim(), ctx)));
  }

  return parts.join(ctx.OFS);
}

function splitPrintArgs(args: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  let depth = 0;

  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === '"' && args[i - 1] !== "\\") {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === "(" && !inQuote) {
      depth++;
      current += ch;
    } else if (ch === ")" && !inQuote) {
      depth--;
      current += ch;
    } else if (ch === "," && !inQuote && depth === 0) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) result.push(current);

  return result;
}

function evaluatePrintf(args: string, ctx: AwkContext): string {
  const match = args.match(/^"([^"]*)"(.*)$/);
  if (!match) return "";

  const format = match[1];
  const restArgs = match[2].trim();
  const values = restArgs ? splitPrintArgs(restArgs.replace(/^,\s*/, "")) : [];

  let valueIdx = 0;
  let result = "";
  let i = 0;

  while (i < format.length) {
    if (format[i] === "%" && i + 1 < format.length) {
      // Parse format specifier
      let j = i + 1;
      let width = "";
      let precision = "";

      // Skip flags
      while (j < format.length && /[-+ #0]/.test(format[j])) j++;
      // Get width
      while (j < format.length && /\d/.test(format[j])) {
        width += format[j++];
      }
      // Get precision
      if (format[j] === ".") {
        j++;
        while (j < format.length && /\d/.test(format[j])) {
          precision += format[j++];
        }
      }

      const spec = format[j];
      if (spec === "s") {
        let val = values[valueIdx]
          ? String(evaluateExpression(values[valueIdx], ctx))
          : "";
        if (width) {
          val = val.padStart(parseInt(width, 10));
        }
        result += val;
        valueIdx++;
        i = j + 1;
      } else if (spec === "d" || spec === "i") {
        const val = values[valueIdx]
          ? Math.floor(Number(evaluateExpression(values[valueIdx], ctx)))
          : 0;
        let valStr = String(val);
        if (width) {
          valStr = valStr.padStart(parseInt(width, 10));
        }
        result += valStr;
        valueIdx++;
        i = j + 1;
      } else if (spec === "f") {
        const val = values[valueIdx]
          ? Number(evaluateExpression(values[valueIdx], ctx))
          : 0;
        const prec = precision ? parseInt(precision, 10) : 6;
        let valStr = val.toFixed(prec);
        if (width) {
          valStr = valStr.padStart(parseInt(width, 10));
        }
        result += valStr;
        valueIdx++;
        i = j + 1;
      } else if (spec === "x" || spec === "X") {
        // Hexadecimal
        const val = values[valueIdx]
          ? Math.floor(Number(evaluateExpression(values[valueIdx], ctx)))
          : 0;
        let valStr = Math.abs(val).toString(16);
        if (spec === "X") valStr = valStr.toUpperCase();
        if (width) {
          valStr = valStr.padStart(parseInt(width, 10), "0");
        }
        result += val < 0 ? `-${valStr}` : valStr;
        valueIdx++;
        i = j + 1;
      } else if (spec === "o") {
        // Octal
        const val = values[valueIdx]
          ? Math.floor(Number(evaluateExpression(values[valueIdx], ctx)))
          : 0;
        let valStr = Math.abs(val).toString(8);
        if (width) {
          valStr = valStr.padStart(parseInt(width, 10), "0");
        }
        result += val < 0 ? `-${valStr}` : valStr;
        valueIdx++;
        i = j + 1;
      } else if (spec === "c") {
        // Character
        const val = values[valueIdx]
          ? evaluateExpression(values[valueIdx], ctx)
          : "";
        if (typeof val === "number") {
          result += String.fromCharCode(val);
        } else {
          result += String(val).charAt(0) || "";
        }
        valueIdx++;
        i = j + 1;
      } else if (spec === "e" || spec === "E") {
        // Scientific notation
        const val = values[valueIdx]
          ? Number(evaluateExpression(values[valueIdx], ctx))
          : 0;
        const prec = precision ? parseInt(precision, 10) : 6;
        let valStr = val.toExponential(prec);
        if (spec === "E") valStr = valStr.toUpperCase();
        if (width) {
          valStr = valStr.padStart(parseInt(width, 10));
        }
        result += valStr;
        valueIdx++;
        i = j + 1;
      } else if (spec === "g" || spec === "G") {
        // Shortest of %e or %f
        const val = values[valueIdx]
          ? Number(evaluateExpression(values[valueIdx], ctx))
          : 0;
        const prec = precision ? parseInt(precision, 10) : 6;
        // Use exponential if exponent < -4 or >= precision
        const exp = Math.floor(Math.log10(Math.abs(val)));
        let valStr: string;
        if (val === 0) {
          valStr = "0";
        } else if (exp < -4 || exp >= prec) {
          valStr = val.toExponential(prec - 1);
          if (spec === "G") valStr = valStr.toUpperCase();
        } else {
          valStr = val.toPrecision(prec);
        }
        // Remove trailing zeros after decimal
        valStr = valStr.replace(/\.?0+$/, "").replace(/\.?0+e/, "e");
        if (width) {
          valStr = valStr.padStart(parseInt(width, 10));
        }
        result += valStr;
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

function handleGetline(stmt: string, ctx: AwkContext): string {
  // Check if lines are available
  if (!ctx.lines || ctx.lineIndex === undefined) {
    return "";
  }

  // Parse getline forms:
  // getline - read next line into $0
  // getline var - read next line into variable var

  const nextLineIndex = ctx.lineIndex + 1;
  if (nextLineIndex >= ctx.lines.length) {
    // No more lines
    return "";
  }

  const nextLine = ctx.lines[nextLineIndex];

  if (stmt === "getline") {
    // Read into $0
    ctx.line = nextLine;
    ctx.fields = ctx.fieldSep
      ? nextLine.split(ctx.fieldSep)
      : nextLine.split(/\s+/);
    ctx.NF = ctx.fields.length;
    ctx.NR++;
    ctx.lineIndex = nextLineIndex;
  } else {
    // getline var - read into variable
    const varName = stmt.slice(8).trim();
    if (varName && !varName.startsWith("<")) {
      ctx.vars[varName] = nextLine;
      ctx.NR++;
      ctx.lineIndex = nextLineIndex;
    }
  }

  return "";
}

export function matchesPattern(
  pattern: string | null,
  ctx: AwkContext,
): boolean {
  if (pattern === null) return true;

  // Regex pattern (explicit /pattern/)
  if (pattern.startsWith("/") && pattern.endsWith("/")) {
    const regex = new RegExp(pattern.slice(1, -1));
    return regex.test(ctx.line);
  }

  // Check if it looks like a condition
  if (
    /^(NR|NF|\$\d+)\s*(==|!=|>|<|>=|<=|~)/.test(pattern) ||
    /\s*(==|!=|>|<|>=|<=)\s*/.test(pattern)
  ) {
    return evaluateCondition(pattern, ctx);
  }

  // Try as regex
  try {
    const regex = new RegExp(pattern);
    return regex.test(ctx.line);
  } catch {
    return evaluateCondition(pattern, ctx);
  }
}

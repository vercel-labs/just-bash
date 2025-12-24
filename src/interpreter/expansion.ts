import type { ExecResult } from "../types.js";

export interface ExpansionContext {
  /** Environment variables */
  env: Record<string, string>;
  /** Execute a command string (for command substitution) */
  exec: (cmd: string) => Promise<ExecResult>;
}

/**
 * Expand variables in a string synchronously (no command substitution)
 */
export function expandVariablesSync(
  str: string,
  env: Record<string, string>,
): string {
  let result = "";
  let i = 0;

  while (i < str.length) {
    // Handle escaped dollar sign marker (\x01$) - output literal $
    if (str[i] === "\x01" && str[i + 1] === "$") {
      result += "$";
      i += 2;
      continue;
    }

    if (str[i] === "$" && i + 1 < str.length) {
      const nextChar = str[i + 1];

      // Handle $((expr)) arithmetic expansion
      if (nextChar === "(" && str[i + 2] === "(") {
        const closeIndex = findMatchingDoubleParen(str, i + 2);
        if (closeIndex !== -1) {
          const expr = str.slice(i + 3, closeIndex);
          result += evaluateArithmetic(expr, env);
          i = closeIndex + 2; // skip past ))
          continue;
        }
      }

      // Skip $(cmd) - handled by async version
      if (nextChar === "(") {
        const closeIndex = findMatchingParen(str, i + 1);
        if (closeIndex !== -1) {
          // Leave command substitution unexpanded in sync version
          result += str.slice(i, closeIndex + 1);
          i = closeIndex + 1;
          continue;
        }
      }

      // Handle ${VAR} and ${VAR:-default}
      if (nextChar === "{") {
        const closeIndex = str.indexOf("}", i + 2);
        if (closeIndex !== -1) {
          const content = str.slice(i + 2, closeIndex);
          const defaultMatch = content.match(/^([^:]+):-(.*)$/);
          if (defaultMatch) {
            const [, varName, defaultValue] = defaultMatch;
            result += env[varName] ?? defaultValue;
          } else {
            result += env[content] ?? "";
          }
          i = closeIndex + 1;
          continue;
        }
      }

      // Handle special variables: $@, $#, $$, $?, $!, $*
      if ("@#$?!*".includes(nextChar)) {
        result += env[nextChar] ?? "";
        i += 2;
        continue;
      }

      // Handle positional parameters: $0, $1, $2, ...
      if (/[0-9]/.test(nextChar)) {
        result += env[nextChar] ?? "";
        i += 2;
        continue;
      }

      // Handle $VAR
      if (/[A-Za-z_]/.test(nextChar)) {
        let varName = nextChar;
        let j = i + 2;
        while (j < str.length && /[A-Za-z0-9_]/.test(str[j])) {
          varName += str[j];
          j++;
        }
        result += env[varName] ?? "";
        i = j;
        continue;
      }

      // Lone $ or unrecognized pattern
      result += str[i];
      i++;
    } else {
      result += str[i];
      i++;
    }
  }

  return result;
}

/**
 * Expand variables in a string asynchronously (with command substitution support)
 */
export async function expandVariablesAsync(
  str: string,
  ctx: ExpansionContext,
): Promise<string> {
  let result = "";
  let i = 0;

  while (i < str.length) {
    // Handle escaped dollar sign marker (\x01$) - output literal $
    if (str[i] === "\x01" && str[i + 1] === "$") {
      result += "$";
      i += 2;
      continue;
    }

    if (str[i] === "$" && i + 1 < str.length) {
      const nextChar = str[i + 1];

      // Handle $((expr)) arithmetic expansion
      if (nextChar === "(" && str[i + 2] === "(") {
        const closeIndex = findMatchingDoubleParen(str, i + 2);
        if (closeIndex !== -1) {
          const expr = str.slice(i + 3, closeIndex);
          result += evaluateArithmetic(expr, ctx.env);
          i = closeIndex + 2; // skip past ))
          continue;
        }
      }

      // Handle $(cmd) command substitution
      if (nextChar === "(") {
        const closeIndex = findMatchingParen(str, i + 1);
        if (closeIndex !== -1) {
          const cmd = str.slice(i + 2, closeIndex);
          const cmdResult = await ctx.exec(cmd);
          // Command substitution returns stdout with trailing newline removed
          result += cmdResult.stdout.replace(/\n$/, "");
          i = closeIndex + 1;
          continue;
        }
      }

      // Handle ${VAR} and ${VAR:-default}
      if (nextChar === "{") {
        const closeIndex = str.indexOf("}", i + 2);
        if (closeIndex !== -1) {
          const content = str.slice(i + 2, closeIndex);
          const defaultMatch = content.match(/^([^:]+):-(.*)$/);
          if (defaultMatch) {
            const [, varName, defaultValue] = defaultMatch;
            result += ctx.env[varName] ?? defaultValue;
          } else {
            result += ctx.env[content] ?? "";
          }
          i = closeIndex + 1;
          continue;
        }
      }

      // Handle special variables: $@, $#, $$, $?, $!, $*
      if ("@#$?!*".includes(nextChar)) {
        result += ctx.env[nextChar] ?? "";
        i += 2;
        continue;
      }

      // Handle positional parameters: $0, $1, $2, ...
      if (/[0-9]/.test(nextChar)) {
        result += ctx.env[nextChar] ?? "";
        i += 2;
        continue;
      }

      // Handle $VAR
      if (/[A-Za-z_]/.test(nextChar)) {
        let varName = nextChar;
        let j = i + 2;
        while (j < str.length && /[A-Za-z0-9_]/.test(str[j])) {
          varName += str[j];
          j++;
        }
        result += ctx.env[varName] ?? "";
        i = j;
        continue;
      }

      // Lone $ or unrecognized pattern
      result += str[i];
      i++;
    } else {
      result += str[i];
      i++;
    }
  }

  return result;
}

/**
 * Find matching parenthesis, handling nesting
 */
export function findMatchingParen(str: string, start: number): number {
  let depth = 1;
  let i = start + 1;
  while (i < str.length && depth > 0) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") depth--;
    if (depth > 0) i++;
  }
  return depth === 0 ? i : -1;
}

/**
 * Find matching )) for arithmetic expansion
 */
export function findMatchingDoubleParen(str: string, start: number): number {
  let depth = 1;
  let i = start + 1;
  while (i < str.length && depth > 0) {
    if (str[i] === "(" && str[i + 1] === "(") {
      depth++;
      i++;
    } else if (str[i] === ")" && str[i + 1] === ")") {
      depth--;
      if (depth === 0) return i;
      i++;
    }
    i++;
  }
  return -1;
}

/**
 * Evaluate arithmetic expression for $((expr))
 */
export function evaluateArithmetic(
  expr: string,
  env: Record<string, string>,
): string {
  // First expand any variables in the expression
  let expanded = expandVariablesSync(expr, env);

  // Handle variable names without $ prefix (bash allows this in arithmetic)
  expanded = expanded.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
    // Check if it's a number or operator
    if (/^[0-9]+$/.test(match)) return match;
    if (["true", "false"].includes(match)) return match === "true" ? "1" : "0";
    // It's a variable name - look it up
    const value = env[match];
    return value !== undefined ? value : "0";
  });

  try {
    // Evaluate the arithmetic expression safely
    // Support: + - * / % ** ( ) < > <= >= == != && || ! ~ & | ^ << >>
    const result = evalArithmeticExpr(expanded);
    return String(Math.trunc(result));
  } catch {
    return "0";
  }
}

/**
 * Safely evaluate an arithmetic expression
 */
export function evalArithmeticExpr(expr: string): number {
  // Tokenize
  const tokens: (string | number)[] = [];
  let i = 0;
  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i])) {
      i++;
      continue;
    }
    // Number
    if (/[0-9]/.test(expr[i])) {
      let num = "";
      while (i < expr.length && /[0-9]/.test(expr[i])) {
        num += expr[i++];
      }
      tokens.push(parseInt(num, 10));
      continue;
    }
    // Operators (check longer ones first)
    const ops = [
      "**",
      "<<",
      ">>",
      "<=",
      ">=",
      "==",
      "!=",
      "&&",
      "||",
      "+",
      "-",
      "*",
      "/",
      "%",
      "<",
      ">",
      "&",
      "|",
      "^",
      "~",
      "!",
      "(",
      ")",
    ];
    let matched = false;
    for (const op of ops) {
      if (expr.slice(i, i + op.length) === op) {
        tokens.push(op);
        i += op.length;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }

  // Simple recursive descent parser
  let pos = 0;

  const peek = (): string | number | undefined => tokens[pos];
  const consume = (): string | number => tokens[pos++];

  const parseExpr = (): number => parseOr();

  const parseOr = (): number => {
    let left = parseAnd();
    while (peek() === "||") {
      consume();
      const right = parseAnd();
      left = left || right ? 1 : 0;
    }
    return left;
  };

  const parseAnd = (): number => {
    let left = parseBitOr();
    while (peek() === "&&") {
      consume();
      const right = parseBitOr();
      left = left && right ? 1 : 0;
    }
    return left;
  };

  const parseBitOr = (): number => {
    let left = parseBitXor();
    while (peek() === "|") {
      consume();
      left = left | parseBitXor();
    }
    return left;
  };

  const parseBitXor = (): number => {
    let left = parseBitAnd();
    while (peek() === "^") {
      consume();
      left = left ^ parseBitAnd();
    }
    return left;
  };

  const parseBitAnd = (): number => {
    let left = parseEquality();
    while (peek() === "&") {
      consume();
      left = left & parseEquality();
    }
    return left;
  };

  const parseEquality = (): number => {
    let left = parseRelational();
    while (peek() === "==" || peek() === "!=") {
      const op = consume();
      const right = parseRelational();
      left = op === "==" ? (left === right ? 1 : 0) : left !== right ? 1 : 0;
    }
    return left;
  };

  const parseRelational = (): number => {
    let left = parseShift();
    while (
      peek() === "<" ||
      peek() === ">" ||
      peek() === "<=" ||
      peek() === ">="
    ) {
      const op = consume();
      const right = parseShift();
      switch (op) {
        case "<":
          left = left < right ? 1 : 0;
          break;
        case ">":
          left = left > right ? 1 : 0;
          break;
        case "<=":
          left = left <= right ? 1 : 0;
          break;
        case ">=":
          left = left >= right ? 1 : 0;
          break;
      }
    }
    return left;
  };

  const parseShift = (): number => {
    let left = parseAdditive();
    while (peek() === "<<" || peek() === ">>") {
      const op = consume();
      const right = parseAdditive();
      left = op === "<<" ? left << right : left >> right;
    }
    return left;
  };

  const parseAdditive = (): number => {
    let left = parseMultiplicative();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseMultiplicative();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };

  const parseMultiplicative = (): number => {
    let left = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = consume();
      const right = parsePower();
      switch (op) {
        case "*":
          left = left * right;
          break;
        case "/":
          left = right !== 0 ? Math.trunc(left / right) : 0;
          break;
        case "%":
          left = right !== 0 ? left % right : 0;
          break;
      }
    }
    return left;
  };

  const parsePower = (): number => {
    const left = parseUnary();
    if (peek() === "**") {
      consume();
      const right = parsePower(); // right-associative
      return left ** right;
    }
    return left;
  };

  const parseUnary = (): number => {
    if (peek() === "-") {
      consume();
      return -parseUnary();
    }
    if (peek() === "+") {
      consume();
      return parseUnary();
    }
    if (peek() === "!") {
      consume();
      return parseUnary() ? 0 : 1;
    }
    if (peek() === "~") {
      consume();
      return ~parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    if (peek() === "(") {
      consume();
      const val = parseExpr();
      if (peek() === ")") consume();
      return val;
    }
    const token = consume();
    return typeof token === "number" ? token : 0;
  };

  return parseExpr();
}

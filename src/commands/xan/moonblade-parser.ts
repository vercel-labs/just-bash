/**
 * Moonblade expression parser for xan
 *
 * Parses moonblade expressions (xan's expression language) and transforms
 * them to jq AST for evaluation by the shared query engine.
 *
 * Grammar based on xan's grammar.pest
 */

// =============================================================================
// MOONBLADE AST TYPES
// =============================================================================

export type MoonbladeExpr =
  | { type: "int"; value: number }
  | { type: "float"; value: number }
  | { type: "string"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "null" }
  | { type: "identifier"; name: string; unsure: boolean }
  | { type: "underscore" }
  | {
      type: "func";
      name: string;
      args: Array<{ name?: string; expr: MoonbladeExpr }>;
    }
  | { type: "list"; elements: MoonbladeExpr[] }
  | { type: "map"; entries: Array<{ key: string; value: MoonbladeExpr }> }
  | { type: "regex"; pattern: string; caseInsensitive: boolean }
  | { type: "slice"; start?: MoonbladeExpr; end?: MoonbladeExpr }
  | { type: "lambda"; params: string[]; body: MoonbladeExpr }
  | { type: "lambdaBinding"; name: string }
  | { type: "pipeline"; exprs: MoonbladeExpr[] };

export interface NamedExpr {
  expr: MoonbladeExpr;
  name: string | string[];
}

export interface Aggregation {
  aggName: string;
  funcName: string;
  args: MoonbladeExpr[];
}

// =============================================================================
// TOKENIZER
// =============================================================================

type TokenType =
  | "int"
  | "float"
  | "string"
  | "regex"
  | "ident"
  | "true"
  | "false"
  | "null"
  | "("
  | ")"
  | "["
  | "]"
  | "{"
  | "}"
  | ","
  | ":"
  | ";"
  | "=>"
  | "+"
  | "-"
  | "*"
  | "/"
  | "//"
  | "%"
  | "**"
  | "++"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "&&"
  | "||"
  | "and"
  | "or"
  | "!"
  | "."
  | "|"
  | "in"
  | "not in"
  | "as"
  | "="
  | "_"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

class Tokenizer {
  private pos = 0;
  private tokens: Token[] = [];

  constructor(private input: string) {}

  tokenize(): Token[] {
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      const token = this.nextToken();
      if (token) {
        this.tokens.push(token);
      }
    }
    this.tokens.push({ type: "eof", value: "", pos: this.pos });
    return this.tokens;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.pos++;
      } else if (ch === "#") {
        // Skip comment until end of line
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  private nextToken(): Token | null {
    const start = this.pos;
    const ch = this.input[this.pos];

    // Numbers
    if (ch >= "0" && ch <= "9") {
      return this.readNumber();
    }

    // Strings
    if (ch === '"' || ch === "'" || ch === "`") {
      return this.readString(ch);
    }

    // Binary strings
    if (ch === "b" && this.pos + 1 < this.input.length) {
      const next = this.input[this.pos + 1];
      if (next === '"' || next === "'" || next === "`") {
        this.pos++; // skip 'b'
        return this.readString(next);
      }
    }

    // Regex
    if (ch === "/") {
      // Check if this is division or regex
      // If previous token is an operand, it's division
      const prev = this.tokens[this.tokens.length - 1];
      if (
        prev &&
        (prev.type === "int" ||
          prev.type === "float" ||
          prev.type === "string" ||
          prev.type === "ident" ||
          prev.type === ")" ||
          prev.type === "]")
      ) {
        // Division operator
        if (this.input[this.pos + 1] === "/") {
          this.pos += 2;
          return { type: "//", value: "//", pos: start };
        }
        this.pos++;
        return { type: "/", value: "/", pos: start };
      }
      return this.readRegex();
    }

    // Multi-character operators (check longest first)
    if (this.match("not in"))
      return { type: "not in", value: "not in", pos: start };
    if (this.match("=>")) return { type: "=>", value: "=>", pos: start };
    if (this.match("**")) return { type: "**", value: "**", pos: start };
    if (this.match("++")) return { type: "++", value: "++", pos: start };
    if (this.match("//")) return { type: "//", value: "//", pos: start };
    if (this.match("==")) return { type: "==", value: "==", pos: start };
    if (this.match("!=")) return { type: "!=", value: "!=", pos: start };
    if (this.match("<=")) return { type: "<=", value: "<=", pos: start };
    if (this.match(">=")) return { type: ">=", value: ">=", pos: start };
    if (this.match("&&")) return { type: "&&", value: "&&", pos: start };
    if (this.match("||")) return { type: "||", value: "||", pos: start };

    // Single-character operators
    const singleOps: Record<string, TokenType> = {
      "(": "(",
      ")": ")",
      "[": "[",
      "]": "]",
      "{": "{",
      "}": "}",
      ",": ",",
      ":": ":",
      ";": ";",
      "+": "+",
      "-": "-",
      "*": "*",
      "%": "%",
      "<": "<",
      ">": ">",
      "!": "!",
      ".": ".",
      "|": "|",
      "=": "=",
    };

    if (ch in singleOps) {
      this.pos++;
      return { type: singleOps[ch], value: ch, pos: start };
    }

    // Identifiers and keywords
    if (this.isIdentStart(ch)) {
      return this.readIdentifier();
    }

    throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
  }

  private match(str: string): boolean {
    if (this.input.slice(this.pos, this.pos + str.length) === str) {
      // For word-like tokens, ensure not followed by identifier char
      if (/^[a-zA-Z]/.test(str)) {
        const next = this.input[this.pos + str.length];
        if (next && this.isIdentChar(next)) {
          return false;
        }
      }
      this.pos += str.length;
      return true;
    }
    return false;
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isIdentChar(ch: string): boolean {
    return this.isIdentStart(ch) || (ch >= "0" && ch <= "9");
  }

  private readNumber(): Token {
    const start = this.pos;
    let hasDecimal = false;
    let hasExponent = false;

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch >= "0" && ch <= "9") {
        this.pos++;
      } else if (ch === "_") {
        this.pos++;
      } else if (ch === "." && !hasDecimal && !hasExponent) {
        hasDecimal = true;
        this.pos++;
      } else if ((ch === "e" || ch === "E") && !hasExponent) {
        hasExponent = true;
        hasDecimal = true; // Treat as float
        this.pos++;
        if (
          this.pos < this.input.length &&
          (this.input[this.pos] === "+" || this.input[this.pos] === "-")
        ) {
          this.pos++;
        }
      } else {
        break;
      }
    }

    const value = this.input.slice(start, this.pos).replace(/_/g, "");
    return {
      type: hasDecimal ? "float" : "int",
      value,
      pos: start,
    };
  }

  private readString(quote: string): Token {
    const start = this.pos;
    this.pos++; // skip opening quote
    let value = "";

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === quote) {
        this.pos++;
        return { type: "string", value, pos: start };
      }
      if (ch === "\\") {
        this.pos++;
        if (this.pos < this.input.length) {
          const escaped = this.input[this.pos];
          switch (escaped) {
            case "n":
              value += "\n";
              break;
            case "r":
              value += "\r";
              break;
            case "t":
              value += "\t";
              break;
            case "\\":
              value += "\\";
              break;
            case '"':
              value += '"';
              break;
            case "'":
              value += "'";
              break;
            case "`":
              value += "`";
              break;
            case "0":
              value += "\0";
              break;
            default:
              value += escaped;
          }
          this.pos++;
        }
      } else {
        value += ch;
        this.pos++;
      }
    }

    throw new Error(`Unterminated string starting at position ${start}`);
  }

  private readRegex(): Token {
    const start = this.pos;
    this.pos++; // skip opening /
    let pattern = "";
    let flags = "";

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === "/") {
        this.pos++;
        // Read flags
        while (this.pos < this.input.length && this.input[this.pos] === "i") {
          flags += this.input[this.pos];
          this.pos++;
        }
        return {
          type: "regex",
          value: pattern + (flags ? `/${flags}` : ""),
          pos: start,
        };
      }
      if (ch === "\\") {
        pattern += ch;
        this.pos++;
        if (this.pos < this.input.length) {
          pattern += this.input[this.pos];
          this.pos++;
        }
      } else {
        pattern += ch;
        this.pos++;
      }
    }

    throw new Error(`Unterminated regex starting at position ${start}`);
  }

  private readIdentifier(): Token {
    const start = this.pos;
    while (
      this.pos < this.input.length &&
      this.isIdentChar(this.input[this.pos])
    ) {
      this.pos++;
    }

    // Check for trailing ?
    let unsure = false;
    if (this.pos < this.input.length && this.input[this.pos] === "?") {
      unsure = true;
      this.pos++;
    }

    let value = this.input.slice(start, unsure ? this.pos - 1 : this.pos);
    if (unsure) value += "?";

    // Keywords
    const keywords: Record<string, TokenType> = {
      true: "true",
      false: "false",
      null: "null",
      and: "and",
      or: "or",
      eq: "eq",
      ne: "ne",
      lt: "lt",
      le: "le",
      gt: "gt",
      ge: "ge",
      in: "in",
      as: "as",
      _: "_",
    };

    const baseValue = value.replace(/\?$/, "");
    if (baseValue in keywords && !unsure) {
      return { type: keywords[baseValue], value: baseValue, pos: start };
    }

    return { type: "ident", value, pos: start };
  }
}

// =============================================================================
// PARSER (Pratt Parser)
// =============================================================================

// Operator precedence (higher = tighter binding)
const PREC = {
  PIPE: 1,
  OR: 2,
  AND: 3,
  EQUALITY: 4,
  COMPARISON: 5,
  ADDITIVE: 6,
  MULTIPLICATIVE: 7,
  POWER: 8,
  UNARY: 9,
  POSTFIX: 10,
};

class Parser {
  private pos = 0;
  private tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): MoonbladeExpr {
    const expr = this.parseExpr(0);
    if (this.peek().type !== "eof") {
      throw new Error(`Unexpected token: ${this.peek().value}`);
    }
    return expr;
  }

  parseExpr(minPrec: number): MoonbladeExpr {
    let left = this.parsePrefix();

    while (true) {
      const token = this.peek();
      const prec = this.getInfixPrec(token.type);
      if (prec < minPrec) break;

      left = this.parseInfix(left, prec);
    }

    return left;
  }

  private parsePrefix(): MoonbladeExpr {
    const token = this.peek();

    switch (token.type) {
      case "int":
        this.advance();
        return { type: "int", value: Number.parseInt(token.value, 10) };

      case "float":
        this.advance();
        return { type: "float", value: Number.parseFloat(token.value) };

      case "string":
        this.advance();
        return { type: "string", value: token.value };

      case "regex": {
        this.advance();
        const parts = token.value.split("/");
        const flags = parts.length > 1 ? parts[parts.length - 1] : "";
        const pattern = parts.slice(0, -1).join("/") || token.value;
        return { type: "regex", pattern, caseInsensitive: flags.includes("i") };
      }

      case "true":
        this.advance();
        return { type: "bool", value: true };

      case "false":
        this.advance();
        return { type: "bool", value: false };

      case "null":
        this.advance();
        return { type: "null" };

      case "_":
        this.advance();
        return { type: "underscore" };

      case "ident": {
        const name = token.value;
        const unsure = name.endsWith("?");
        const cleanName = unsure ? name.slice(0, -1) : name;
        this.advance();

        // Check if it's a function call
        if (this.peek().type === "(") {
          return this.parseFunctionCall(cleanName);
        }

        // Check if it's a lambda
        if (this.peek().type === "=>") {
          this.advance(); // skip =>
          const body = this.parseExpr(0);
          return this.bindLambdaArgs(
            { type: "lambda", params: [cleanName], body },
            [cleanName],
          );
        }

        return { type: "identifier", name: cleanName, unsure };
      }

      case "(": {
        this.advance();

        // Could be grouping or lambda params
        // Check if this looks like lambda params
        const params: string[] = [];

        if (this.peek().type === ")") {
          // Empty parens - likely lambda with no args
          this.advance();
          if (this.peek().type === "=>") {
            this.advance();
            const body = this.parseExpr(0);
            return { type: "lambda", params: [], body };
          }
          // Empty parens as expression? Treat as empty list?
          throw new Error("Empty parentheses not allowed");
        }

        // Parse first expression/identifier
        if (this.peek().type === "ident") {
          const firstIdent = this.peek().value;
          this.advance();

          if (this.peek().type === "," || this.peek().type === ")") {
            // Could be lambda params
            params.push(firstIdent);

            while (this.peek().type === ",") {
              this.advance();
              if (this.peek().type === "ident") {
                params.push(this.peek().value);
                this.advance();
              } else {
                break;
              }
            }

            if (this.peek().type === ")") {
              this.advance();
              if (this.peek().type === "=>") {
                this.advance();
                const body = this.parseExpr(0);
                return this.bindLambdaArgs(
                  { type: "lambda", params, body },
                  params,
                );
              }
            }

            // Not a lambda, treat as expression
            // Put token back and re-parse
            this.pos -= params.length * 2; // rough approximation
            if (params.length > 1) {
              this.pos = this.pos; // Can't easily backtrack
            }
          }

          // Rewind - we need to parse as expression
          this.pos--;
        }

        // Parse as grouped expression
        const expr = this.parseExpr(0);
        this.expect(")");

        // Check for lambda
        if (this.peek().type === "=>") {
          // This shouldn't happen if we parsed a full expression
        }

        return expr;
      }

      case "[":
        return this.parseList();

      case "{":
        return this.parseMap();

      case "-": {
        this.advance();
        const operand = this.parseExpr(PREC.UNARY);
        // Simplify negative literals
        if (operand.type === "int") {
          return { type: "int", value: -operand.value };
        }
        if (operand.type === "float") {
          return { type: "float", value: -operand.value };
        }
        return { type: "func", name: "neg", args: [{ expr: operand }] };
      }

      case "!": {
        this.advance();
        const operand = this.parseExpr(PREC.UNARY);
        return { type: "func", name: "not", args: [{ expr: operand }] };
      }

      default:
        throw new Error(`Unexpected token: ${token.type} (${token.value})`);
    }
  }

  private parseFunctionCall(name: string): MoonbladeExpr {
    this.expect("(");
    const args: Array<{ name?: string; expr: MoonbladeExpr }> = [];

    if (this.peek().type !== ")") {
      do {
        if (args.length > 0 && this.peek().type === ",") {
          this.advance();
        }

        // Check for named argument: ident=expr
        let argName: string | undefined;
        if (this.peek().type === "ident") {
          const ident = this.peek().value;
          const nextPos = this.pos + 1;
          if (
            nextPos < this.tokens.length &&
            this.tokens[nextPos].type === "="
          ) {
            argName = ident;
            this.advance(); // skip ident
            this.advance(); // skip =
          }
        }

        const expr = this.parseExpr(0);
        args.push({ name: argName, expr });
      } while (this.peek().type === ",");
    }

    this.expect(")");
    return { type: "func", name: name.toLowerCase(), args };
  }

  private parseList(): MoonbladeExpr {
    this.expect("[");
    const elements: MoonbladeExpr[] = [];

    if (this.peek().type !== "]") {
      do {
        if (elements.length > 0 && this.peek().type === ",") {
          this.advance();
        }
        elements.push(this.parseExpr(0));
      } while (this.peek().type === ",");
    }

    this.expect("]");
    return { type: "list", elements };
  }

  private parseMap(): MoonbladeExpr {
    this.expect("{");
    const entries: Array<{ key: string; value: MoonbladeExpr }> = [];

    if (this.peek().type !== "}") {
      do {
        if (entries.length > 0 && this.peek().type === ",") {
          this.advance();
        }

        // Key can be ident or string
        let key: string;
        if (this.peek().type === "ident") {
          key = this.peek().value;
          this.advance();
        } else if (this.peek().type === "string") {
          key = this.peek().value;
          this.advance();
        } else {
          throw new Error(`Expected map key, got ${this.peek().type}`);
        }

        this.expect(":");
        const value = this.parseExpr(0);
        entries.push({ key, value });
      } while (this.peek().type === ",");
    }

    this.expect("}");
    return { type: "map", entries };
  }

  private parseInfix(left: MoonbladeExpr, prec: number): MoonbladeExpr {
    const token = this.peek();

    // Binary operators that map to functions
    const binaryOps: Record<string, string> = {
      "+": "add",
      "-": "sub",
      "*": "mul",
      "/": "div",
      "//": "idiv",
      "%": "mod",
      "**": "pow",
      "++": "concat",
      "==": "==",
      "!=": "!=",
      "<": "<",
      "<=": "<=",
      ">": ">",
      ">=": ">=",
      eq: "eq",
      ne: "ne",
      lt: "lt",
      le: "le",
      gt: "gt",
      ge: "ge",
      "&&": "and",
      and: "and",
      "||": "or",
      or: "or",
    };

    if (token.type in binaryOps) {
      this.advance();
      const right = this.parseExpr(
        prec + (this.isRightAssoc(token.type) ? 0 : 1),
      );
      return {
        type: "func",
        name: binaryOps[token.type],
        args: [{ expr: left }, { expr: right }],
      };
    }

    // Pipe operator
    if (token.type === "|") {
      this.advance();
      const right = this.parseExpr(prec);
      return this.handlePipe(left, right);
    }

    // Dot operator (access/method call)
    if (token.type === ".") {
      this.advance();
      return this.handleDot(left);
    }

    // Indexing
    if (token.type === "[") {
      this.advance();
      return this.handleIndexing(left);
    }

    // In operator
    if (token.type === "in") {
      this.advance();
      const right = this.parseExpr(prec + 1);
      return {
        type: "func",
        name: "contains",
        args: [{ expr: right }, { expr: left }],
      };
    }

    // Not in operator
    if (token.type === "not in") {
      this.advance();
      const right = this.parseExpr(prec + 1);
      return {
        type: "func",
        name: "not",
        args: [
          {
            expr: {
              type: "func",
              name: "contains",
              args: [{ expr: right }, { expr: left }],
            },
          },
        ],
      };
    }

    throw new Error(`Unexpected infix token: ${token.type}`);
  }

  private handlePipe(left: MoonbladeExpr, right: MoonbladeExpr): MoonbladeExpr {
    // If right is an identifier that's a known function, call it with left as arg
    if (right.type === "identifier") {
      // We'd need to check if it's a known function
      // For now, treat as function call
      return { type: "func", name: right.name, args: [{ expr: left }] };
    }

    // If right is a function call, check for underscore
    if (right.type === "func") {
      const underscoreCount = this.countUnderscores(right);
      if (underscoreCount === 0) {
        // Just return the right side (pipe trimming)
        return right;
      }
      if (underscoreCount === 1) {
        // Fill the underscore with left
        return this.fillUnderscore(right, left);
      }
      // Multiple underscores - create pipeline
      return { type: "pipeline", exprs: [left, right] };
    }

    // If right has underscore, fill it
    if (this.countUnderscores(right) === 1) {
      return this.fillUnderscore(right, left);
    }

    return right;
  }

  private handleDot(left: MoonbladeExpr): MoonbladeExpr {
    const token = this.peek();

    // .identifier -> get(left, "identifier")
    if (token.type === "ident") {
      const name = token.value;
      this.advance();

      // Check if it's a method call: .func()
      if (this.peek().type === "(") {
        const call = this.parseFunctionCall(name);
        if (call.type === "func") {
          // Insert left as first argument
          call.args.unshift({ expr: left });
        }
        return call;
      }

      return {
        type: "func",
        name: "get",
        args: [{ expr: left }, { expr: { type: "string", value: name } }],
      };
    }

    // .123 -> get(left, 123)
    if (token.type === "int") {
      const idx = Number.parseInt(token.value, 10);
      this.advance();
      return {
        type: "func",
        name: "get",
        args: [{ expr: left }, { expr: { type: "int", value: idx } }],
      };
    }

    // ."string" -> get(left, "string")
    if (token.type === "string") {
      const key = token.value;
      this.advance();
      return {
        type: "func",
        name: "get",
        args: [{ expr: left }, { expr: { type: "string", value: key } }],
      };
    }

    throw new Error(
      `Expected identifier, number, or string after dot, got ${token.type}`,
    );
  }

  private handleIndexing(left: MoonbladeExpr): MoonbladeExpr {
    // Check for slice
    if (this.peek().type === ":") {
      this.advance();
      if (this.peek().type === "]") {
        // [:] - full slice (not common)
        this.advance();
        return { type: "func", name: "slice", args: [{ expr: left }] };
      }
      // [:end]
      const end = this.parseExpr(0);
      this.expect("]");
      return {
        type: "func",
        name: "slice",
        args: [
          { expr: left },
          { expr: { type: "int", value: 0 } },
          { expr: end },
        ],
      };
    }

    const start = this.parseExpr(0);

    if (this.peek().type === ":") {
      this.advance();
      if (this.peek().type === "]") {
        // [start:]
        this.advance();
        return {
          type: "func",
          name: "slice",
          args: [{ expr: left }, { expr: start }],
        };
      }
      // [start:end]
      const end = this.parseExpr(0);
      this.expect("]");
      return {
        type: "func",
        name: "slice",
        args: [{ expr: left }, { expr: start }, { expr: end }],
      };
    }

    // [index]
    this.expect("]");
    return {
      type: "func",
      name: "get",
      args: [{ expr: left }, { expr: start }],
    };
  }

  private countUnderscores(expr: MoonbladeExpr): number {
    if (expr.type === "underscore") return 1;
    if (expr.type === "func") {
      return expr.args.reduce(
        (sum, arg) => sum + this.countUnderscores(arg.expr),
        0,
      );
    }
    if (expr.type === "list") {
      return expr.elements.reduce(
        (sum, el) => sum + this.countUnderscores(el),
        0,
      );
    }
    if (expr.type === "map") {
      return expr.entries.reduce(
        (sum, e) => sum + this.countUnderscores(e.value),
        0,
      );
    }
    return 0;
  }

  private fillUnderscore(
    expr: MoonbladeExpr,
    fill: MoonbladeExpr,
  ): MoonbladeExpr {
    if (expr.type === "underscore") return fill;
    if (expr.type === "func") {
      return {
        ...expr,
        args: expr.args.map((arg) => ({
          ...arg,
          expr: this.fillUnderscore(arg.expr, fill),
        })),
      };
    }
    if (expr.type === "list") {
      return {
        ...expr,
        elements: expr.elements.map((el) => this.fillUnderscore(el, fill)),
      };
    }
    if (expr.type === "map") {
      return {
        ...expr,
        entries: expr.entries.map((e) => ({
          ...e,
          value: this.fillUnderscore(e.value, fill),
        })),
      };
    }
    return expr;
  }

  private bindLambdaArgs(
    expr: { type: "lambda"; params: string[]; body: MoonbladeExpr },
    names: string[],
  ): MoonbladeExpr {
    return {
      ...expr,
      body: this.bindLambdaArgsInExpr(expr.body, names),
    };
  }

  private bindLambdaArgsInExpr(
    expr: MoonbladeExpr,
    names: string[],
  ): MoonbladeExpr {
    if (expr.type === "identifier" && names.includes(expr.name)) {
      return { type: "lambdaBinding", name: expr.name };
    }
    if (expr.type === "func") {
      return {
        ...expr,
        args: expr.args.map((arg) => ({
          ...arg,
          expr: this.bindLambdaArgsInExpr(arg.expr, names),
        })),
      };
    }
    if (expr.type === "list") {
      return {
        ...expr,
        elements: expr.elements.map((el) =>
          this.bindLambdaArgsInExpr(el, names),
        ),
      };
    }
    if (expr.type === "map") {
      return {
        ...expr,
        entries: expr.entries.map((e) => ({
          ...e,
          value: this.bindLambdaArgsInExpr(e.value, names),
        })),
      };
    }
    return expr;
  }

  private getInfixPrec(type: TokenType): number {
    switch (type) {
      case "|":
        return PREC.PIPE;
      case "||":
      case "or":
        return PREC.OR;
      case "&&":
      case "and":
        return PREC.AND;
      case "==":
      case "!=":
      case "eq":
      case "ne":
        return PREC.EQUALITY;
      case "<":
      case "<=":
      case ">":
      case ">=":
      case "lt":
      case "le":
      case "gt":
      case "ge":
      case "in":
      case "not in":
        return PREC.COMPARISON;
      case "+":
      case "-":
      case "++":
        return PREC.ADDITIVE;
      case "*":
      case "/":
      case "//":
      case "%":
        return PREC.MULTIPLICATIVE;
      case "**":
        return PREC.POWER;
      case ".":
      case "[":
        return PREC.POSTFIX;
      default:
        // Non-infix tokens (like eof, comma, etc.) return -1 to stop parsing
        return -1;
    }
  }

  private isRightAssoc(type: TokenType): boolean {
    return type === "**";
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: "eof", value: "", pos: 0 };
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Expected ${type}, got ${token.type}`);
    }
    return this.advance();
  }
}

// =============================================================================
// NAMED EXPRESSIONS PARSER
// =============================================================================

/**
 * Parse named expressions like: "expr1, expr2 as name, expr3 as (a, b)"
 */
export function parseNamedExpressions(input: string): NamedExpr[] {
  const results: NamedExpr[] = [];
  const tokenizer = new Tokenizer(input);
  const tokens = tokenizer.tokenize();

  let pos = 0;

  const peek = () => tokens[pos] || { type: "eof" as const, value: "", pos: 0 };
  const advance = () => tokens[pos++];

  while (peek().type !== "eof") {
    // Skip leading comma
    if (peek().type === "," && results.length > 0) {
      advance();
      continue;
    }

    // Parse expression
    const exprTokens: Token[] = [];
    let depth = 0;
    const startPos = pos;

    while (peek().type !== "eof") {
      const token = peek();

      if ((token.type === "," || token.type === "as") && depth === 0) {
        break;
      }

      if (token.type === "(" || token.type === "[" || token.type === "{")
        depth++;
      if (token.type === ")" || token.type === "]" || token.type === "}")
        depth--;

      exprTokens.push(advance());
    }

    exprTokens.push({ type: "eof", value: "", pos: 0 });
    const parser = new Parser(exprTokens);
    const expr = parser.parse();

    // Check for "as"
    let name: string | string[];
    if (peek().type === "as") {
      advance(); // skip "as"

      // Check for tuple name
      if (peek().type === "(") {
        advance();
        const names: string[] = [];
        while (peek().type !== ")" && peek().type !== "eof") {
          if (peek().type === "ident" || peek().type === "string") {
            names.push(peek().value);
            advance();
          }
          if (peek().type === ",") advance();
        }
        if (peek().type === ")") advance();
        name = names;
      } else if (peek().type === "ident" || peek().type === "string") {
        name = peek().value;
        advance();
      } else {
        throw new Error(`Expected name after 'as', got ${peek().type}`);
      }
    } else {
      // Use expression text as name
      name = input
        .slice(tokens[startPos].pos, tokens[pos - 1]?.pos || input.length)
        .trim();
      // If it's just an identifier, use that
      if (expr.type === "identifier") {
        name = expr.name;
      }
    }

    results.push({ expr, name });
  }

  return results;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Parse a moonblade expression string into AST
 */
export function parseMoonblade(input: string): MoonbladeExpr {
  const tokenizer = new Tokenizer(input);
  const tokens = tokenizer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

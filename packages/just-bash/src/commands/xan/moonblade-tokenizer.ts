/**
 * Moonblade expression tokenizer
 */

export type TokenType =
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

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export class Tokenizer {
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
    const singleOps = new Map<string, TokenType>([
      ["(", "("],
      [")", ")"],
      ["[", "["],
      ["]", "]"],
      ["{", "{"],
      ["}", "}"],
      [",", ","],
      [":", ":"],
      [";", ";"],
      ["+", "+"],
      ["-", "-"],
      ["*", "*"],
      ["%", "%"],
      ["<", "<"],
      [">", ">"],
      ["!", "!"],
      [".", "."],
      ["|", "|"],
      ["=", "="],
    ]);

    const opType = singleOps.get(ch);
    if (opType !== undefined) {
      this.pos++;
      return { type: opType, value: ch, pos: start };
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
    const keywords = new Map<string, TokenType>([
      ["true", "true"],
      ["false", "false"],
      ["null", "null"],
      ["and", "and"],
      ["or", "or"],
      ["eq", "eq"],
      ["ne", "ne"],
      ["lt", "lt"],
      ["le", "le"],
      ["gt", "gt"],
      ["ge", "ge"],
      ["in", "in"],
      ["as", "as"],
      ["_", "_"],
    ]);

    const baseValue = value.replace(/\?$/, "");
    const keywordType = keywords.get(baseValue);
    if (keywordType !== undefined && !unsure) {
      return { type: keywordType, value: baseValue, pos: start };
    }

    return { type: "ident", value, pos: start };
  }
}

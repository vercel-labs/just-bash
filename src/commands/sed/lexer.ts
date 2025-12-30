/**
 * SED Lexer
 *
 * Tokenizes sed scripts into a stream of tokens.
 * Sed has context-sensitive tokenization - the meaning of characters
 * depends heavily on what command is being parsed.
 */

export enum SedTokenType {
  // Addresses
  NUMBER = "NUMBER",
  DOLLAR = "DOLLAR", // $ - last line
  PATTERN = "PATTERN", // /regex/
  STEP = "STEP", // first~step

  // Structure
  LBRACE = "LBRACE", // {
  RBRACE = "RBRACE", // }
  SEMICOLON = "SEMICOLON", // ;
  NEWLINE = "NEWLINE",
  COMMA = "COMMA", // , - address range separator

  // Commands (single character)
  COMMAND = "COMMAND", // p, d, h, H, g, G, x, n, N, P, D, q, Q, z, =, l, F, v

  // Complex commands (parsed specially)
  SUBSTITUTE = "SUBSTITUTE", // s/pattern/replacement/flags
  TRANSLITERATE = "TRANSLITERATE", // y/source/dest/
  LABEL_DEF = "LABEL_DEF", // :name
  BRANCH = "BRANCH", // b [label]
  BRANCH_ON_SUBST = "BRANCH_ON_SUBST", // t [label]
  BRANCH_ON_NO_SUBST = "BRANCH_ON_NO_SUBST", // T [label]
  TEXT_CMD = "TEXT_CMD", // a\, i\, c\ with text
  FILE_READ = "FILE_READ", // r filename
  FILE_READ_LINE = "FILE_READ_LINE", // R filename
  FILE_WRITE = "FILE_WRITE", // w filename
  FILE_WRITE_LINE = "FILE_WRITE_LINE", // W filename
  EXECUTE = "EXECUTE", // e [command]

  EOF = "EOF",
  ERROR = "ERROR",
}

export interface SedToken {
  type: SedTokenType;
  value: string | number;
  // For complex tokens, additional parsed data
  pattern?: string;
  replacement?: string;
  flags?: string;
  source?: string;
  dest?: string;
  text?: string;
  label?: string;
  filename?: string;
  command?: string; // for execute command
  first?: number; // for step address
  step?: number; // for step address
  line: number;
  column: number;
}

export class SedLexer {
  private input: string;
  private pos = 0;
  private line = 1;
  private column = 1;

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): SedToken[] {
    const tokens: SedToken[] = [];
    while (this.pos < this.input.length) {
      const token = this.nextToken();
      if (token) {
        tokens.push(token);
      }
    }
    tokens.push(this.makeToken(SedTokenType.EOF, ""));
    return tokens;
  }

  private makeToken(
    type: SedTokenType,
    value: string | number,
    extra?: Partial<SedToken>,
  ): SedToken {
    return { type, value, line: this.line, column: this.column, ...extra };
  }

  private peek(offset = 0): string {
    return this.input[this.pos + offset] || "";
  }

  private advance(): string {
    const ch = this.input[this.pos++] || "";
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
      } else if (ch === "#") {
        // Comment - skip to end of line
        while (this.pos < this.input.length && this.peek() !== "\n") {
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  private nextToken(): SedToken | null {
    this.skipWhitespace();

    if (this.pos >= this.input.length) {
      return null;
    }

    const startLine = this.line;
    const startColumn = this.column;
    const ch = this.peek();

    // Newline
    if (ch === "\n") {
      this.advance();
      return {
        type: SedTokenType.NEWLINE,
        value: "\n",
        line: startLine,
        column: startColumn,
      };
    }

    // Semicolon
    if (ch === ";") {
      this.advance();
      return {
        type: SedTokenType.SEMICOLON,
        value: ";",
        line: startLine,
        column: startColumn,
      };
    }

    // Braces
    if (ch === "{") {
      this.advance();
      return {
        type: SedTokenType.LBRACE,
        value: "{",
        line: startLine,
        column: startColumn,
      };
    }
    if (ch === "}") {
      this.advance();
      return {
        type: SedTokenType.RBRACE,
        value: "}",
        line: startLine,
        column: startColumn,
      };
    }

    // Comma (address range separator)
    if (ch === ",") {
      this.advance();
      return {
        type: SedTokenType.COMMA,
        value: ",",
        line: startLine,
        column: startColumn,
      };
    }

    // Dollar (last line address)
    if (ch === "$") {
      this.advance();
      return {
        type: SedTokenType.DOLLAR,
        value: "$",
        line: startLine,
        column: startColumn,
      };
    }

    // Number or step address (first~step)
    if (this.isDigit(ch)) {
      return this.readNumber();
    }

    // Pattern address /regex/
    if (ch === "/") {
      return this.readPattern();
    }

    // Label definition :name
    if (ch === ":") {
      return this.readLabelDef();
    }

    // Commands
    return this.readCommand();
  }

  private readNumber(): SedToken {
    const startLine = this.line;
    const startColumn = this.column;
    let numStr = "";

    while (this.isDigit(this.peek())) {
      numStr += this.advance();
    }

    // Check for step address: first~step
    if (this.peek() === "~") {
      this.advance(); // skip ~
      let stepStr = "";
      while (this.isDigit(this.peek())) {
        stepStr += this.advance();
      }
      const first = parseInt(numStr, 10);
      const step = parseInt(stepStr, 10) || 0;
      return {
        type: SedTokenType.STEP,
        value: `${first}~${step}`,
        first,
        step,
        line: startLine,
        column: startColumn,
      };
    }

    return {
      type: SedTokenType.NUMBER,
      value: parseInt(numStr, 10),
      line: startLine,
      column: startColumn,
    };
  }

  private readPattern(): SedToken {
    const startLine = this.line;
    const startColumn = this.column;
    this.advance(); // skip opening /
    let pattern = "";

    while (this.pos < this.input.length && this.peek() !== "/") {
      if (this.peek() === "\\") {
        pattern += this.advance();
        if (this.pos < this.input.length) {
          pattern += this.advance();
        }
      } else if (this.peek() === "\n") {
        // Unterminated pattern
        break;
      } else {
        pattern += this.advance();
      }
    }

    if (this.peek() === "/") {
      this.advance(); // skip closing /
    }

    return {
      type: SedTokenType.PATTERN,
      value: pattern,
      pattern,
      line: startLine,
      column: startColumn,
    };
  }

  private readLabelDef(): SedToken {
    const startLine = this.line;
    const startColumn = this.column;
    this.advance(); // skip :

    // Read label name (until whitespace, semicolon, newline, or brace)
    let label = "";
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (
        ch === " " ||
        ch === "\t" ||
        ch === "\n" ||
        ch === ";" ||
        ch === "}" ||
        ch === "{"
      ) {
        break;
      }
      label += this.advance();
    }

    return {
      type: SedTokenType.LABEL_DEF,
      value: label,
      label,
      line: startLine,
      column: startColumn,
    };
  }

  private readCommand(): SedToken {
    const startLine = this.line;
    const startColumn = this.column;
    const ch = this.advance();

    switch (ch) {
      case "s":
        return this.readSubstitute(startLine, startColumn);

      case "y":
        return this.readTransliterate(startLine, startColumn);

      case "a":
      case "i":
      case "c":
        return this.readTextCommand(ch, startLine, startColumn);

      case "b":
        return this.readBranch(
          SedTokenType.BRANCH,
          "b",
          startLine,
          startColumn,
        );

      case "t":
        return this.readBranch(
          SedTokenType.BRANCH_ON_SUBST,
          "t",
          startLine,
          startColumn,
        );

      case "T":
        return this.readBranch(
          SedTokenType.BRANCH_ON_NO_SUBST,
          "T",
          startLine,
          startColumn,
        );

      case "r":
        return this.readFileCommand(
          SedTokenType.FILE_READ,
          "r",
          startLine,
          startColumn,
        );

      case "R":
        return this.readFileCommand(
          SedTokenType.FILE_READ_LINE,
          "R",
          startLine,
          startColumn,
        );

      case "w":
        return this.readFileCommand(
          SedTokenType.FILE_WRITE,
          "w",
          startLine,
          startColumn,
        );

      case "W":
        return this.readFileCommand(
          SedTokenType.FILE_WRITE_LINE,
          "W",
          startLine,
          startColumn,
        );

      case "e":
        return this.readExecute(startLine, startColumn);

      case "p":
      case "P":
      case "d":
      case "D":
      case "h":
      case "H":
      case "g":
      case "G":
      case "x":
      case "n":
      case "N":
      case "q":
      case "Q":
      case "z":
      case "=":
      case "l":
      case "F":
      case "v":
        return {
          type: SedTokenType.COMMAND,
          value: ch,
          line: startLine,
          column: startColumn,
        };

      default:
        return {
          type: SedTokenType.ERROR,
          value: ch,
          line: startLine,
          column: startColumn,
        };
    }
  }

  private readSubstitute(startLine: number, startColumn: number): SedToken {
    // Already consumed 's'
    // Read delimiter
    const delimiter = this.advance();
    if (!delimiter || delimiter === "\n") {
      return {
        type: SedTokenType.ERROR,
        value: "s",
        line: startLine,
        column: startColumn,
      };
    }

    // Read pattern
    let pattern = "";
    while (this.pos < this.input.length && this.peek() !== delimiter) {
      if (this.peek() === "\\") {
        pattern += this.advance();
        if (this.pos < this.input.length && this.peek() !== "\n") {
          pattern += this.advance();
        }
      } else if (this.peek() === "\n") {
        break;
      } else {
        pattern += this.advance();
      }
    }

    if (this.peek() !== delimiter) {
      return {
        type: SedTokenType.ERROR,
        value: "unterminated substitution pattern",
        line: startLine,
        column: startColumn,
      };
    }
    this.advance(); // skip middle delimiter

    // Read replacement
    let replacement = "";
    while (this.pos < this.input.length && this.peek() !== delimiter) {
      if (this.peek() === "\\") {
        replacement += this.advance();
        if (this.pos < this.input.length && this.peek() !== "\n") {
          replacement += this.advance();
        }
      } else if (this.peek() === "\n") {
        break;
      } else {
        replacement += this.advance();
      }
    }

    // Closing delimiter is optional for last part
    if (this.peek() === delimiter) {
      this.advance();
    }

    // Read flags
    let flags = "";
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (
        ch === "g" ||
        ch === "i" ||
        ch === "p" ||
        ch === "I" ||
        this.isDigit(ch)
      ) {
        flags += this.advance();
      } else {
        break;
      }
    }

    return {
      type: SedTokenType.SUBSTITUTE,
      value: `s${delimiter}${pattern}${delimiter}${replacement}${delimiter}${flags}`,
      pattern,
      replacement,
      flags,
      line: startLine,
      column: startColumn,
    };
  }

  private readTransliterate(startLine: number, startColumn: number): SedToken {
    // Already consumed 'y'
    const delimiter = this.advance();
    if (!delimiter || delimiter === "\n") {
      return {
        type: SedTokenType.ERROR,
        value: "y",
        line: startLine,
        column: startColumn,
      };
    }

    // Read source characters
    let source = "";
    while (this.pos < this.input.length && this.peek() !== delimiter) {
      if (this.peek() === "\\") {
        this.advance();
        const escaped = this.advance();
        if (escaped === "n") source += "\n";
        else if (escaped === "t") source += "\t";
        else source += escaped;
      } else if (this.peek() === "\n") {
        break;
      } else {
        source += this.advance();
      }
    }

    if (this.peek() !== delimiter) {
      return {
        type: SedTokenType.ERROR,
        value: "unterminated transliteration source",
        line: startLine,
        column: startColumn,
      };
    }
    this.advance(); // skip middle delimiter

    // Read dest characters
    let dest = "";
    while (this.pos < this.input.length && this.peek() !== delimiter) {
      if (this.peek() === "\\") {
        this.advance();
        const escaped = this.advance();
        if (escaped === "n") dest += "\n";
        else if (escaped === "t") dest += "\t";
        else dest += escaped;
      } else if (this.peek() === "\n") {
        break;
      } else {
        dest += this.advance();
      }
    }

    if (this.peek() === delimiter) {
      this.advance(); // skip closing delimiter
    }

    return {
      type: SedTokenType.TRANSLITERATE,
      value: `y${delimiter}${source}${delimiter}${dest}${delimiter}`,
      source,
      dest,
      line: startLine,
      column: startColumn,
    };
  }

  private readTextCommand(
    cmd: string,
    startLine: number,
    startColumn: number,
  ): SedToken {
    // a\, i\, c\ followed by text
    // Skip optional backslash and space
    if (this.peek() === "\\") {
      this.advance();
    }
    if (this.peek() === " ") {
      this.advance();
    }

    // Read text until newline (for single line) or handle multi-line with backslash continuation
    let text = "";
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (ch === "\n") {
        break;
      }
      text += this.advance();
    }

    return {
      type: SedTokenType.TEXT_CMD,
      value: cmd,
      text: text.trim(),
      line: startLine,
      column: startColumn,
    };
  }

  private readBranch(
    type: SedTokenType,
    cmd: string,
    startLine: number,
    startColumn: number,
  ): SedToken {
    // Skip whitespace
    while (this.peek() === " " || this.peek() === "\t") {
      this.advance();
    }

    // Read optional label
    let label = "";
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (
        ch === " " ||
        ch === "\t" ||
        ch === "\n" ||
        ch === ";" ||
        ch === "}" ||
        ch === "{"
      ) {
        break;
      }
      label += this.advance();
    }

    return {
      type,
      value: cmd,
      label: label || undefined,
      line: startLine,
      column: startColumn,
    };
  }

  private readFileCommand(
    type: SedTokenType,
    cmd: string,
    startLine: number,
    startColumn: number,
  ): SedToken {
    // Skip whitespace (but not newline)
    while (this.peek() === " " || this.peek() === "\t") {
      this.advance();
    }

    // Read filename until newline or semicolon
    let filename = "";
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (ch === "\n" || ch === ";") {
        break;
      }
      filename += this.advance();
    }

    return {
      type,
      value: cmd,
      filename: filename.trim(),
      line: startLine,
      column: startColumn,
    };
  }

  private readExecute(startLine: number, startColumn: number): SedToken {
    // Skip whitespace
    while (this.peek() === " " || this.peek() === "\t") {
      this.advance();
    }

    // Read optional command until newline or semicolon
    let command = "";
    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (ch === "\n" || ch === ";") {
        break;
      }
      command += this.advance();
    }

    return {
      type: SedTokenType.EXECUTE,
      value: "e",
      command: command.trim() || undefined,
      line: startLine,
      column: startColumn,
    };
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }
}

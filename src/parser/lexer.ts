/**
 * Lexer for Bash Scripts
 *
 * The lexer tokenizes input into a stream of tokens that the parser consumes.
 * It handles:
 * - Operators and delimiters
 * - Words (with quoting rules)
 * - Comments
 * - Here-documents
 * - Escape sequences
 */

export enum TokenType {
  // End of input
  EOF = "EOF",

  // Newlines and separators
  NEWLINE = "NEWLINE",
  SEMICOLON = "SEMICOLON",
  AMP = "AMP", // &

  // Operators
  PIPE = "PIPE", // |
  PIPE_AMP = "PIPE_AMP", // |&
  AND_AND = "AND_AND", // &&
  OR_OR = "OR_OR", // ||
  BANG = "BANG", // !

  // Redirections
  LESS = "LESS", // <
  GREAT = "GREAT", // >
  DLESS = "DLESS", // <<
  DGREAT = "DGREAT", // >>
  LESSAND = "LESSAND", // <&
  GREATAND = "GREATAND", // >&
  LESSGREAT = "LESSGREAT", // <>
  DLESSDASH = "DLESSDASH", // <<-
  CLOBBER = "CLOBBER", // >|
  TLESS = "TLESS", // <<<
  AND_GREAT = "AND_GREAT", // &>
  AND_DGREAT = "AND_DGREAT", // &>>

  // Grouping
  LPAREN = "LPAREN", // (
  RPAREN = "RPAREN", // )
  LBRACE = "LBRACE", // {
  RBRACE = "RBRACE", // }

  // Special
  DSEMI = "DSEMI", // ;;
  SEMI_AND = "SEMI_AND", // ;&
  SEMI_SEMI_AND = "SEMI_SEMI_AND", // ;;&

  // Compound commands
  DBRACK_START = "DBRACK_START", // [[
  DBRACK_END = "DBRACK_END", // ]]
  DPAREN_START = "DPAREN_START", // ((
  DPAREN_END = "DPAREN_END", // ))

  // Reserved words
  IF = "IF",
  THEN = "THEN",
  ELSE = "ELSE",
  ELIF = "ELIF",
  FI = "FI",
  FOR = "FOR",
  WHILE = "WHILE",
  UNTIL = "UNTIL",
  DO = "DO",
  DONE = "DONE",
  CASE = "CASE",
  ESAC = "ESAC",
  IN = "IN",
  FUNCTION = "FUNCTION",
  SELECT = "SELECT",
  TIME = "TIME",
  COPROC = "COPROC",

  // Words and identifiers
  WORD = "WORD",
  NAME = "NAME", // Valid variable name
  NUMBER = "NUMBER", // For redirections like 2>&1
  ASSIGNMENT_WORD = "ASSIGNMENT_WORD", // VAR=value

  // Comments
  COMMENT = "COMMENT",

  // Here-document content
  HEREDOC_CONTENT = "HEREDOC_CONTENT",
}

export interface Token {
  type: TokenType;
  value: string;
  /** Original position in input */
  start: number;
  end: number;
  line: number;
  column: number;
  /** For WORD tokens: quote information */
  quoted?: boolean;
  singleQuoted?: boolean;
}

/**
 * Reserved words in bash
 */
const RESERVED_WORDS: Record<string, TokenType> = {
  if: TokenType.IF,
  // biome-ignore lint/suspicious/noThenProperty: "then" is a bash reserved word
  then: TokenType.THEN,
  else: TokenType.ELSE,
  elif: TokenType.ELIF,
  fi: TokenType.FI,
  for: TokenType.FOR,
  while: TokenType.WHILE,
  until: TokenType.UNTIL,
  do: TokenType.DO,
  done: TokenType.DONE,
  case: TokenType.CASE,
  esac: TokenType.ESAC,
  in: TokenType.IN,
  function: TokenType.FUNCTION,
  select: TokenType.SELECT,
  time: TokenType.TIME,
  coproc: TokenType.COPROC,
};

/**
 * Check if a string is a valid variable name
 */
function isValidName(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

/**
 * Lexer class
 */
export class Lexer {
  private input: string;
  private pos = 0;
  private line = 1;
  private column = 1;
  private tokens: Token[] = [];
  private pendingHeredocs: {
    delimiter: string;
    stripTabs: boolean;
    quoted: boolean;
  }[] = [];

  constructor(input: string) {
    this.input = input;
  }

  /**
   * Tokenize the entire input
   */
  tokenize(): Token[] {
    const input = this.input;
    const len = input.length;
    const tokens = this.tokens;
    const pendingHeredocs = this.pendingHeredocs;

    while (this.pos < len) {
      this.skipWhitespace();

      if (this.pos >= len) break;

      // Check for pending here-documents after newline
      if (
        pendingHeredocs.length > 0 &&
        tokens.length > 0 &&
        tokens[tokens.length - 1].type === TokenType.NEWLINE
      ) {
        this.readHeredocContent();
        continue;
      }

      const token = this.nextToken();
      if (token) {
        tokens.push(token);
      }
    }

    // Add EOF token
    tokens.push({
      type: TokenType.EOF,
      value: "",
      start: this.pos,
      end: this.pos,
      line: this.line,
      column: this.column,
    });

    return tokens;
  }

  private skipWhitespace(): void {
    const input = this.input;
    const len = input.length;
    let pos = this.pos;
    let col = this.column;
    let ln = this.line;

    while (pos < len) {
      const char = input[pos];
      if (char === " " || char === "\t") {
        pos++;
        col++;
      } else if (char === "\\" && input[pos + 1] === "\n") {
        // Line continuation
        pos += 2;
        ln++;
        col = 1;
      } else {
        break;
      }
    }

    this.pos = pos;
    this.column = col;
    this.line = ln;
  }

  private nextToken(): Token | null {
    const input = this.input;
    const pos = this.pos;
    const startLine = this.line;
    const startColumn = this.column;
    const c0 = input[pos];
    const c1 = input[pos + 1];
    const c2 = input[pos + 2];

    // Comments
    if (c0 === "#") {
      return this.readComment(pos, startLine, startColumn);
    }

    // Newline
    if (c0 === "\n") {
      this.pos = pos + 1;
      this.line++;
      this.column = 1;
      return {
        type: TokenType.NEWLINE,
        value: "\n",
        start: pos,
        end: pos + 1,
        line: startLine,
        column: startColumn,
      };
    }

    // Three-character operators (check longer ones first)
    if (c0 === ";" && c1 === ";" && c2 === "&") {
      this.pos = pos + 3;
      this.column = startColumn + 3;
      return this.makeToken(
        TokenType.SEMI_SEMI_AND,
        ";;&",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "<" && c1 === "<" && c2 === "<") {
      this.pos = pos + 3;
      this.column = startColumn + 3;
      return this.makeToken(
        TokenType.TLESS,
        "<<<",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "&" && c1 === ">" && c2 === ">") {
      this.pos = pos + 3;
      this.column = startColumn + 3;
      return this.makeToken(
        TokenType.AND_DGREAT,
        "&>>",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "<" && c1 === "<" && c2 === "-") {
      this.pos = pos + 3;
      this.column = startColumn + 3;
      this.registerHeredocFromLookahead(true);
      return this.makeToken(
        TokenType.DLESSDASH,
        "<<-",
        pos,
        startLine,
        startColumn,
      );
    }

    // Two-character operators
    if (c0 === "[" && c1 === "[") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.DBRACK_START,
        "[[",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "]" && c1 === "]") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.DBRACK_END,
        "]]",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "(" && c1 === "(") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.DPAREN_START,
        "((",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === ")" && c1 === ")") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.DPAREN_END,
        "))",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "&" && c1 === "&") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.AND_AND,
        "&&",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "|" && c1 === "|") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(TokenType.OR_OR, "||", pos, startLine, startColumn);
    }
    if (c0 === ";" && c1 === ";") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(TokenType.DSEMI, ";;", pos, startLine, startColumn);
    }
    if (c0 === ";" && c1 === "&") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.SEMI_AND,
        ";&",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "|" && c1 === "&") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.PIPE_AMP,
        "|&",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "<" && c1 === "<") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      this.registerHeredocFromLookahead(false);
      return this.makeToken(TokenType.DLESS, "<<", pos, startLine, startColumn);
    }
    if (c0 === ">" && c1 === ">") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.DGREAT,
        ">>",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "<" && c1 === "&") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.LESSAND,
        "<&",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === ">" && c1 === "&") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.GREATAND,
        ">&",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "<" && c1 === ">") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.LESSGREAT,
        "<>",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === ">" && c1 === "|") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.CLOBBER,
        ">|",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "&" && c1 === ">") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      return this.makeToken(
        TokenType.AND_GREAT,
        "&>",
        pos,
        startLine,
        startColumn,
      );
    }

    // Single-character operators
    if (c0 === "|") {
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.PIPE, "|", pos, startLine, startColumn);
    }
    if (c0 === "&") {
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.AMP, "&", pos, startLine, startColumn);
    }
    if (c0 === ";") {
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(
        TokenType.SEMICOLON,
        ";",
        pos,
        startLine,
        startColumn,
      );
    }
    if (c0 === "(") {
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.LPAREN, "(", pos, startLine, startColumn);
    }
    if (c0 === ")") {
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.RPAREN, ")", pos, startLine, startColumn);
    }
    if (c0 === "{") {
      // Check for {} as a word (used in find -exec)
      if (c1 === "}") {
        this.pos = pos + 2;
        this.column = startColumn + 2;
        return {
          type: TokenType.WORD,
          value: "{}",
          start: pos,
          end: pos + 2,
          line: startLine,
          column: startColumn,
          quoted: false,
          singleQuoted: false,
        };
      }
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.LBRACE, "{", pos, startLine, startColumn);
    }
    if (c0 === "}") {
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.RBRACE, "}", pos, startLine, startColumn);
    }
    if (c0 === "<") {
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.LESS, "<", pos, startLine, startColumn);
    }
    if (c0 === ">") {
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.GREAT, ">", pos, startLine, startColumn);
    }
    if (c0 === "!") {
      // Check for != operator (used in [[ ]] tests)
      if (c1 === "=") {
        this.pos = pos + 2;
        this.column = startColumn + 2;
        return this.makeToken(
          TokenType.WORD,
          "!=",
          pos,
          startLine,
          startColumn,
        );
      }
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.BANG, "!", pos, startLine, startColumn);
    }

    // Words
    return this.readWord(pos, startLine, startColumn);
  }

  private makeToken(
    type: TokenType,
    value: string,
    start: number,
    line: number,
    column: number,
  ): Token {
    return {
      type,
      value,
      start,
      end: this.pos,
      line,
      column,
    };
  }

  private readComment(start: number, line: number, column: number): Token {
    const input = this.input;
    const len = input.length;
    let pos = this.pos;

    // Find end of comment (newline or EOF)
    while (pos < len && input[pos] !== "\n") {
      pos++;
    }

    const value = input.slice(start, pos);
    this.pos = pos;
    this.column = column + (pos - start);

    return {
      type: TokenType.COMMENT,
      value,
      start,
      end: pos,
      line,
      column,
    };
  }

  private readWord(start: number, line: number, column: number): Token {
    // Cache instance properties in locals for faster access in tight loop
    const input = this.input;
    const len = input.length;
    let pos = this.pos;

    // Fast path: scan for simple word (no quotes, escapes, or expansions)
    // This handles the majority of tokens like command names, filenames, options
    const fastStart = pos;
    while (pos < len) {
      const c = input[pos];
      // Break on any special character
      if (
        c === " " ||
        c === "\t" ||
        c === "\n" ||
        c === ";" ||
        c === "&" ||
        c === "|" ||
        c === "(" ||
        c === ")" ||
        c === "<" ||
        c === ">" ||
        c === "#" ||
        c === "'" ||
        c === '"' ||
        c === "\\" ||
        c === "$" ||
        c === "`" ||
        c === "{" ||
        c === "}" ||
        c === "~" ||
        c === "*" ||
        c === "?" ||
        c === "["
      ) {
        break;
      }
      pos++;
    }

    // If we consumed characters and hit a word boundary (not a special char needing processing)
    if (pos > fastStart) {
      const c = input[pos];
      // If we hit end or a simple delimiter, we can use the fast path result
      if (
        pos >= len ||
        c === " " ||
        c === "\t" ||
        c === "\n" ||
        c === ";" ||
        c === "&" ||
        c === "|" ||
        c === "(" ||
        c === ")" ||
        c === "<" ||
        c === ">" ||
        c === "#"
      ) {
        const value = input.slice(fastStart, pos);
        this.pos = pos;
        this.column = column + (pos - fastStart);

        // Check for reserved words
        if (RESERVED_WORDS[value]) {
          return {
            type: RESERVED_WORDS[value],
            value,
            start,
            end: pos,
            line,
            column,
          };
        }

        // Check for assignment
        const eqIdx = value.indexOf("=");
        if (
          eqIdx > 0 &&
          /^[a-zA-Z_][a-zA-Z0-9_]*\+?$/.test(value.slice(0, eqIdx))
        ) {
          return {
            type: TokenType.ASSIGNMENT_WORD,
            value,
            start,
            end: pos,
            line,
            column,
          };
        }

        // Check for number
        if (/^[0-9]+$/.test(value)) {
          return {
            type: TokenType.NUMBER,
            value,
            start,
            end: pos,
            line,
            column,
          };
        }

        // Check for valid name
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
          return {
            type: TokenType.NAME,
            value,
            start,
            end: pos,
            line,
            column,
            quoted: false,
            singleQuoted: false,
          };
        }

        return {
          type: TokenType.WORD,
          value,
          start,
          end: pos,
          line,
          column,
          quoted: false,
          singleQuoted: false,
        };
      }
    }

    // Slow path: handle complex words with quotes, escapes, expansions
    pos = this.pos; // Reset position
    let col = this.column;
    let ln = this.line;

    let value = "";
    let quoted = false;
    let singleQuoted = false;
    let inSingleQuote = false;
    let inDoubleQuote = false;

    while (pos < len) {
      const char = input[pos];

      // Check for word boundaries
      if (!inSingleQuote && !inDoubleQuote) {
        if (
          char === " " ||
          char === "\t" ||
          char === "\n" ||
          char === ";" ||
          char === "&" ||
          char === "|" ||
          char === "(" ||
          char === ")" ||
          char === "<" ||
          char === ">" ||
          char === "#"
        ) {
          break;
        }
      }

      // Handle quotes
      if (char === "'" && !inDoubleQuote) {
        if (inSingleQuote) {
          inSingleQuote = false;
        } else {
          inSingleQuote = true;
          singleQuoted = true;
          quoted = true;
        }
        pos++;
        col++;
        continue;
      }

      if (char === '"' && !inSingleQuote) {
        if (inDoubleQuote) {
          inDoubleQuote = false;
        } else {
          inDoubleQuote = true;
          quoted = true;
        }
        pos++;
        col++;
        continue;
      }

      // Handle escapes
      if (char === "\\" && !inSingleQuote && pos + 1 < len) {
        const nextChar = input[pos + 1];
        if (nextChar === "\n") {
          // Line continuation
          pos += 2;
          ln++;
          col = 1;
          continue;
        }
        if (inDoubleQuote) {
          // In double quotes, only certain escapes are special
          if (
            nextChar === '"' ||
            nextChar === "\\" ||
            nextChar === "$" ||
            nextChar === "`" ||
            nextChar === "\n"
          ) {
            // For $ and ` keep the backslash so parser knows not to expand
            if (nextChar === "$" || nextChar === "`") {
              value += char + nextChar; // Keep backslash + char
            } else {
              value += nextChar;
            }
            pos += 2;
            col += 2;
            continue;
          }
        } else {
          // Outside quotes, backslash escapes next character
          value += nextChar;
          pos += 2;
          col += 2;
          continue;
        }
      }

      // Handle $(...) command substitution - consume the entire construct
      if (char === "$" && pos + 1 < len && input[pos + 1] === "(") {
        value += char;
        pos++;
        col++;
        // Now consume the $(...)
        value += input[pos]; // Add the (
        pos++;
        col++;
        // Track parenthesis depth
        let depth = 1;
        while (depth > 0 && pos < len) {
          const c = input[pos];
          value += c;
          if (c === "(") depth++;
          else if (c === ")") depth--;
          else if (c === "\n") {
            ln++;
            col = 0;
          }
          pos++;
          col++;
        }
        continue;
      }

      // Handle ${...} parameter expansion - consume the entire construct
      if (char === "$" && pos + 1 < len && input[pos + 1] === "{") {
        value += char;
        pos++;
        col++;
        // Now consume the ${...}
        value += input[pos]; // Add the {
        pos++;
        col++;
        // Track brace depth
        let depth = 1;
        while (depth > 0 && pos < len) {
          const c = input[pos];
          value += c;
          if (c === "{") depth++;
          else if (c === "}") depth--;
          else if (c === "\n") {
            ln++;
            col = 0;
          }
          pos++;
          col++;
        }
        continue;
      }

      // Handle special variables $#, $?, $$, $!, $0-$9, $@, $*
      if (char === "$" && pos + 1 < len) {
        const next = input[pos + 1];
        if (
          next === "#" ||
          next === "?" ||
          next === "$" ||
          next === "!" ||
          next === "@" ||
          next === "*" ||
          next === "-" ||
          (next >= "0" && next <= "9")
        ) {
          value += char + next;
          pos += 2;
          col += 2;
          continue;
        }
      }

      // Handle backtick command substitution - consume the entire construct
      if (char === "`") {
        value += char;
        pos++;
        col++;
        // Find the matching backtick
        while (pos < len && input[pos] !== "`") {
          const c = input[pos];
          value += c;
          if (c === "\\" && pos + 1 < len) {
            value += input[pos + 1];
            pos++;
            col++;
          }
          if (c === "\n") {
            ln++;
            col = 0;
          }
          pos++;
          col++;
        }
        if (pos < len) {
          value += input[pos]; // closing backtick
          pos++;
          col++;
        }
        continue;
      }

      // Regular character
      value += char;
      pos++;
      if (char === "\n") {
        ln++;
        col = 1;
      } else {
        col++;
      }
    }

    // Write back to instance
    this.pos = pos;
    this.column = col;
    this.line = ln;

    if (value === "") {
      return {
        type: TokenType.WORD,
        value: "",
        start,
        end: pos,
        line,
        column,
        quoted,
        singleQuoted,
      };
    }

    // Check for reserved words (only if not quoted)
    if (!quoted && RESERVED_WORDS[value]) {
      return {
        type: RESERVED_WORDS[value],
        value,
        start,
        end: pos,
        line,
        column,
      };
    }

    // Check for assignment (VAR=value or VAR+=value)
    if (!quoted) {
      const assignMatch = value.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\+?=/);
      if (assignMatch) {
        return {
          type: TokenType.ASSIGNMENT_WORD,
          value,
          start,
          end: pos,
          line,
          column,
        };
      }
    }

    // Check for number (for redirections)
    if (/^[0-9]+$/.test(value)) {
      return {
        type: TokenType.NUMBER,
        value,
        start,
        end: pos,
        line,
        column,
      };
    }

    // Check for valid name
    if (isValidName(value)) {
      return {
        type: TokenType.NAME,
        value,
        start,
        end: pos,
        line,
        column,
        quoted,
        singleQuoted,
      };
    }

    return {
      type: TokenType.WORD,
      value,
      start,
      end: pos,
      line,
      column,
      quoted,
      singleQuoted,
    };
  }

  private readHeredocContent(): void {
    // Process each pending here-document
    while (this.pendingHeredocs.length > 0) {
      const heredoc = this.pendingHeredocs.shift();
      if (!heredoc) break;
      const start = this.pos;
      const startLine = this.line;
      const startColumn = this.column;
      let content = "";

      // Read until we find the delimiter on its own line
      while (this.pos < this.input.length) {
        const _lineStart = this.pos;
        let line = "";

        // Read one line
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
          line += this.input[this.pos];
          this.pos++;
          this.column++;
        }

        // Check for delimiter
        const lineToCheck = heredoc.stripTabs ? line.replace(/^\t+/, "") : line;
        if (lineToCheck === heredoc.delimiter) {
          // Consume the newline
          if (this.pos < this.input.length && this.input[this.pos] === "\n") {
            this.pos++;
            this.line++;
            this.column = 1;
          }
          break;
        }

        content += line;
        if (this.pos < this.input.length && this.input[this.pos] === "\n") {
          content += "\n";
          this.pos++;
          this.line++;
          this.column = 1;
        }
      }

      this.tokens.push({
        type: TokenType.HEREDOC_CONTENT,
        value: content,
        start,
        end: this.pos,
        line: startLine,
        column: startColumn,
      });
    }
  }

  /**
   * Register a here-document to be read after the next newline
   */
  addPendingHeredoc(
    delimiter: string,
    stripTabs: boolean,
    quoted: boolean,
  ): void {
    this.pendingHeredocs.push({ delimiter, stripTabs, quoted });
  }

  /**
   * Look ahead from current position to find the here-doc delimiter
   * and register it as a pending here-doc
   */
  private registerHeredocFromLookahead(stripTabs: boolean): void {
    // Save position (we're just looking ahead, the actual tokens will be parsed later)
    const savedPos = this.pos;
    const savedColumn = this.column;

    // Skip whitespace (but not newlines)
    while (
      this.pos < this.input.length &&
      (this.input[this.pos] === " " || this.input[this.pos] === "\t")
    ) {
      this.pos++;
      this.column++;
    }

    // Read the delimiter
    let delimiter = "";
    let quoted = false;
    const char = this.input[this.pos];

    if (char === "'" || char === '"') {
      // Quoted delimiter - no expansion will happen
      quoted = true;
      const quoteChar = char;
      this.pos++;
      this.column++;
      while (
        this.pos < this.input.length &&
        this.input[this.pos] !== quoteChar
      ) {
        delimiter += this.input[this.pos];
        this.pos++;
        this.column++;
      }
      // Skip closing quote (but don't consume it - let the token reader handle it)
    } else {
      // Unquoted delimiter
      while (
        this.pos < this.input.length &&
        !/[\s;<>&|()]/.test(this.input[this.pos])
      ) {
        delimiter += this.input[this.pos];
        this.pos++;
        this.column++;
      }
    }

    // Restore position so actual tokenization continues normally
    this.pos = savedPos;
    this.column = savedColumn;

    // Register the here-doc if we found a delimiter
    if (delimiter) {
      this.pendingHeredocs.push({ delimiter, stripTabs, quoted });
    }
  }
}

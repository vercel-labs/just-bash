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
    while (this.pos < this.input.length) {
      this.skipWhitespace();

      if (this.pos >= this.input.length) break;

      // Check for pending here-documents after newline
      if (
        this.pendingHeredocs.length > 0 &&
        this.tokens.length > 0 &&
        this.tokens[this.tokens.length - 1].type === TokenType.NEWLINE
      ) {
        this.readHeredocContent();
        continue;
      }

      const token = this.nextToken();
      if (token) {
        this.tokens.push(token);
      }
    }

    // Add EOF token
    this.tokens.push({
      type: TokenType.EOF,
      value: "",
      start: this.pos,
      end: this.pos,
      line: this.line,
      column: this.column,
    });

    return this.tokens;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const char = this.input[this.pos];
      if (char === " " || char === "\t") {
        this.pos++;
        this.column++;
      } else if (char === "\\" && this.input[this.pos + 1] === "\n") {
        // Line continuation
        this.pos += 2;
        this.line++;
        this.column = 1;
      } else {
        break;
      }
    }
  }

  private nextToken(): Token | null {
    const start = this.pos;
    const startLine = this.line;
    const startColumn = this.column;
    const char = this.input[this.pos];

    // Comments
    if (char === "#") {
      return this.readComment(start, startLine, startColumn);
    }

    // Newline
    if (char === "\n") {
      this.pos++;
      this.line++;
      this.column = 1;
      return {
        type: TokenType.NEWLINE,
        value: "\n",
        start,
        end: this.pos,
        line: startLine,
        column: startColumn,
      };
    }

    // Multi-character operators (check longer ones first)
    const twoChar = this.input.slice(this.pos, this.pos + 2);
    const threeChar = this.input.slice(this.pos, this.pos + 3);

    // Three-character operators
    if (threeChar === ";;&") {
      this.pos += 3;
      this.column += 3;
      return this.makeToken(
        TokenType.SEMI_SEMI_AND,
        threeChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (threeChar === "<<<") {
      this.pos += 3;
      this.column += 3;
      return this.makeToken(
        TokenType.TLESS,
        threeChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (threeChar === "&>>") {
      this.pos += 3;
      this.column += 3;
      return this.makeToken(
        TokenType.AND_DGREAT,
        threeChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (threeChar === "<<-") {
      this.pos += 3;
      this.column += 3;
      // Look ahead for here-doc delimiter and register it
      this.registerHeredocFromLookahead(true);
      return this.makeToken(
        TokenType.DLESSDASH,
        threeChar,
        start,
        startLine,
        startColumn,
      );
    }

    // Two-character operators
    if (twoChar === "[[") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.DBRACK_START,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === "]]") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.DBRACK_END,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === "((") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.DPAREN_START,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === "))") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.DPAREN_END,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === "&&") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.AND_AND,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === "||") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.OR_OR,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === ";;") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.DSEMI,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === ";&") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.SEMI_AND,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === "|&") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.PIPE_AMP,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === "<<") {
      this.pos += 2;
      this.column += 2;
      // Look ahead for here-doc delimiter and register it
      this.registerHeredocFromLookahead(false);
      return this.makeToken(
        TokenType.DLESS,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === ">>") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.DGREAT,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === "<&") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.LESSAND,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === ">&") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.GREATAND,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === "<>") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.LESSGREAT,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === ">|") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.CLOBBER,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }
    if (twoChar === "&>") {
      this.pos += 2;
      this.column += 2;
      return this.makeToken(
        TokenType.AND_GREAT,
        twoChar,
        start,
        startLine,
        startColumn,
      );
    }

    // Single-character operators
    if (char === "|") {
      this.pos++;
      this.column++;
      return this.makeToken(
        TokenType.PIPE,
        char,
        start,
        startLine,
        startColumn,
      );
    }
    if (char === "&") {
      this.pos++;
      this.column++;
      return this.makeToken(TokenType.AMP, char, start, startLine, startColumn);
    }
    if (char === ";") {
      this.pos++;
      this.column++;
      return this.makeToken(
        TokenType.SEMICOLON,
        char,
        start,
        startLine,
        startColumn,
      );
    }
    if (char === "(") {
      this.pos++;
      this.column++;
      return this.makeToken(
        TokenType.LPAREN,
        char,
        start,
        startLine,
        startColumn,
      );
    }
    if (char === ")") {
      this.pos++;
      this.column++;
      return this.makeToken(
        TokenType.RPAREN,
        char,
        start,
        startLine,
        startColumn,
      );
    }
    if (char === "{") {
      // Check for {} as a word (used in find -exec)
      if (this.input[this.pos + 1] === "}") {
        this.pos += 2;
        this.column += 2;
        return {
          type: TokenType.WORD,
          value: "{}",
          start,
          end: this.pos,
          line: startLine,
          column: startColumn,
          quoted: false,
          singleQuoted: false,
        };
      }
      this.pos++;
      this.column++;
      return this.makeToken(
        TokenType.LBRACE,
        char,
        start,
        startLine,
        startColumn,
      );
    }
    if (char === "}") {
      this.pos++;
      this.column++;
      return this.makeToken(
        TokenType.RBRACE,
        char,
        start,
        startLine,
        startColumn,
      );
    }
    if (char === "<") {
      this.pos++;
      this.column++;
      return this.makeToken(
        TokenType.LESS,
        char,
        start,
        startLine,
        startColumn,
      );
    }
    if (char === ">") {
      this.pos++;
      this.column++;
      return this.makeToken(
        TokenType.GREAT,
        char,
        start,
        startLine,
        startColumn,
      );
    }
    if (char === "!") {
      // Check for != operator (used in [[ ]] tests)
      if (this.input[this.pos + 1] === "=") {
        this.pos += 2;
        this.column += 2;
        return this.makeToken(TokenType.WORD, "!=", start, startLine, startColumn);
      }
      this.pos++;
      this.column++;
      return this.makeToken(
        TokenType.BANG,
        char,
        start,
        startLine,
        startColumn,
      );
    }

    // Words
    return this.readWord(start, startLine, startColumn);
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
    let value = "";
    while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
      value += this.input[this.pos];
      this.pos++;
      this.column++;
    }
    return {
      type: TokenType.COMMENT,
      value,
      start,
      end: this.pos,
      line,
      column,
    };
  }

  private readWord(start: number, line: number, column: number): Token {
    let value = "";
    let quoted = false;
    let singleQuoted = false;
    let inSingleQuote = false;
    let inDoubleQuote = false;

    while (this.pos < this.input.length) {
      const char = this.input[this.pos];

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
        this.pos++;
        this.column++;
        continue;
      }

      if (char === '"' && !inSingleQuote) {
        if (inDoubleQuote) {
          inDoubleQuote = false;
        } else {
          inDoubleQuote = true;
          quoted = true;
        }
        this.pos++;
        this.column++;
        continue;
      }

      // Handle escapes
      if (char === "\\" && !inSingleQuote && this.pos + 1 < this.input.length) {
        const nextChar = this.input[this.pos + 1];
        if (nextChar === "\n") {
          // Line continuation
          this.pos += 2;
          this.line++;
          this.column = 1;
          continue;
        }
        if (inDoubleQuote) {
          // In double quotes, only certain escapes are special
          if ('"\\$`\n'.includes(nextChar)) {
            // For $ and ` keep the backslash so parser knows not to expand
            if (nextChar === "$" || nextChar === "`") {
              value += char + nextChar; // Keep backslash + char
            } else {
              value += nextChar;
            }
            this.pos += 2;
            this.column += 2;
            continue;
          }
        } else {
          // Outside quotes, backslash escapes next character
          value += nextChar;
          this.pos += 2;
          this.column += 2;
          continue;
        }
      }

      // Handle $(...) command substitution - consume the entire construct
      if (char === "$" && this.pos + 1 < this.input.length && this.input[this.pos + 1] === "(") {
        value += char;
        this.pos++;
        this.column++;
        // Now consume the $(...)
        value += this.input[this.pos]; // Add the (
        this.pos++;
        this.column++;
        // Track parenthesis depth
        let depth = 1;
        while (depth > 0 && this.pos < this.input.length) {
          const c = this.input[this.pos];
          value += c;
          if (c === "(") depth++;
          else if (c === ")") depth--;
          else if (c === "\n") {
            this.line++;
            this.column = 0;
          }
          this.pos++;
          this.column++;
        }
        continue;
      }

      // Handle ${...} parameter expansion - consume the entire construct
      if (char === "$" && this.pos + 1 < this.input.length && this.input[this.pos + 1] === "{") {
        value += char;
        this.pos++;
        this.column++;
        // Now consume the ${...}
        value += this.input[this.pos]; // Add the {
        this.pos++;
        this.column++;
        // Track brace depth
        let depth = 1;
        while (depth > 0 && this.pos < this.input.length) {
          const c = this.input[this.pos];
          value += c;
          if (c === "{") depth++;
          else if (c === "}") depth--;
          else if (c === "\n") {
            this.line++;
            this.column = 0;
          }
          this.pos++;
          this.column++;
        }
        continue;
      }

      // Handle special variables $#, $?, $$, $!, $0-$9, $@, $*
      if (char === "$" && this.pos + 1 < this.input.length) {
        const next = this.input[this.pos + 1];
        if ("#?$!@*-".includes(next) || (next >= "0" && next <= "9")) {
          value += char + next;
          this.pos += 2;
          this.column += 2;
          continue;
        }
      }

      // Handle backtick command substitution - consume the entire construct
      if (char === "`") {
        value += char;
        this.pos++;
        this.column++;
        // Find the matching backtick
        while (this.pos < this.input.length && this.input[this.pos] !== "`") {
          const c = this.input[this.pos];
          value += c;
          if (c === "\\" && this.pos + 1 < this.input.length) {
            value += this.input[this.pos + 1];
            this.pos++;
            this.column++;
          }
          if (c === "\n") {
            this.line++;
            this.column = 0;
          }
          this.pos++;
          this.column++;
        }
        if (this.pos < this.input.length) {
          value += this.input[this.pos]; // closing backtick
          this.pos++;
          this.column++;
        }
        continue;
      }

      // Regular character
      value += char;
      this.pos++;
      if (char === "\n") {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
    }

    if (value === "") {
      return {
        type: TokenType.WORD,
        value: "",
        start,
        end: this.pos,
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
        end: this.pos,
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
          end: this.pos,
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
        end: this.pos,
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
        end: this.pos,
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
      end: this.pos,
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
      while (this.pos < this.input.length && this.input[this.pos] !== quoteChar) {
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

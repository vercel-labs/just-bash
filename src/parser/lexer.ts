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
 * Check if a string is a valid assignment LHS with optional nested array subscript
 * Handles: VAR, a[0], a[x], a[a[0]], a[x+1], etc.
 */
function isValidAssignmentLHS(str: string): boolean {
  // Must start with valid variable name
  const match = str.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
  if (!match) return false;

  const afterName = str.slice(match[0].length);

  // If nothing after name, it's valid (simple variable)
  if (afterName === "" || afterName === "+") return true;

  // If it's an array subscript, need to check for balanced brackets
  if (afterName[0] === "[") {
    // Find matching close bracket (handling nested brackets)
    let depth = 0;
    let i = 0;
    for (; i < afterName.length; i++) {
      if (afterName[i] === "[") depth++;
      else if (afterName[i] === "]") {
        depth--;
        if (depth === 0) break;
      }
    }
    // Must have found closing bracket
    if (depth !== 0 || i >= afterName.length) return false;
    // After closing bracket, only + is allowed (for +=)
    const afterBracket = afterName.slice(i + 1);
    return afterBracket === "" || afterBracket === "+";
  }

  return false;
}

/**
 * Three-character operators (simple ones without special handling)
 */
const THREE_CHAR_OPS: Array<[string, string, string, TokenType]> = [
  [";", ";", "&", TokenType.SEMI_SEMI_AND],
  ["<", "<", "<", TokenType.TLESS],
  ["&", ">", ">", TokenType.AND_DGREAT],
  // Note: <<- has special handling for heredoc, not included here
];

/**
 * Two-character operators (simple ones without special handling)
 * Note: << has special handling for heredoc, not included here
 */
const TWO_CHAR_OPS: Array<[string, string, TokenType]> = [
  ["[", "[", TokenType.DBRACK_START],
  ["]", "]", TokenType.DBRACK_END],
  ["(", "(", TokenType.DPAREN_START],
  [")", ")", TokenType.DPAREN_END],
  ["&", "&", TokenType.AND_AND],
  ["|", "|", TokenType.OR_OR],
  [";", ";", TokenType.DSEMI],
  [";", "&", TokenType.SEMI_AND],
  ["|", "&", TokenType.PIPE_AMP],
  [">", ">", TokenType.DGREAT],
  ["<", "&", TokenType.LESSAND],
  [">", "&", TokenType.GREATAND],
  ["<", ">", TokenType.LESSGREAT],
  [">", "|", TokenType.CLOBBER],
  ["&", ">", TokenType.AND_GREAT],
];

/**
 * Single-character operators (simple ones without special handling)
 * Note: {, }, ! have special handling, not included here
 */
const SINGLE_CHAR_OPS: Record<string, TokenType> = {
  "|": TokenType.PIPE,
  "&": TokenType.AMP,
  ";": TokenType.SEMICOLON,
  "(": TokenType.LPAREN,
  ")": TokenType.RPAREN,
  "<": TokenType.LESS,
  ">": TokenType.GREAT,
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
    // Special case: <<- (heredoc with tab stripping)
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
    // Table-driven three-char operators
    for (const [first, second, third, type] of THREE_CHAR_OPS) {
      if (c0 === first && c1 === second && c2 === third) {
        this.pos = pos + 3;
        this.column = startColumn + 3;
        return this.makeToken(
          type,
          first + second + third,
          pos,
          startLine,
          startColumn,
        );
      }
    }

    // Two-character operators
    // Special case: << (heredoc)
    if (c0 === "<" && c1 === "<") {
      this.pos = pos + 2;
      this.column = startColumn + 2;
      this.registerHeredocFromLookahead(false);
      return this.makeToken(TokenType.DLESS, "<<", pos, startLine, startColumn);
    }
    // Table-driven two-char operators
    for (const [first, second, type] of TWO_CHAR_OPS) {
      if (c0 === first && c1 === second) {
        this.pos = pos + 2;
        this.column = startColumn + 2;
        return this.makeToken(
          type,
          first + second,
          pos,
          startLine,
          startColumn,
        );
      }
    }

    // Single-character operators
    // Table-driven simple single-char operators
    const singleCharType = SINGLE_CHAR_OPS[c0];
    if (singleCharType) {
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(singleCharType, c0, pos, startLine, startColumn);
    }

    // Special cases with complex handling
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
      // Check for brace expansion: {a,b} or {1..10}
      // If it's a brace expansion, read it as part of a word (including any prefix/suffix)
      const braceContent = this.scanBraceExpansion(pos);
      if (braceContent !== null) {
        // Read as a word starting from here - readWord will handle the full word
        return this.readWordWithBraceExpansion(pos, startLine, startColumn);
      }
      // Not a valid brace expansion - check if there's a matching closing brace
      // If so, treat {foo} as part of a word that may include more content
      const literalBrace = this.scanLiteralBraceWord(pos);
      if (literalBrace !== null) {
        // Read as a word including the literal brace and any suffix/additional braces
        return this.readWordWithBraceExpansion(pos, startLine, startColumn);
      }
      // In bash, { must be followed by whitespace to be a group start
      // If followed by a word character, treat as a literal word starting with {
      if (c1 !== undefined && c1 !== " " && c1 !== "\t" && c1 !== "\n") {
        return this.readWord(pos, startLine, startColumn);
      }
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.LBRACE, "{", pos, startLine, startColumn);
    }
    if (c0 === "}") {
      // Check if } is followed by word characters - if so, it's a literal } in a word
      // e.g., echo }_{a,b} should output }_a }_b
      if (this.isWordCharFollowing(pos + 1)) {
        return this.readWord(pos, startLine, startColumn);
      }
      this.pos = pos + 1;
      this.column = startColumn + 1;
      return this.makeToken(TokenType.RBRACE, "}", pos, startLine, startColumn);
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
        c === ">"
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

        // Check for assignment (including array subscript: a[0]=value, a[idx]=value, a[a[0]]=value)
        const eqIdx = value.indexOf("=");
        if (eqIdx > 0 && isValidAssignmentLHS(value.slice(0, eqIdx))) {
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
    // Track if the token STARTS with a quote (for assignment detection)
    // This can be set later when handling $"..." to treat it like a quoted start
    let startsWithQuote = input[pos] === '"' || input[pos] === "'";

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
          char === ">"
        ) {
          break;
        }
      }

      // Handle $'' ANSI-C quoting (must check before regular single quotes)
      if (
        char === "$" &&
        pos + 1 < len &&
        input[pos + 1] === "'" &&
        !inSingleQuote &&
        !inDoubleQuote
      ) {
        // Include the $' in the token and process the ANSI-C string
        value += "$'";
        pos += 2;
        col += 2;
        // Read until closing quote, handling escape sequences
        while (pos < len && input[pos] !== "'") {
          if (input[pos] === "\\" && pos + 1 < len) {
            // Include the escape sequence in the token
            value += input[pos] + input[pos + 1];
            pos += 2;
            col += 2;
          } else {
            value += input[pos];
            pos++;
            col++;
          }
        }
        if (pos < len) {
          value += "'";
          pos++;
          col++;
        }
        // Don't set quoted=true - the $'...' is kept in the value and parsed specially
        continue;
      }

      // Handle $"..." locale quoting (bash extension, treated like "..." in practice)
      if (
        char === "$" &&
        pos + 1 < len &&
        input[pos + 1] === '"' &&
        !inSingleQuote &&
        !inDoubleQuote
      ) {
        // Skip the $ and handle as regular double quote
        pos++;
        col++;
        // Now handle the opening double quote - treat as if word started with quote
        inDoubleQuote = true;
        quoted = true;
        if (value === "") {
          startsWithQuote = true;
        }
        pos++;
        col++;
        continue;
      }

      // Handle quotes
      // For partially quoted words (not starting with a quote), preserve the quotes in value
      // and don't set the quoted/singleQuoted flags. This allows parseWordParts to properly
      // handle mixed quoting and brace expansion.
      if (char === "'" && !inDoubleQuote) {
        if (inSingleQuote) {
          inSingleQuote = false;
          if (!startsWithQuote) {
            // Preserve closing quote for partially quoted words
            value += char;
          }
        } else {
          inSingleQuote = true;
          if (startsWithQuote) {
            // Only set flags if word starts with quote
            singleQuoted = true;
            quoted = true;
          } else {
            // Preserve opening quote for partially quoted words
            value += char;
          }
        }
        pos++;
        col++;
        continue;
      }

      if (char === '"' && !inSingleQuote) {
        if (inDoubleQuote) {
          inDoubleQuote = false;
          if (!startsWithQuote) {
            // Preserve closing quote for partially quoted words
            value += char;
          }
        } else {
          inDoubleQuote = true;
          if (startsWithQuote) {
            // Only set flags if word starts with quote
            quoted = true;
          } else {
            // Preserve opening quote for partially quoted words
            value += char;
          }
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
          // Keep the backslash for quotes so parser knows they're escaped
          if (nextChar === '"' || nextChar === "'") {
            value += char + nextChar;
          } else {
            value += nextChar;
          }
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
        // Track parenthesis depth with context awareness for case statements
        let depth = 1;
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let caseDepth = 0; // Track nested case statements
        let inCasePattern = false; // Are we in case pattern (after 'in', before ')')
        let wordBuffer = ""; // Track recent word for keyword detection
        // Check if this is $((...)) arithmetic expansion
        const isArithmetic = input[pos] === "(";
        while (depth > 0 && pos < len) {
          const c = input[pos];
          value += c;

          if (inSingleQuote) {
            if (c === "'") inSingleQuote = false;
          } else if (inDoubleQuote) {
            if (c === "\\" && pos + 1 < len) {
              // Skip escaped char in double quotes
              value += input[pos + 1];
              pos++;
              col++;
            } else if (c === '"') {
              inDoubleQuote = false;
            }
          } else {
            // Not in quotes
            if (c === "'") {
              inSingleQuote = true;
              wordBuffer = "";
            } else if (c === '"') {
              inDoubleQuote = true;
              wordBuffer = "";
            } else if (c === "\\" && pos + 1 < len) {
              // Skip escaped char
              value += input[pos + 1];
              pos++;
              col++;
              wordBuffer = "";
            } else if (
              c === "#" &&
              !isArithmetic && // # is NOT a comment in arithmetic expansion
              (wordBuffer === "" || /\s/.test(input[pos - 1] || ""))
            ) {
              // Comment - skip to end of line (only in command substitution, not arithmetic)
              while (pos + 1 < len && input[pos + 1] !== "\n") {
                pos++;
                col++;
                value += input[pos];
              }
              wordBuffer = "";
            } else if (/[a-zA-Z_]/.test(c)) {
              wordBuffer += c;
            } else {
              // Check for keywords
              if (wordBuffer === "case") {
                caseDepth++;
                inCasePattern = false;
              } else if (wordBuffer === "in" && caseDepth > 0) {
                inCasePattern = true;
              } else if (wordBuffer === "esac" && caseDepth > 0) {
                caseDepth--;
                inCasePattern = false;
              }
              wordBuffer = "";

              if (c === "(") {
                // Check for $( which starts nested command substitution
                if (pos > 0 && input[pos - 1] === "$") {
                  depth++;
                } else if (!inCasePattern) {
                  // Regular ( in non-pattern context
                  depth++;
                }
                // In case pattern, ( is part of extended glob or literal
              } else if (c === ")") {
                if (inCasePattern) {
                  // ) ends the case pattern, doesn't affect depth
                  inCasePattern = false;
                } else {
                  depth--;
                }
              } else if (c === ";") {
                // ;; in case body means next pattern
                if (caseDepth > 0 && pos + 1 < len && input[pos + 1] === ";") {
                  inCasePattern = true;
                }
              }
            }
          }

          if (c === "\n") {
            ln++;
            col = 0;
            wordBuffer = "";
          }
          pos++;
          col++;
        }
        continue;
      }

      // Handle $[...] old-style arithmetic - consume the entire construct
      if (char === "$" && pos + 1 < len && input[pos + 1] === "[") {
        value += char;
        pos++;
        col++;
        // Now consume the $[...]
        value += input[pos]; // Add the [
        pos++;
        col++;
        // Track bracket depth
        let depth = 1;
        while (depth > 0 && pos < len) {
          const c = input[pos];
          value += c;
          if (c === "[") depth++;
          else if (c === "]") depth--;
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
    // Only tokens that don't start with a quote can be assignments.
    // MYVAR="hello" is an assignment (name is unquoted)
    // "MYVAR=hello" is NOT an assignment (starts with quote)
    // Also matches array subscript: a[0]=value, a[idx]=value, a[a[0]]=value
    if (!startsWithQuote) {
      const eqIdx = value.indexOf("=");
      if (eqIdx > 0 && isValidAssignmentLHS(value.slice(0, eqIdx))) {
        return {
          type: TokenType.ASSIGNMENT_WORD,
          value,
          start,
          end: pos,
          line,
          column,
          quoted,
          singleQuoted,
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

  /**
   * Check if position is followed by word characters (not a word boundary).
   * Used to determine if } should be literal or RBRACE token.
   */
  private isWordCharFollowing(pos: number): boolean {
    if (pos >= this.input.length) return false;
    const c = this.input[pos];
    // Word continues if followed by non-boundary characters
    return !(
      c === " " ||
      c === "\t" ||
      c === "\n" ||
      c === ";" ||
      c === "&" ||
      c === "|" ||
      c === "(" ||
      c === ")" ||
      c === "<" ||
      c === ">"
    );
  }

  /**
   * Read a word that starts with a brace expansion.
   * Includes the brace expansion plus any suffix characters and additional brace expansions.
   */
  private readWordWithBraceExpansion(
    start: number,
    line: number,
    column: number,
  ): Token {
    const input = this.input;
    const len = input.length;
    let pos = start;
    let col = column;

    // Read the word which may contain multiple brace expansions
    while (pos < len) {
      const c = input[pos];

      // Stop at word boundaries
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
        c === ">"
      ) {
        break;
      }

      // Handle opening brace
      if (c === "{") {
        // Check if this is a valid brace expansion
        const braceExp = this.scanBraceExpansion(pos);
        if (braceExp !== null) {
          // Valid brace expansion - consume it entirely
          let depth = 1;
          pos++;
          col++;
          while (pos < len && depth > 0) {
            if (input[pos] === "{") depth++;
            else if (input[pos] === "}") depth--;
            pos++;
            col++;
          }
          continue;
        }
        // Not a valid brace expansion - treat { as a literal character
        pos++;
        col++;
        continue;
      }

      // Handle closing brace - treat as literal (part of suffix like "a}")
      if (c === "}") {
        pos++;
        col++;
        continue;
      }

      // Handle $(...) or $((...)) - consume the entire construct
      if (c === "$" && pos + 1 < len && input[pos + 1] === "(") {
        pos++; // Skip $
        col++;
        pos++; // Skip first (
        col++;
        let depth = 1;
        while (depth > 0 && pos < len) {
          if (input[pos] === "(") depth++;
          else if (input[pos] === ")") depth--;
          pos++;
          col++;
        }
        continue;
      }

      // Handle ${...} parameter expansion
      if (c === "$" && pos + 1 < len && input[pos + 1] === "{") {
        pos++; // Skip $
        col++;
        pos++; // Skip {
        col++;
        let depth = 1;
        while (depth > 0 && pos < len) {
          if (input[pos] === "{") depth++;
          else if (input[pos] === "}") depth--;
          pos++;
          col++;
        }
        continue;
      }

      // Handle backtick command substitution
      if (c === "`") {
        pos++; // Skip opening `
        col++;
        while (pos < len && input[pos] !== "`") {
          if (input[pos] === "\\" && pos + 1 < len) {
            pos += 2; // Skip escape sequence
            col += 2;
          } else {
            pos++;
            col++;
          }
        }
        if (pos < len) {
          pos++; // Skip closing `
          col++;
        }
        continue;
      }

      // Regular character
      pos++;
      col++;
    }

    const value = input.slice(start, pos);
    this.pos = pos;
    this.column = col;

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

  /**
   * Scan ahead to detect brace expansion pattern.
   * Returns the full brace expansion string if found, null otherwise.
   * Brace expansion must contain either:
   * - A comma (e.g., {a,b,c})
   * - A range with .. (e.g., {1..10})
   */
  private scanBraceExpansion(startPos: number): string | null {
    const input = this.input;
    const len = input.length;
    let pos = startPos + 1; // Skip the opening {
    let depth = 1;
    let hasComma = false;
    let hasRange = false;

    while (pos < len && depth > 0) {
      const c = input[pos];

      if (c === "{") {
        depth++;
        pos++;
      } else if (c === "}") {
        depth--;
        pos++;
      } else if (c === "," && depth === 1) {
        hasComma = true;
        pos++;
      } else if (c === "." && pos + 1 < len && input[pos + 1] === ".") {
        hasRange = true;
        pos += 2;
      } else if (
        c === " " ||
        c === "\t" ||
        c === "\n" ||
        c === ";" ||
        c === "&" ||
        c === "|"
      ) {
        // Hit a word boundary before closing brace - not a valid brace expansion
        return null;
      } else {
        pos++;
      }
    }

    // Must have closing brace and either comma or range
    if (depth === 0 && (hasComma || hasRange)) {
      return input.slice(startPos, pos);
    }

    return null;
  }

  /**
   * Scan a literal brace word like {foo} (no comma, no range).
   * Returns the literal string if found, null otherwise.
   * This is used when {} contains something but it's not a valid brace expansion.
   */
  private scanLiteralBraceWord(startPos: number): string | null {
    const input = this.input;
    const len = input.length;
    let pos = startPos + 1; // Skip the opening {
    let depth = 1;

    while (pos < len && depth > 0) {
      const c = input[pos];

      if (c === "{") {
        depth++;
        pos++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          // Found the closing brace - return the entire {content}
          return input.slice(startPos, pos + 1);
        }
        pos++;
      } else if (
        c === " " ||
        c === "\t" ||
        c === "\n" ||
        c === ";" ||
        c === "&" ||
        c === "|"
      ) {
        // Hit a word boundary before closing brace
        return null;
      } else {
        pos++;
      }
    }

    return null;
  }
}

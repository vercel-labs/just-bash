/**
 * Shell Parser - Tokenizes and parses shell command lines
 *
 * Handles:
 * - Quoting (single, double)
 * - Escape sequences
 * - Redirections (>, >>, 2>, 2>&1, 2>/dev/null, <)
 * - Pipelines (|)
 * - Command chaining (&&, ||, ;)
 * - Variable expansion ($VAR, ${VAR}, ${VAR:-default})
 * - Glob patterns (*, ?, [...])
 */

export interface Redirection {
  type: "stdout" | "stderr" | "stdin" | "stderr-to-stdout";
  target: string | null; // null for 2>&1
  append: boolean;
}

export interface ParsedCommand {
  command: string;
  args: string[];
  /** Tracks which args were quoted (should not be glob-expanded) */
  quotedArgs: boolean[];
  /** Tracks which args were single-quoted (should not be variable-expanded) */
  singleQuotedArgs: boolean[];
  redirections: Redirection[];
}

export interface ChainedCommand {
  parsed: ParsedCommand;
  operator: "" | "&&" | "||" | ";";
  /**
   * Number of ! operators before this pipeline segment.
   * Odd count = negate, even count = no change.
   * Only meaningful on the first command of a pipeline segment.
   */
  negationCount?: number;
}

export interface Pipeline {
  commands: ChainedCommand[];
}

type TokenType =
  | "word"
  | "pipe"
  | "and"
  | "or"
  | "semicolon"
  | "not"
  | "redirect-stdout"
  | "redirect-stdout-append"
  | "redirect-stderr"
  | "redirect-stderr-append"
  | "redirect-stderr-to-stdout"
  | "redirect-stdin"
  | "if"
  | "then"
  | "elif"
  | "else"
  | "fi";

interface Token {
  type: TokenType;
  value: string;
  /** True if the token was quoted (should not be glob-expanded). Only relevant for 'word' tokens. */
  quoted?: boolean;
  /** True if the token was single-quoted (should not be variable-expanded). Only relevant for 'word' tokens. */
  singleQuoted?: boolean;
}

export class ShellParser {
  /**
   * Parse a full command line into pipelines
   */
  parse(commandLine: string): Pipeline[] {
    const tokens = this.tokenize(commandLine);
    return this.buildPipelines(tokens);
  }

  /**
   * Tokenize a command line into tokens
   */
  private tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    let current = "";
    let inQuote: string | null = null;
    let wasQuoted = false; // Track if current token contains any quoted content
    let wasSingleQuoted = false; // Track if current token was single-quoted

    const pushWord = () => {
      if (current) {
        tokens.push({
          type: "word",
          value: current,
          quoted: wasQuoted,
          singleQuoted: wasSingleQuoted,
        });
        current = "";
        wasQuoted = false;
        wasSingleQuoted = false;
      }
    };

    while (i < input.length) {
      const char = input[i];
      const nextChar = input[i + 1];

      // Handle escape sequences
      if (char === "\\" && i + 1 < input.length) {
        if (inQuote === "'") {
          // In single quotes, backslash is literal
          current += char;
          i++;
        } else if (inQuote === '"') {
          // In double quotes, only certain escapes are special
          if (
            nextChar === '"' ||
            nextChar === "\\" ||
            nextChar === "$" ||
            nextChar === "`"
          ) {
            // For escaped $, use placeholder \x01$ so it won't be expanded
            // The placeholder is stripped after variable expansion
            if (nextChar === "$") {
              current += "\x01$";
            } else {
              current += nextChar;
            }
            i += 2;
          } else {
            current += char;
            i++;
          }
        } else {
          // Outside quotes, backslash escapes next character
          current += nextChar;
          i += 2;
        }
        continue;
      }

      // Handle variable expansion (not in single quotes)
      // Note: We preserve $VAR syntax here and expand later in execution
      // This allows commands like "local x=1; echo $x" to work correctly
      if (char === "$" && inQuote !== "'") {
        // Handle $((expr)) arithmetic expansion - capture entire expression
        if (nextChar === "(" && input[i + 2] === "(") {
          const closeIndex = this.findMatchingDoubleParen(input, i + 2);
          if (closeIndex !== -1) {
            current += input.slice(i, closeIndex + 2); // include $((expr))
            i = closeIndex + 2;
            continue;
          }
        }

        // Handle $(cmd) command substitution - capture entire command
        if (nextChar === "(") {
          const closeIndex = this.findMatchingParen(input, i + 1);
          if (closeIndex !== -1) {
            current += input.slice(i, closeIndex + 1); // include $(cmd)
            i = closeIndex + 1;
            continue;
          }
        }

        // Preserve variable references for later expansion at execution time
        // This applies both inside and outside double quotes
        // The executor will handle expansion with the current env at that time
        if (input[i + 1] === "{") {
          // ${...} syntax - find the closing brace
          const closeIdx = input.indexOf("}", i + 2);
          if (closeIdx !== -1) {
            current += input.slice(i, closeIdx + 1);
            i = closeIdx + 1;
            continue;
          }
        }
        // Simple $VAR reference - collect the variable name
        let j = i + 1;
        while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) {
          j++;
        }
        if (j > i + 1) {
          current += input.slice(i, j);
          i = j;
          continue;
        }
        // Just a $ sign
        current += char;
        i++;
        continue;
      }

      // Handle quotes
      if (char === '"' || char === "'") {
        if (inQuote === char) {
          inQuote = null;
        } else if (!inQuote) {
          inQuote = char;
          wasQuoted = true; // Mark that this token contains quoted content
          if (char === "'") {
            wasSingleQuoted = true; // Mark single-quoted (literal, no expansion)
          }
        } else {
          current += char;
        }
        i++;
        continue;
      }

      // Inside quotes, everything is literal (except what we handled above)
      if (inQuote) {
        current += char;
        i++;
        continue;
      }

      // Handle operators and redirections (only outside quotes)

      // Handle 2>&1
      if (char === "2" && input.slice(i, i + 4) === "2>&1") {
        pushWord();
        tokens.push({ type: "redirect-stderr-to-stdout", value: "2>&1" });
        i += 4;
        continue;
      }

      // Handle 2>> (stderr append)
      if (char === "2" && nextChar === ">" && input[i + 2] === ">") {
        pushWord();
        tokens.push({ type: "redirect-stderr-append", value: "2>>" });
        i += 3;
        continue;
      }

      // Handle 2> (stderr)
      if (char === "2" && nextChar === ">") {
        pushWord();
        tokens.push({ type: "redirect-stderr", value: "2>" });
        i += 2;
        continue;
      }

      // Handle >> (stdout append)
      if (char === ">" && nextChar === ">") {
        pushWord();
        tokens.push({ type: "redirect-stdout-append", value: ">>" });
        i += 2;
        continue;
      }

      // Handle > (stdout)
      if (char === ">") {
        pushWord();
        tokens.push({ type: "redirect-stdout", value: ">" });
        i++;
        continue;
      }

      // Handle < (stdin)
      if (char === "<") {
        pushWord();
        tokens.push({ type: "redirect-stdin", value: "<" });
        i++;
        continue;
      }

      // Handle &&
      if (char === "&" && nextChar === "&") {
        pushWord();
        tokens.push({ type: "and", value: "&&" });
        i += 2;
        continue;
      }

      // Handle ||
      if (char === "|" && nextChar === "|") {
        pushWord();
        tokens.push({ type: "or", value: "||" });
        i += 2;
        continue;
      }

      // Handle | (pipe)
      if (char === "|") {
        pushWord();
        tokens.push({ type: "pipe", value: "|" });
        i++;
        continue;
      }

      // Handle ;
      if (char === ";") {
        pushWord();
        tokens.push({ type: "semicolon", value: ";" });
        i++;
        continue;
      }

      // Handle ! (negation operator) - only at start of command or after operator
      if (
        char === "!" &&
        (current === "" ||
          tokens.length === 0 ||
          ["and", "or", "semicolon", "pipe"].includes(
            tokens[tokens.length - 1]?.type,
          ))
      ) {
        // Check if followed by space or end (command negation)
        if (
          i + 1 >= input.length ||
          input[i + 1] === " " ||
          input[i + 1] === "\t"
        ) {
          pushWord();
          tokens.push({ type: "not", value: "!" });
          i++;
          continue;
        }
      }

      // Handle whitespace
      if (char === " " || char === "\t") {
        pushWord();
        i++;
        continue;
      }

      // Handle newlines as statement separators (like semicolons)
      if (char === "\n") {
        pushWord();
        // Only add semicolon token if there's content before this
        // (avoid multiple consecutive semicolons)
        if (
          tokens.length > 0 &&
          tokens[tokens.length - 1].type !== "semicolon"
        ) {
          tokens.push({ type: "semicolon", value: ";" });
        }
        i++;
        continue;
      }

      // Regular character
      current += char;
      i++;
    }

    pushWord();
    return tokens;
  }

  /**
   * Find matching ) for $(...), handling nesting
   */
  private findMatchingParen(str: string, start: number): number {
    let depth = 1;
    let i = start + 1;
    let inSingleQuote = false;
    let inDoubleQuote = false;

    while (i < str.length && depth > 0) {
      const char = str[i];

      // Handle escape sequences
      if (char === "\\" && !inSingleQuote && i + 1 < str.length) {
        i += 2;
        continue;
      }

      // Handle quotes
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        i++;
        continue;
      }
      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        i++;
        continue;
      }

      // Handle nested $(...) - only count if not in quotes
      if (!inSingleQuote && !inDoubleQuote) {
        if (char === "$" && str[i + 1] === "(") {
          depth++;
          i += 2;
          continue;
        }
        if (char === "(") depth++;
        else if (char === ")") depth--;
      }

      if (depth > 0) i++;
    }

    return depth === 0 ? i : -1;
  }

  /**
   * Find matching )) for $((...)), handling nesting
   */
  private findMatchingDoubleParen(str: string, start: number): number {
    let depth = 1;
    let i = start + 1;

    while (i < str.length && depth > 0) {
      if (str[i] === "(" && str[i + 1] === "(") {
        depth++;
        i += 2;
        continue;
      }
      if (str[i] === ")" && str[i + 1] === ")") {
        depth--;
        if (depth === 0) return i;
        i += 2;
        continue;
      }
      i++;
    }

    return -1;
  }

  /**
   * Collect tokens for a compound command (if...fi, while...done, etc.)
   */
  private collectCompoundCommand(
    tokens: Token[],
    startIndex: number,
    startKeyword: string,
    endKeyword: string,
  ): { text: string; endIndex: number } {
    let depth = 0;
    let text = "";
    let i = startIndex;

    while (i < tokens.length) {
      const token = tokens[i];
      const tokenText =
        token.type === "word" ? token.value : this.tokenToText(token);

      if (token.type === "word" && token.value === startKeyword) {
        depth++;
      } else if (token.type === "word" && token.value === endKeyword) {
        depth--;
        if (depth === 0) {
          text += tokenText;
          return { text, endIndex: i };
        }
      }

      text += tokenText;

      // Add space after most tokens, but handle operators specially
      if (i + 1 < tokens.length) {
        const nextToken = tokens[i + 1];
        if (token.type === "word" && nextToken.type === "word") {
          text += " ";
        } else if (
          token.type !== "semicolon" &&
          nextToken.type !== "semicolon"
        ) {
          text += " ";
        }
      }

      i++;
    }

    // Unclosed compound command
    return { text, endIndex: i - 1 };
  }

  /**
   * Convert a token back to its text representation
   */
  private tokenToText(token: Token): string {
    switch (token.type) {
      case "pipe":
        return "|";
      case "and":
        return "&&";
      case "or":
        return "||";
      case "semicolon":
        return ";";
      case "redirect-stdout":
        return ">";
      case "redirect-stdout-append":
        return ">>";
      case "redirect-stderr":
        return "2>";
      case "redirect-stderr-append":
        return "2>>";
      case "redirect-stderr-to-stdout":
        return "2>&1";
      case "redirect-stdin":
        return "<";
      default:
        return token.value;
    }
  }

  /**
   * Build pipeline structures from tokens
   */
  private buildPipelines(tokens: Token[]): Pipeline[] {
    const pipelines: Pipeline[] = [];
    let currentPipeline: Pipeline = { commands: [] };
    let currentArgs: {
      value: string;
      quoted: boolean;
      singleQuoted?: boolean;
    }[] = [];
    let currentRedirections: Redirection[] = [];
    let lastOperator: "" | "&&" | "||" | ";" = "";
    let negationCount = 0; // Count of ! operators for current pipeline segment

    const pushCommand = () => {
      if (currentArgs.length > 0) {
        const [commandArg, ...restArgs] = currentArgs;
        currentPipeline.commands.push({
          parsed: {
            command: commandArg.value,
            args: restArgs.map((a) => a.value),
            quotedArgs: restArgs.map((a) => a.quoted || false),
            singleQuotedArgs: restArgs.map((a) => a.singleQuoted || false),
            redirections: currentRedirections,
          },
          operator: lastOperator,
          negationCount: negationCount > 0 ? negationCount : undefined,
        });
        currentArgs = [];
        currentRedirections = [];
        // Only reset negation after non-pipe operators (end of pipeline segment)
        // For pipes, negation applies to the whole pipeline segment
        if (lastOperator !== "") {
          negationCount = 0;
        }
      }
    };

    const pushPipeline = () => {
      pushCommand();
      if (currentPipeline.commands.length > 0) {
        pipelines.push(currentPipeline);
        currentPipeline = { commands: [] };
      }
    };

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];

      switch (token.type) {
        case "word":
          // Check for compound commands (if, while, for, case)
          if (token.value === "if" && currentArgs.length === 0) {
            // Collect all tokens until matching 'fi'
            const compoundCmd = this.collectCompoundCommand(
              tokens,
              i,
              "if",
              "fi",
            );
            currentArgs.push({ value: compoundCmd.text, quoted: true });
            i = compoundCmd.endIndex;
            continue;
          }
          currentArgs.push({
            value: token.value,
            quoted: token.quoted ?? false,
            singleQuoted: token.singleQuoted ?? false,
          });
          break;

        case "pipe":
          pushCommand();
          lastOperator = "";
          break;

        case "and":
          pushCommand();
          lastOperator = "&&";
          negationCount = 0; // Reset for next pipeline segment
          break;

        case "or":
          pushCommand();
          lastOperator = "||";
          negationCount = 0; // Reset for next pipeline segment
          break;

        case "semicolon":
          pushCommand();
          lastOperator = ";";
          negationCount = 0; // Reset for next pipeline segment
          break;

        case "not":
          // Increment negation count - odd count means negate
          negationCount++;
          break;

        case "redirect-stdout":
        case "redirect-stdout-append":
          // Next token should be the target
          if (i + 1 < tokens.length && tokens[i + 1].type === "word") {
            currentRedirections.push({
              type: "stdout",
              target: tokens[i + 1].value,
              append: token.type === "redirect-stdout-append",
            });
            i++;
          }
          break;

        case "redirect-stderr":
        case "redirect-stderr-append":
          // Next token should be the target
          if (i + 1 < tokens.length && tokens[i + 1].type === "word") {
            currentRedirections.push({
              type: "stderr",
              target: tokens[i + 1].value,
              append: token.type === "redirect-stderr-append",
            });
            i++;
          }
          break;

        case "redirect-stderr-to-stdout":
          currentRedirections.push({
            type: "stderr-to-stdout",
            target: null,
            append: false,
          });
          break;

        case "redirect-stdin":
          // Next token should be the source
          if (i + 1 < tokens.length && tokens[i + 1].type === "word") {
            currentRedirections.push({
              type: "stdin",
              target: tokens[i + 1].value,
              append: false,
            });
            i++;
          }
          break;
      }

      i++;
    }

    pushPipeline();
    return pipelines;
  }

  /**
   * Check if a string contains glob characters
   */
  isGlobPattern(str: string): boolean {
    return str.includes("*") || str.includes("?") || /\[.*\]/.test(str);
  }
}

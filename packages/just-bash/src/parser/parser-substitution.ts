/**
 * Command and Arithmetic Substitution Parsing Helpers
 *
 * Contains pure string analysis functions and substitution parsing utilities
 * extracted from the main parser.
 */

import {
  AST,
  type CommandSubstitutionPart,
  type ScriptNode,
} from "../ast/types.js";

/**
 * Type for a parser factory function that creates new parser instances.
 * Used to avoid circular dependencies.
 */
export type ParserFactory = () => { parse(input: string): ScriptNode };

/**
 * Type for an error reporting function.
 */
export type ErrorFn = (message: string) => never;

/**
 * Check if $(( at position `start` in `value` is a command substitution with nested
 * subshell rather than arithmetic expansion. This uses similar logic to the lexer's
 * dparenClosesWithSpacedParens but operates on a string within a word/expansion.
 *
 * The key heuristics are:
 * 1. If it closes with `) )` (separated by whitespace or content), it's a subshell
 * 2. If at depth 1 we see `||`, `&&`, or single `|`, it's a command context
 * 3. If it closes with `))`, it's arithmetic
 *
 * @param value The string containing the expansion
 * @param start Position of the `$` in `$((` (so `$((` is at start..start+2)
 * @returns true if this should be parsed as command substitution, false for arithmetic
 */
export function isDollarDparenSubshell(value: string, start: number): boolean {
  const len = value.length;
  let pos = start + 3; // Skip past $((
  let depth = 2; // We've seen ((, so we start at depth 2
  let inSingleQuote = false;
  let inDoubleQuote = false;

  while (pos < len && depth > 0) {
    const c = value[pos];

    if (inSingleQuote) {
      if (c === "'") {
        inSingleQuote = false;
      }
      pos++;
      continue;
    }

    if (inDoubleQuote) {
      if (c === "\\") {
        // Skip escaped char
        pos += 2;
        continue;
      }
      if (c === '"') {
        inDoubleQuote = false;
      }
      pos++;
      continue;
    }

    // Not in quotes
    if (c === "'") {
      inSingleQuote = true;
      pos++;
      continue;
    }

    if (c === '"') {
      inDoubleQuote = true;
      pos++;
      continue;
    }

    if (c === "\\") {
      // Skip escaped char
      pos += 2;
      continue;
    }

    if (c === "(") {
      depth++;
      pos++;
      continue;
    }

    if (c === ")") {
      depth--;
      if (depth === 1) {
        // We just closed the inner subshell, now at outer level
        // Check if next char is another ) - if so, it's )) = arithmetic
        const nextPos = pos + 1;
        if (nextPos < len && value[nextPos] === ")") {
          // )) - adjacent parens = arithmetic, not nested subshells
          return false;
        }
        // The ) is followed by something else (whitespace, content, etc.)
        // This indicates it's a subshell with more content after the inner )
        // e.g., $((which cmd || echo fallback)2>/dev/null)
        // After `(which cmd || echo fallback)` we have `2>/dev/null)` before the final `)`
        return true;
      }
      if (depth === 0) {
        // We closed all parens without the pattern we're looking for
        return false;
      }
      pos++;
      continue;
    }

    // Check for || or && or | at depth 1 (between inner subshells)
    // At depth 1, we're inside the outer (( but outside any inner parens.
    // If we see || or && or | here, it's connecting commands, not arithmetic.
    if (depth === 1) {
      if (c === "|" && pos + 1 < len && value[pos + 1] === "|") {
        return true;
      }
      if (c === "&" && pos + 1 < len && value[pos + 1] === "&") {
        return true;
      }
      if (c === "|" && pos + 1 < len && value[pos + 1] !== "|") {
        // Single | - pipeline operator
        return true;
      }
    }

    pos++;
  }

  // Didn't find a definitive answer - default to arithmetic behavior
  return false;
}

/**
 * Read a heredoc delimiter starting at `pos` (the first character after the
 * `<<` / `<<-` operator and any leading blanks). Returns the *unquoted*
 * delimiter — the exact string a terminator line must equal — and the index
 * just past the delimiter token.
 *
 * Quoting only controls whether the body is expanded, which is irrelevant to
 * finding the substitution boundary, so `'EOF'`, `"EOF"`, and `\EOF` all yield
 * the delimiter `EOF`.
 */
export function readHeredocDelimiter(
  value: string,
  pos: number,
): { delim: string; endPos: number } {
  let delim = "";
  let i = pos;
  const isWordEnd = (c: string): boolean =>
    c === " " ||
    c === "\t" ||
    c === "\n" ||
    c === ";" ||
    c === "&" ||
    c === "|" ||
    c === "<" ||
    c === ">" ||
    c === "(" ||
    c === ")";
  while (i < value.length) {
    const c = value[i];
    if (c === "'") {
      i++;
      while (i < value.length && value[i] !== "'") {
        delim += value[i];
        i++;
      }
      i++; // Skip the closing quote
      continue;
    }
    if (c === '"') {
      i++;
      while (i < value.length && value[i] !== '"') {
        if (value[i] === "\\" && i + 1 < value.length) {
          i++;
        }
        delim += value[i];
        i++;
      }
      i++; // Skip the closing quote
      continue;
    }
    if (c === "\\" && i + 1 < value.length) {
      delim += value[i + 1];
      i += 2;
      continue;
    }
    if (isWordEnd(c)) {
      break;
    }
    delim += c;
    i++;
  }
  return { delim, endPos: i };
}

/**
 * Skip the bodies of one or more heredocs that were opened on the operator
 * line ending at `nlIndex` (the index of that line's newline). Heredoc bodies
 * are literal text, so they are consumed line by line without any quote or
 * paren tracking — this is what keeps an apostrophe or unbalanced quote inside
 * the body from being mistaken for a shell quote by the boundary scan.
 *
 * Returns the index at which the surrounding scan should resume (the start of
 * the line following the final terminator), or `value.length` if the input
 * ends before a terminator is found.
 */
function skipHeredocBodies(
  value: string,
  nlIndex: number,
  heredocs: { delim: string; stripTabs: boolean }[],
): number {
  let lineStart = nlIndex + 1;
  for (const { delim, stripTabs } of heredocs) {
    for (;;) {
      if (lineStart >= value.length) {
        return value.length;
      }
      let lineEnd = value.indexOf("\n", lineStart);
      if (lineEnd === -1) {
        lineEnd = value.length;
      }
      let line = value.slice(lineStart, lineEnd);
      if (stripTabs) {
        line = line.replace(/^\t+/, "");
      }
      if (line === delim) {
        lineStart = lineEnd + 1;
        break;
      }
      if (lineEnd >= value.length) {
        return value.length;
      }
      lineStart = lineEnd + 1;
    }
  }
  return lineStart;
}

/**
 * Parse a command substitution starting at the given position.
 * Handles $(...) syntax with proper depth tracking for nested substitutions.
 *
 * @param value The string containing the substitution
 * @param start Position of the `$` in `$(`
 * @param createParser Factory function to create a new parser instance
 * @param error Error reporting function
 * @returns The parsed command substitution part and the ending index
 */
export function parseCommandSubstitutionFromString(
  value: string,
  start: number,
  createParser: ParserFactory,
  error: ErrorFn,
): { part: CommandSubstitutionPart; endIndex: number } {
  // Skip $(
  const cmdStart = start + 2;
  let depth = 1;
  let i = cmdStart;

  // Track context for case statements
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let caseDepth = 0;
  let inCasePattern = false;
  let wordBuffer = "";
  // Heredocs opened on the current line, in the order their bodies follow the
  // next newline. Their bodies are literal and must be skipped without quote
  // tracking so e.g. an apostrophe in the body isn't read as a shell quote.
  const pendingHeredocs: { delim: string; stripTabs: boolean }[] = [];

  while (i < value.length && depth > 0) {
    const c = value[i];

    if (inSingleQuote) {
      if (c === "'") inSingleQuote = false;
    } else if (inDoubleQuote) {
      if (c === "\\" && i + 1 < value.length) {
        i++; // Skip escaped char
      } else if (c === '"') {
        inDoubleQuote = false;
      }
    } else {
      // Heredoc operator: `<<DELIM` / `<<-DELIM` (but not the `<<<` here-string,
      // whose operand stays on the same line and is quote-tracked normally).
      // NOTE: this is a heuristic and does not model `<<` as a left-shift inside
      // `$((...))`; in practice such a token has no newline-delimited body to
      // consume, so the spurious pending entry is simply ignored.
      if (c === "<" && value[i + 1] === "<" && value[i + 2] !== "<") {
        let p = i + 2;
        let stripTabs = false;
        if (value[p] === "-") {
          stripTabs = true;
          p++;
        }
        while (value[p] === " " || value[p] === "\t") {
          p++;
        }
        const { delim, endPos } = readHeredocDelimiter(value, p);
        if (delim.length > 0) {
          pendingHeredocs.push({ delim, stripTabs });
          wordBuffer = "";
          i = endPos;
          continue;
        }
      }

      // Newline with pending heredocs: skip their literal bodies before
      // resuming the boundary scan past the final terminator line.
      if (c === "\n" && pendingHeredocs.length > 0) {
        const resume = skipHeredocBodies(value, i, pendingHeredocs);
        pendingHeredocs.length = 0;
        wordBuffer = "";
        i = resume;
        continue;
      }

      // Not in quotes
      if (c === "'") {
        inSingleQuote = true;
        wordBuffer = "";
      } else if (c === '"') {
        inDoubleQuote = true;
        wordBuffer = "";
      } else if (c === "\\" && i + 1 < value.length) {
        i++; // Skip escaped char
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
          if (i > 0 && value[i - 1] === "$") {
            depth++;
          } else if (!inCasePattern) {
            depth++;
          }
        } else if (c === ")") {
          if (inCasePattern) {
            // ) ends the case pattern, doesn't affect depth
            inCasePattern = false;
          } else {
            depth--;
          }
        } else if (c === ";") {
          // ;; in case body means next pattern
          if (caseDepth > 0 && i + 1 < value.length && value[i + 1] === ";") {
            inCasePattern = true;
          }
        }
      }
    }

    if (depth > 0) i++;
  }

  // Check for unclosed command substitution
  if (depth > 0) {
    error("unexpected EOF while looking for matching `)'");
  }

  const cmdStr = value.slice(cmdStart, i);
  // Use a new Parser instance to avoid overwriting the caller's parser's tokens
  const nestedParser = createParser();
  const body = nestedParser.parse(cmdStr);

  return {
    part: AST.commandSubstitution(body, false),
    endIndex: i + 1,
  };
}

/**
 * Parse a backtick command substitution starting at the given position.
 * Handles `...` syntax with proper escape processing.
 *
 * @param value The string containing the substitution
 * @param start Position of the opening backtick
 * @param inDoubleQuotes Whether the backtick is inside double quotes
 * @param createParser Factory function to create a new parser instance
 * @param error Error reporting function
 * @returns The parsed command substitution part and the ending index
 */
export function parseBacktickSubstitutionFromString(
  value: string,
  start: number,
  inDoubleQuotes: boolean,
  createParser: ParserFactory,
  error: ErrorFn,
): { part: CommandSubstitutionPart; endIndex: number } {
  const cmdStart = start + 1;
  let i = cmdStart;
  let cmdStr = "";

  // Process backtick escaping rules:
  // \$ \` \\ \<newline> have backslash removed
  // \" has backslash removed ONLY inside double quotes
  // \x for other chars keeps the backslash
  while (i < value.length && value[i] !== "`") {
    if (value[i] === "\\") {
      const next = value[i + 1];
      // In unquoted context: only \$ \` \\ \newline are special
      // In double-quoted context: also \" is special
      const isSpecial =
        next === "$" ||
        next === "`" ||
        next === "\\" ||
        next === "\n" ||
        (inDoubleQuotes && next === '"');
      if (isSpecial) {
        // Remove the backslash, keep the next char (or nothing for newline)
        if (next !== "\n") {
          cmdStr += next;
        }
        i += 2;
      } else {
        // Keep the backslash for other characters
        cmdStr += value[i];
        i++;
      }
    } else {
      cmdStr += value[i];
      i++;
    }
  }

  // Check for unclosed backtick substitution
  if (i >= value.length) {
    error("unexpected EOF while looking for matching ``'");
  }

  // Use a new Parser instance to avoid overwriting the caller's parser's tokens
  const nestedParser = createParser();
  const body = nestedParser.parse(cmdStr);

  return {
    part: AST.commandSubstitution(body, true),
    endIndex: i + 1,
  };
}

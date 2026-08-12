/**
 * Command and Arithmetic Substitution Parsing Helpers
 *
 * Contains pure string analysis functions and substitution parsing utilities
 * extracted from the main parser.
 */

import {
  AST,
  type CommandSubstitutionPart,
  type ProcessSubstitutionPart,
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
 * `<<` / `<<-` operator and any leading blanks). Returns the delimiter after
 * outer-word quote removal, plus metadata needed by both the lexer and nested
 * substitution scanner. Syntax inside unexpanded `$(`, `<(`, and `>(` atoms
 * remains literal.
 *
 * Quoting only controls whether the body is expanded, which is irrelevant to
 * finding the substitution boundary, so `'EOF'`, `"EOF"`, and `\EOF` all yield
 * the delimiter `EOF`.
 */
export function readHeredocDelimiter(
  value: string,
  pos: number,
): {
  delim: string;
  endPos: number;
  quoted: boolean;
  unclosedQuote: "'" | '"' | undefined;
  unclosedSubstitution: boolean;
} {
  let delim = "";
  let i = pos;
  let substitutionDepth = 0;
  let quoted = false;
  let unclosedQuote: "'" | '"' | undefined;
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
      const nested = substitutionDepth > 0;
      if (!nested) quoted = true;
      if (nested) delim += c;
      i++;
      while (i < value.length && value[i] !== "'") {
        delim += value[i];
        i++;
      }
      // Skip the closing quote, but only if it is actually present so an
      // unterminated delimiter cannot push `endPos` past the end of the string.
      if (i < value.length) {
        if (nested) delim += value[i];
        i++;
      } else {
        unclosedQuote = c;
      }
      continue;
    }
    if (c === '"') {
      const nested = substitutionDepth > 0;
      if (!nested) quoted = true;
      if (nested) delim += c;
      i++;
      while (i < value.length && value[i] !== '"') {
        if (value[i] === "\\" && i + 1 < value.length) {
          if (nested) {
            delim += value.slice(i, i + 2);
            i += 2;
            continue;
          }
          const escaped = value[i + 1];
          if (
            escaped === "$" ||
            escaped === "`" ||
            escaped === '"' ||
            escaped === "\\" ||
            escaped === "\n"
          ) {
            i += 2;
            if (escaped !== "\n") delim += escaped;
            continue;
          }
        }
        delim += value[i];
        i++;
      }
      // Skip the closing quote only if present (see single-quote note above).
      if (i < value.length) {
        if (nested) delim += value[i];
        i++;
      } else {
        unclosedQuote = c;
      }
      continue;
    }
    if (c === "\\" && i + 1 < value.length) {
      if (substitutionDepth > 0) {
        delim += value.slice(i, i + 2);
        i += 2;
        continue;
      }
      quoted = true;
      const escaped = value[i + 1];
      if (escaped !== "\n") delim += escaped;
      i += 2;
      continue;
    }
    if (
      substitutionDepth === 0 &&
      (c === "$" || c === "<" || c === ">") &&
      value[i + 1] === "("
    ) {
      delim += `${c}(`;
      substitutionDepth = 1;
      i += 2;
      continue;
    }
    if (substitutionDepth === 0 && isWordEnd(c)) {
      break;
    }
    if (substitutionDepth > 0) {
      if (c === "(") substitutionDepth++;
      else if (c === ")") substitutionDepth--;
    }
    delim += c;
    i++;
  }
  return {
    delim,
    endPos: i,
    quoted,
    unclosedQuote,
    unclosedSubstitution: substitutionDepth > 0,
  };
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
  // When the terminator line is the last line with no trailing newline,
  // `lineStart` becomes `value.length + 1`; clamp so callers never resume past
  // the end of the input.
  return Math.min(lineStart, value.length);
}

/**
 * Find the index of the `)` that closes a parenthesised substitution body.
 *
 * Used for `$(...)` command substitution embedded in a word, where the lexer
 * cannot expose the body as ordinary grammar tokens. Process substitution is
 * parsed directly from the token stream instead.
 *
 * @param value The string containing the substitution
 * @param cmdStart Index of the first character after the opening `X(`
 * @param error Error reporting function
 * @returns Index of the closing `)` in `value`
 */
type ScanContext = CommandScanContext | ParameterScanContext;

type CommandScanContext = {
  type: "command";
  index: number;
  depth: number;
  quote: "'" | '"' | undefined;
  caseDepth: number;
  inCasePattern: boolean;
  wordBuffer: string;
  pendingHeredocs: { delim: string; stripTabs: boolean }[];
  arithDepth: number;
};

type ParameterScanContext = {
  type: "parameter";
  index: number;
  depth: number;
  quote: "'" | '"' | "$'" | undefined;
};

type ScanWorkConsumer = (count: number) => void;
// This must exceed the parser's nesting limit so parser errors retain precedence.
const MAX_SUBSTITUTION_SCAN_DEPTH = 1_000;

const findBacktickClose = (value: string, start: number): number => {
  for (let index = start + 1; index < value.length; index++) {
    if (value[index] === "\\" && index + 1 < value.length) {
      index++;
    } else if (value[index] === "`") {
      return index;
    }
  }
  return -1;
};

const scanSubstitutionBody = (
  value: string,
  start: number,
  consumeScanWork?: ScanWorkConsumer,
): number => {
  const contexts: ScanContext[] = [
    {
      type: "command",
      index: start,
      depth: 1,
      quote: undefined,
      caseDepth: 0,
      inCasePattern: false,
      wordBuffer: "",
      pendingHeredocs: [],
      arithDepth: 0,
    },
  ];

  while (contexts.length > 0) {
    const context = contexts[contexts.length - 1];
    if (context.index >= value.length) return -1;

    const character = value[context.index];
    consumeScanWork?.(1);

    if (context.type === "parameter") {
      if (context.quote) {
        if (
          character === "\\" &&
          context.quote !== "'" &&
          context.index + 1 < value.length
        ) {
          context.index += 2;
        } else {
          if (character === (context.quote === "$'" ? "'" : context.quote)) {
            context.quote = undefined;
          }
          context.index++;
        }
        continue;
      }

      if (character === "$" && value[context.index + 1] === "'") {
        context.quote = "$'";
        context.index += 2;
        continue;
      }
      if (character === "'" || character === '"') {
        context.quote = character;
        context.index++;
        continue;
      }
      if (character === "\\" && context.index + 1 < value.length) {
        context.index += 2;
        continue;
      }
      if (
        character === "$" &&
        value[context.index + 1] === "(" &&
        value[context.index + 2] !== "("
      ) {
        if (contexts.length >= MAX_SUBSTITUTION_SCAN_DEPTH) return -1;
        context.index += 2;
        contexts.push({
          type: "command",
          index: context.index,
          depth: 1,
          quote: undefined,
          caseDepth: 0,
          inCasePattern: false,
          wordBuffer: "",
          pendingHeredocs: [],
          arithDepth: 0,
        });
        continue;
      }
      if (character === "{") context.depth++;
      else if (character === "}") {
        context.depth--;
        if (context.depth === 0) {
          contexts.pop();
          if (contexts.length === 0) return context.index;
          contexts[contexts.length - 1].index = context.index + 1;
          continue;
        }
      }
      context.index++;
      continue;
    }

    if (context.quote) {
      if (character === "\\" && context.index + 1 < value.length) {
        context.index += 2;
      } else {
        if (character === context.quote) context.quote = undefined;
        context.index++;
      }
      continue;
    }

    if (
      context.arithDepth === 0 &&
      character === "<" &&
      value[context.index + 1] === "<" &&
      value[context.index + 2] !== "<"
    ) {
      let delimiterStart = context.index + 2;
      let stripTabs = false;
      if (value[delimiterStart] === "-") {
        stripTabs = true;
        delimiterStart++;
      }
      while (value[delimiterStart] === " " || value[delimiterStart] === "\t") {
        delimiterStart++;
      }
      const { delim, endPos, unclosedQuote, unclosedSubstitution } =
        readHeredocDelimiter(value, delimiterStart);
      if (unclosedQuote || unclosedSubstitution) return -1;
      if (delim.length > 0) {
        context.pendingHeredocs.push({ delim, stripTabs });
        context.wordBuffer = "";
        context.index = endPos;
        continue;
      }
    }

    if (character === "\n" && context.pendingHeredocs.length > 0) {
      const resume = skipHeredocBodies(
        value,
        context.index,
        context.pendingHeredocs,
      );
      consumeScanWork?.(resume - context.index);
      context.pendingHeredocs.length = 0;
      context.wordBuffer = "";
      context.index = resume;
      continue;
    }

    if (character === "$" && value[context.index + 1] === "{") {
      if (contexts.length >= MAX_SUBSTITUTION_SCAN_DEPTH) return -1;
      context.index += 2;
      contexts.push({
        type: "parameter",
        index: context.index,
        depth: 1,
        quote: undefined,
      });
      continue;
    }
    if (
      character === "$" &&
      value[context.index + 1] === "(" &&
      value[context.index + 2] !== "("
    ) {
      if (contexts.length >= MAX_SUBSTITUTION_SCAN_DEPTH) return -1;
      context.index += 2;
      contexts.push({
        type: "command",
        index: context.index,
        depth: 1,
        quote: undefined,
        caseDepth: 0,
        inCasePattern: false,
        wordBuffer: "",
        pendingHeredocs: [],
        arithDepth: 0,
      });
      continue;
    }
    if (character === "`") {
      const end = findBacktickClose(value, context.index);
      if (end === -1) return -1;
      consumeScanWork?.(end - context.index);
      context.wordBuffer = "";
      context.index = end + 1;
      continue;
    }
    if (character === "'") {
      context.quote = character;
      context.wordBuffer = "";
      context.index++;
      continue;
    }
    if (character === '"') {
      context.quote = character;
      context.wordBuffer = "";
      context.index++;
      continue;
    }
    if (character === "\\" && context.index + 1 < value.length) {
      context.wordBuffer = "";
      context.index += 2;
      continue;
    }
    if (/[a-zA-Z_]/.test(character)) {
      context.wordBuffer += character;
      context.index++;
      continue;
    }

    if (context.wordBuffer === "case") {
      context.caseDepth++;
      context.inCasePattern = false;
    } else if (context.wordBuffer === "in" && context.caseDepth > 0) {
      context.inCasePattern = true;
    } else if (context.wordBuffer === "esac" && context.caseDepth > 0) {
      context.caseDepth--;
      context.inCasePattern = false;
    }
    context.wordBuffer = "";

    if (character === "(" && value[context.index + 1] === "(") {
      context.arithDepth++;
    } else if (
      character === ")" &&
      value[context.index + 1] === ")" &&
      context.arithDepth > 0
    ) {
      context.arithDepth--;
    }

    if (character === "(") {
      if (!context.inCasePattern) context.depth++;
    } else if (character === ")") {
      if (context.inCasePattern) {
        context.inCasePattern = false;
      } else {
        context.depth--;
        if (context.depth === 0) {
          contexts.pop();
          if (contexts.length === 0) return context.index;
          contexts[contexts.length - 1].index = context.index + 1;
          continue;
        }
      }
    } else if (
      character === ";" &&
      context.caseDepth > 0 &&
      value[context.index + 1] === ";"
    ) {
      context.inCasePattern = true;
    }
    context.index++;
  }

  return -1;
};

export const findCommandSubstitutionEnd = (
  value: string,
  start: number,
  consumeScanWork?: ScanWorkConsumer,
): number => scanSubstitutionBody(value, start + 2, consumeScanWork);

function findSubstitutionBodyEnd(
  value: string,
  cmdStart: number,
  error: ErrorFn,
): number {
  const end = scanSubstitutionBody(value, cmdStart);
  if (end === -1) error("unexpected EOF while looking for matching `)'");
  return end;
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
  const i = findSubstitutionBodyEnd(value, cmdStart, error);

  const cmdStr = value.slice(cmdStart, i);
  // Use a new Parser instance to avoid overwriting the caller's parser's tokens
  const nestedParser = createParser();
  const body = nestedParser.parse(cmdStr);

  return {
    part: AST.commandSubstitution(body, false),
    endIndex: i + 1,
  };
}

/** Parse process substitution syntax found inside a recursively parsed word fragment. */
export function parseProcessSubstitutionFromString(
  value: string,
  start: number,
  createParser: ParserFactory,
  error: ErrorFn,
): { part: ProcessSubstitutionPart; endIndex: number } {
  const direction = value[start] === "<" ? "input" : "output";
  const bodyStart = start + 2;
  const bodyEnd = findSubstitutionBodyEnd(value, bodyStart, error);
  const body = createParser().parse(value.slice(bodyStart, bodyEnd));

  return {
    part: AST.processSubstitution(body, direction),
    endIndex: bodyEnd + 1,
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

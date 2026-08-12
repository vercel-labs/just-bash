import { findCommandSubstitutionEnd } from "./parser-substitution.js";

type Quote = "'" | '"' | "$'";

function findParameterExpansionEnd(
  value: string,
  start: number,
  _stopAtNewline: boolean,
  consumeScanWork?: (count: number) => void,
): number {
  let depth = 1;
  let quote: Quote | undefined;

  for (let index = start + 2; index < value.length; index++) {
    consumeScanWork?.(1);
    const character = value[index];
    if (quote) {
      if (character === "\\" && quote !== "'" && index + 1 < value.length) {
        index += 1;
      } else if (character === (quote === "$'" ? "'" : quote)) {
        quote = undefined;
      }
      continue;
    }
    if (character === "$" && value[index + 1] === "'") {
      quote = "$'";
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "\\" && index + 1 < value.length) {
      index += 1;
      continue;
    }
    if (
      character === "$" &&
      value[index + 1] === "(" &&
      value[index + 2] !== "("
    ) {
      const end = findCommandSubstitutionEnd(value, index, consumeScanWork);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/** Find the closing parenthesis for an extglob starting at `openIndex`. */
export function findExtglobClose(
  value: string,
  openIndex: number,
  stopAtNewline = false,
  consumeScanWork?: (count: number) => void,
): number {
  let depth = 1;
  let quote: Quote | undefined;
  let hasUnterminatedBracket = false;

  for (let index = openIndex + 1; index < value.length; index++) {
    consumeScanWork?.(1);
    const character = value[index];

    if (quote) {
      if (
        quote === '"' &&
        character === "$" &&
        value[index + 1] === "(" &&
        value[index + 2] !== "("
      ) {
        const end = findCommandSubstitutionEnd(value, index, consumeScanWork);
        if (end === -1) return -1;
        index = end;
        continue;
      }
      if (character === "\\" && quote !== "'" && index + 1 < value.length) {
        index += 1;
      } else if (character === (quote === "$'" ? "'" : quote)) {
        quote = undefined;
      }
      continue;
    }

    if (character === "$" && value[index + 1] === "'") {
      quote = "$'";
      index += 1;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "\\" && index + 1 < value.length) {
      index += 1;
      continue;
    }

    if (character === "$" && value[index + 1] === "{") {
      const end = findParameterExpansionEnd(
        value,
        index,
        stopAtNewline,
        consumeScanWork,
      );
      if (end === -1) return -1;
      index = end;
      continue;
    }

    if (
      character === "$" &&
      value[index + 1] === "(" &&
      value[index + 2] !== "("
    ) {
      const end = findCommandSubstitutionEnd(value, index, consumeScanWork);
      if (end === -1) return -1;
      index = end;
      continue;
    }

    if (character === "`") {
      index = findBacktickClose(value, index, stopAtNewline);
      if (index === -1) return -1;
      continue;
    }

    if (character === "[" && !hasUnterminatedBracket) {
      const close = findBracketExpressionEnd(value, index, stopAtNewline);
      if (close !== -1) {
        index = close;
        continue;
      }
      hasUnterminatedBracket = true;
    }

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/** Split top-level extglob alternatives without interpreting quoted or nested text. */
export function splitExtglobAlternatives(
  content: string,
  maximum: number = Number.POSITIVE_INFINITY,
): string[] | null {
  const alternatives: string[] = [];
  const braceEnds = findBraceEnds(content);
  let start = 0;
  let depth = 0;
  let quote: Quote | undefined;
  let hasUnterminatedBracket = false;

  for (let index = 0; index < content.length; index++) {
    const character = content[index];

    if (quote) {
      if (
        quote === '"' &&
        character === "$" &&
        content[index + 1] === "(" &&
        content[index + 2] !== "("
      ) {
        const end = findCommandSubstitutionEnd(content, index);
        if (end === -1) break;
        index = end;
        continue;
      }
      if (character === "\\" && quote !== "'" && index + 1 < content.length) {
        index += 1;
      } else if (character === (quote === "$'" ? "'" : quote)) {
        quote = undefined;
      }
      continue;
    }

    if (character === "$" && content[index + 1] === "'") {
      quote = "$'";
      index += 1;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "\\" && index + 1 < content.length) {
      index += 1;
      continue;
    }

    if (character === "$" && content[index + 1] === "{") {
      const end = findParameterExpansionEnd(content, index, false);
      if (end === -1) break;
      index = end;
      continue;
    }

    if (
      character === "$" &&
      content[index + 1] === "(" &&
      content[index + 2] !== "("
    ) {
      const end = findCommandSubstitutionEnd(content, index);
      if (end === -1) break;
      index = end;
      continue;
    }

    if (character === "`") {
      index = findBacktickClose(content, index, false);
      if (index === -1) break;
      continue;
    }

    if (character === "[" && !hasUnterminatedBracket) {
      const close = findBracketExpressionEnd(content, index, false);
      if (close !== -1) {
        index = close;
        continue;
      }
      hasUnterminatedBracket = true;
    }

    const braceEnd = braceEnds.get(index);
    if (braceEnd) {
      index = braceEnd - 1;
      continue;
    }

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "|" && depth === 0) {
      if (alternatives.length >= maximum - 1) return null;
      alternatives.push(content.slice(start, index));
      start = index + 1;
    }
  }

  alternatives.push(content.slice(start));
  return alternatives;
}

function findBraceEnds(value: string): Map<number, number> {
  const ends = new Map<number, number>();
  const braces: Array<{
    start: number;
    forceOpaque: boolean;
    hasComma: boolean;
    hasNestedBrace: boolean;
    hasNestedExpansion: boolean;
    rangeContent: string | undefined;
  }> = [];
  let quote: Quote | undefined;
  let hasUnterminatedBracket = false;

  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const brace = braces[braces.length - 1];

    if (quote) {
      if (brace) {
        if (character === ",") brace.hasComma = true;
        brace.rangeContent = undefined;
      }
      if (character === "\\" && quote !== "'" && index + 1 < value.length) {
        index += 1;
      } else if (character === (quote === "$'" ? "'" : quote)) {
        quote = undefined;
      }
      continue;
    }

    if (character === "$" && value[index + 1] === "'") {
      if (brace) brace.rangeContent = undefined;
      quote = "$'";
      index += 1;
      continue;
    }

    if (character === "'" || character === '"') {
      if (brace) brace.rangeContent = undefined;
      quote = character;
      continue;
    }

    if (character === "\\" && index + 1 < value.length) {
      if (brace) {
        brace.rangeContent = undefined;
        if (value[index + 1] === ",") brace.hasComma = true;
      }
      index += 1;
      continue;
    }

    if (character === "$" && value[index + 1] === "{") {
      const end = findParameterExpansionEnd(value, index, false);
      if (end === -1) return ends;
      if (brace) brace.rangeContent = undefined;
      index = end;
      continue;
    }

    if (
      character === "$" &&
      value[index + 1] === "(" &&
      value[index + 2] !== "("
    ) {
      const end = findCommandSubstitutionEnd(value, index);
      if (end === -1) return ends;
      if (brace) brace.rangeContent = undefined;
      index = end;
      continue;
    }

    if (character === "`") {
      const close = findBacktickClose(value, index, false);
      if (close === -1) return ends;
      if (brace) {
        brace.rangeContent = undefined;
        const comma = value.indexOf(",", index + 1);
        brace.hasComma ||= comma !== -1 && comma < close;
      }
      index = close;
      continue;
    }

    if (character === "[" && !hasUnterminatedBracket) {
      const close = findBracketExpressionEnd(value, index, false);
      if (close !== -1) {
        if (brace) {
          brace.rangeContent = undefined;
          const comma = value.indexOf(",", index + 1);
          brace.hasComma ||= comma !== -1 && comma < close;
        }
        index = close;
        continue;
      }
      hasUnterminatedBracket = true;
    }

    if (character === "{") {
      if (brace) brace.hasNestedBrace = true;
      braces.push({
        start: index,
        forceOpaque: value[index - 1] === "$",
        hasComma: false,
        hasNestedBrace: false,
        hasNestedExpansion: false,
        rangeContent: "",
      });
    } else if (character === "}") {
      const closedBrace = braces.pop();
      if (!closedBrace) continue;
      const isExpansion =
        closedBrace.forceOpaque ||
        closedBrace.hasComma ||
        closedBrace.hasNestedExpansion ||
        (!closedBrace.hasNestedBrace &&
          closedBrace.rangeContent !== undefined &&
          isBraceRangeContent(closedBrace.rangeContent));
      if (isExpansion) {
        ends.set(closedBrace.start, index + 1);
        const parent = braces[braces.length - 1];
        if (parent) parent.hasNestedExpansion = true;
      }
    } else if (brace) {
      if (character === ",") brace.hasComma = true;
      if (brace.rangeContent !== undefined) {
        brace.rangeContent =
          brace.rangeContent.length < 32
            ? brace.rangeContent + character
            : undefined;
      }
    }
  }

  return ends;
}

function isBraceRangeContent(value: string): boolean {
  return (
    value.includes(",") ||
    /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(value) ||
    /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(value)
  );
}

function findBracketExpressionEnd(
  value: string,
  start: number,
  stopAtNewline: boolean,
): number {
  let index = start + 1;
  if (value[index] === "!" || value[index] === "^") index += 1;
  if (value[index] === "]") index += 1;

  while (index < value.length) {
    if (stopAtNewline && value[index] === "\n") {
      return -1;
    }
    if (value[index] === "\\" && index + 1 < value.length) {
      index += 2;
      continue;
    }

    if (
      value[index] === "[" &&
      (value[index + 1] === ":" ||
        value[index + 1] === "." ||
        value[index + 1] === "=")
    ) {
      const delimiter = value[index + 1];
      const close = value.indexOf(`${delimiter}]`, index + 2);
      if (close !== -1) {
        index = close + 2;
        continue;
      }
    }

    if (value[index] === "]") return index;
    index += 1;
  }

  return -1;
}

function findBacktickClose(
  value: string,
  start: number,
  stopAtNewline: boolean,
): number {
  for (let index = start + 1; index < value.length; index++) {
    if (stopAtNewline && value[index] === "\n") {
      return -1;
    }
    if (value[index] === "\\" && index + 1 < value.length) {
      index += 1;
    } else if (value[index] === "`") {
      return index;
    }
  }

  return -1;
}

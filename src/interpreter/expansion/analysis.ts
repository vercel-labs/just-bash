/**
 * Word Analysis
 *
 * Functions for analyzing word parts to determine:
 * - Whether async execution is needed
 * - What types of expansions are present
 */

import type {
  ArithExpr,
  ParameterExpansionPart,
  WordNode,
  WordPart,
} from "../../ast/types.js";

/**
 * Check if an arithmetic expression requires async execution
 * (contains command substitution)
 */
export function arithExprNeedsAsync(expr: ArithExpr): boolean {
  switch (expr.type) {
    case "ArithCommandSubst":
      return true;
    case "ArithNested":
      return arithExprNeedsAsync(expr.expression);
    case "ArithBinary":
      return arithExprNeedsAsync(expr.left) || arithExprNeedsAsync(expr.right);
    case "ArithUnary":
      return arithExprNeedsAsync(expr.operand);
    case "ArithTernary":
      return (
        arithExprNeedsAsync(expr.condition) ||
        arithExprNeedsAsync(expr.consequent) ||
        arithExprNeedsAsync(expr.alternate)
      );
    case "ArithAssignment":
      return arithExprNeedsAsync(expr.value);
    case "ArithGroup":
      return arithExprNeedsAsync(expr.expression);
    case "ArithArrayElement":
      return expr.index ? arithExprNeedsAsync(expr.index) : false;
    case "ArithConcat":
      return expr.parts.some(arithExprNeedsAsync);
    default:
      return false;
  }
}

/**
 * Check if a parameter expansion requires async execution
 */
export function paramExpansionNeedsAsync(
  part: ParameterExpansionPart,
): boolean {
  const op = part.operation;
  if (!op) return false;

  // Check if the operation's word contains async parts
  if ("word" in op && op.word && wordNeedsAsync(op.word)) {
    return true;
  }
  // Check pattern and replacement in PatternReplacement
  if (op.type === "PatternReplacement") {
    if (op.pattern && wordNeedsAsync(op.pattern)) return true;
    if (op.replacement && wordNeedsAsync(op.replacement)) return true;
  }
  // Check pattern in PatternRemoval
  if (
    op.type === "PatternRemoval" &&
    op.pattern &&
    wordNeedsAsync(op.pattern)
  ) {
    return true;
  }
  return false;
}

/**
 * Check if a word part requires async execution
 */
export function partNeedsAsync(part: WordPart): boolean {
  switch (part.type) {
    case "CommandSubstitution":
      return true;
    case "ArithmeticExpansion":
      return arithExprNeedsAsync(part.expression.expression);
    case "DoubleQuoted":
      return part.parts.some(partNeedsAsync);
    case "BraceExpansion":
      return part.items.some(
        (item) => item.type === "Word" && wordNeedsAsync(item.word),
      );
    case "ParameterExpansion":
      return paramExpansionNeedsAsync(part);
    default:
      return false;
  }
}

/**
 * Check if a word requires async execution
 */
export function wordNeedsAsync(word: WordNode): boolean {
  return word.parts.some(partNeedsAsync);
}

/**
 * Check if a parameter expansion has quoted parts in its operation word
 * e.g., ${v:-"AxBxC"} has a quoted default value
 */
export function hasQuotedOperationWord(part: ParameterExpansionPart): boolean {
  if (!part.operation) return false;

  const op = part.operation;
  let wordParts: WordPart[] | undefined;

  // These operation types have a 'word' property that can contain quoted parts
  if (
    op.type === "DefaultValue" ||
    op.type === "AssignDefault" ||
    op.type === "UseAlternative" ||
    op.type === "ErrorIfUnset"
  ) {
    wordParts = op.word?.parts;
  }

  if (!wordParts) return false;

  for (const p of wordParts) {
    if (p.type === "DoubleQuoted" || p.type === "SingleQuoted") {
      return true;
    }
  }
  return false;
}

/**
 * Result of analyzing word parts
 */
export interface WordPartsAnalysis {
  hasQuoted: boolean;
  hasCommandSub: boolean;
  hasArrayVar: boolean;
  hasArrayAtExpansion: boolean;
  hasParamExpansion: boolean;
}

/**
 * Analyze word parts for expansion behavior
 */
export function analyzeWordParts(parts: WordPart[]): WordPartsAnalysis {
  let hasQuoted = false;
  let hasCommandSub = false;
  let hasArrayVar = false;
  let hasArrayAtExpansion = false;
  let hasParamExpansion = false;

  for (const part of parts) {
    if (part.type === "SingleQuoted" || part.type === "DoubleQuoted") {
      hasQuoted = true;
      // Check for "${a[@]}" inside double quotes
      // BUT NOT if there's an operation like ${#a[@]} (Length) or other operations
      if (part.type === "DoubleQuoted") {
        for (const inner of part.parts) {
          if (inner.type === "ParameterExpansion") {
            // Check if it's array[@] or array[*] WITHOUT any operation
            const match = inner.parameter.match(
              /^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/,
            );
            if (match && !inner.operation) {
              hasArrayAtExpansion = true;
            }
          }
        }
      }
    }
    if (part.type === "CommandSubstitution") {
      hasCommandSub = true;
    }
    if (part.type === "ParameterExpansion") {
      hasParamExpansion = true;
      if (part.parameter === "@" || part.parameter === "*") {
        hasArrayVar = true;
      }
      // Check if the parameter expansion has quoted parts in its operation
      // e.g., ${v:-"AxBxC"} - the quoted default value should prevent word splitting
      if (hasQuotedOperationWord(part)) {
        hasQuoted = true;
      }
    }
  }

  return {
    hasQuoted,
    hasCommandSub,
    hasArrayVar,
    hasArrayAtExpansion,
    hasParamExpansion,
  };
}

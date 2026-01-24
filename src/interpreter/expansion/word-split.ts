/**
 * Word Splitting
 *
 * IFS-based word splitting for unquoted expansions.
 */

import type { ParameterExpansionPart, WordPart } from "../../ast/types.js";
import { getVariable, isVariableSet } from "../expansion/variable.js";
import { splitByIfsForExpansion } from "../helpers/ifs.js";
import type { InterpreterContext } from "../types.js";
import { isOperationWordEntirelyQuoted } from "./analysis.js";

/**
 * Type for the expandPart function that will be injected
 */
export type ExpandPartFn = (
  ctx: InterpreterContext,
  part: WordPart,
) => Promise<string>;

/**
 * Check if a ParameterExpansion with a default/alternative value should use that value.
 * Returns the operation word parts if the value should be used, null otherwise.
 */
function shouldUseOperationWord(
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
): WordPart[] | null {
  const op = part.operation;
  if (!op) return null;

  // Only handle DefaultValue, AssignDefault, and UseAlternative
  if (
    op.type !== "DefaultValue" &&
    op.type !== "AssignDefault" &&
    op.type !== "UseAlternative"
  ) {
    return null;
  }

  const word = (op as { word?: { parts: WordPart[] } }).word;
  if (!word || word.parts.length === 0) return null;

  // Check if the variable is set/empty
  // Pass checkNounset=false because we're inside a default/alternative value context
  // where unset variables are allowed
  const isSet = isVariableSet(ctx, part.parameter);
  const value = getVariable(ctx, part.parameter, false);
  const isEmpty = value === "";
  const checkEmpty = (op as { checkEmpty?: boolean }).checkEmpty ?? false;

  let shouldUse: boolean;
  if (op.type === "UseAlternative") {
    // ${var+word} - use word if var IS set (and non-empty if :+)
    shouldUse = isSet && !(checkEmpty && isEmpty);
  } else {
    // ${var-word} / ${var=word} - use word if var is NOT set (or empty if :-)
    shouldUse = !isSet || (checkEmpty && isEmpty);
  }

  if (!shouldUse) return null;

  return word.parts;
}

/**
 * Check if a word part is splittable (subject to IFS splitting).
 * Unquoted parameter expansions, command substitutions, and arithmetic expansions
 * are splittable. Quoted parts (DoubleQuoted, SingleQuoted) are NOT splittable.
 */
function isPartSplittable(part: WordPart): boolean {
  // Quoted parts are never splittable
  if (part.type === "DoubleQuoted" || part.type === "SingleQuoted") {
    return false;
  }

  // Literal parts are not splittable (they join with adjacent fields)
  if (part.type === "Literal") {
    return false;
  }

  // Glob parts are not splittable
  if (part.type === "Glob") {
    return false;
  }

  // Check for splittable expansion types
  const isSplittable =
    part.type === "ParameterExpansion" ||
    part.type === "CommandSubstitution" ||
    part.type === "ArithmeticExpansion";

  if (!isSplittable) {
    return false;
  }

  // Word splitting behavior depends on whether the default value is entirely quoted:
  //
  // - ${v:-"AxBxC"} - entirely quoted default value, should NOT be split
  //   The quotes protect the entire default value from word splitting.
  //
  // - ${v:-x"AxBxC"x} - mixed quoted/unquoted parts, SHOULD be split
  //   The unquoted parts (x) act as potential word boundaries when containing IFS chars.
  //   The quoted part "AxBxC" is protected from internal splitting.
  //
  // - ${v:-AxBxC} - entirely unquoted, SHOULD be split
  //   All IFS chars in the result cause word boundaries.
  //
  // - ${v:-x"$@"x} - contains $@ in quotes with surrounding literals
  //   bash 5.x: word splits the entire result (each space becomes a boundary)
  //   bash 3.2/osh: preserves $@ element boundaries but doesn't add more splits
  //
  // We check isOperationWordEntirelyQuoted: if true, the expansion is non-splittable.
  // If false (mixed or no quotes), word splitting applies.
  if (
    part.type === "ParameterExpansion" &&
    isOperationWordEntirelyQuoted(part)
  ) {
    return false;
  }

  return true;
}

/**
 * Smart word splitting for words containing expansions.
 *
 * In bash, word splitting respects quoted parts. When you have:
 * - $a"$b" where a="1 2" and b="3 4"
 * - The unquoted $a gets split by IFS: "1 2" -> ["1", "2"]
 * - The quoted "$b" does NOT get split, it joins with the last field from $a
 * - Result: ["1", "23 4"] (the "2" joins with "3 4")
 *
 * This differs from pure literal words which are never IFS-split.
 *
 * @param ctx - Interpreter context
 * @param wordParts - Word parts to expand and split
 * @param ifsChars - IFS characters for proper whitespace/non-whitespace handling
 * @param ifsPattern - Regex-escaped IFS pattern for checking if splitting is needed
 * @param expandPartFn - Function to expand individual parts (injected to avoid circular deps)
 */
export async function smartWordSplit(
  ctx: InterpreterContext,
  wordParts: WordPart[],
  ifsChars: string,
  _ifsPattern: string,
  expandPartFn: ExpandPartFn,
): Promise<string[]> {
  // Check for special case: ParameterExpansion with a default value that should be used
  // In this case, we need to recursively word-split the default value's parts
  // to preserve quote boundaries within the default value.
  if (wordParts.length === 1 && wordParts[0].type === "ParameterExpansion") {
    const paramPart = wordParts[0];
    const opWordParts = shouldUseOperationWord(ctx, paramPart);
    if (opWordParts && opWordParts.length > 0) {
      // Check if the operation word has mixed quoted/unquoted parts
      // that would benefit from recursive word splitting
      const hasMixedParts =
        opWordParts.length > 1 &&
        opWordParts.some(
          (p) => p.type === "DoubleQuoted" || p.type === "SingleQuoted",
        ) &&
        opWordParts.some(
          (p) =>
            p.type === "Literal" ||
            p.type === "ParameterExpansion" ||
            p.type === "CommandSubstitution" ||
            p.type === "ArithmeticExpansion",
        );

      if (hasMixedParts) {
        // Recursively word-split the default value's parts
        // But we need special handling: Literal parts from the default value
        // SHOULD be split because they're in an unquoted context
        return smartWordSplitWithUnquotedLiterals(
          ctx,
          opWordParts,
          ifsChars,
          _ifsPattern,
          expandPartFn,
        );
      }
    }
  }

  // Expand all parts and track if they are splittable
  type Segment = { value: string; isSplittable: boolean };
  const segments: Segment[] = [];
  let hasAnySplittable = false;

  for (const part of wordParts) {
    const splittable = isPartSplittable(part);
    const expanded = await expandPartFn(ctx, part);
    segments.push({ value: expanded, isSplittable: splittable });

    if (splittable) {
      hasAnySplittable = true;
    }
  }

  // If there's no splittable expansion, return the joined value as-is
  // (pure literals are not subject to IFS splitting)
  if (!hasAnySplittable) {
    const joined = segments.map((s) => s.value).join("");
    return joined ? [joined] : [];
  }

  // Now do the smart word splitting:
  // - Splittable parts get split by IFS
  // - Non-splittable parts (quoted, literals) join with adjacent fields
  //
  // Algorithm:
  // We maintain an array of words being built. The current word is built up
  // by accumulating non-split content. When we split a splittable part:
  // - The first fragment joins with the current word
  // - Middle fragments become separate words
  // - The last fragment becomes the start of a new current word
  //
  // Important distinction:
  // - split returning [] (empty array) = nothing to add, continue building
  // - split returning [""] (array with one empty string) = produces empty word
  // - split returning ["x"] = produces "x" to append to current word

  const words: string[] = [];
  let currentWord = "";
  // Track if we've produced any actual words (including empty ones from splits)
  let hasProducedWord = false;

  for (const segment of segments) {
    if (!segment.isSplittable) {
      // Non-splittable: append to current word (no splitting)
      currentWord += segment.value;
    } else {
      // Splittable: split by IFS
      const parts = splitByIfsForExpansion(segment.value, ifsChars);

      if (parts.length === 0) {
        // Empty expansion produces nothing - continue building current word
        // This happens for empty string or all-whitespace with default IFS
      } else if (parts.length === 1) {
        // Single result: just append to current word
        // Note: parts[0] might be empty string (e.g., IFS='_' and var='_' produces [""])
        currentWord += parts[0];
        hasProducedWord = true;
      } else {
        // Multiple results from split:
        // - First part joins with current word
        // - Middle parts become separate words
        // - Last part starts the new current word
        currentWord += parts[0];
        words.push(currentWord);
        hasProducedWord = true;

        // Add middle parts as separate words
        for (let i = 1; i < parts.length - 1; i++) {
          words.push(parts[i]);
        }

        // Last part becomes the new current word
        currentWord = parts[parts.length - 1];
      }
    }
  }

  // Add the remaining current word
  // We add it if:
  // - currentWord is non-empty, OR
  // - we haven't produced any words yet but we've had a split that produced content
  //   (this handles the case of IFS='_' and var='_' -> [""])
  if (currentWord !== "") {
    words.push(currentWord);
  } else if (words.length === 0 && hasProducedWord) {
    // The only content was from a split that produced [""] (empty string)
    words.push("");
  }

  return words;
}

/**
 * Check if a string starts with an IFS character
 */
function startsWithIfs(value: string, ifsChars: string): boolean {
  return value.length > 0 && ifsChars.includes(value[0]);
}

/**
 * Word splitting for default value parts where Literal parts ARE splittable.
 * This is used when processing ${var:-"a b" c} where the default value has
 * mixed quoted and unquoted parts. The unquoted Literal parts should be split.
 */
async function smartWordSplitWithUnquotedLiterals(
  ctx: InterpreterContext,
  wordParts: WordPart[],
  ifsChars: string,
  _ifsPattern: string,
  expandPartFn: ExpandPartFn,
): Promise<string[]> {
  // Expand all parts and track if they are splittable
  // In this context, Literal parts ARE splittable
  type Segment = { value: string; isSplittable: boolean };
  const segments: Segment[] = [];

  for (const part of wordParts) {
    // Quoted parts are not splittable
    const isQuoted =
      part.type === "DoubleQuoted" || part.type === "SingleQuoted";
    // In the context of a default value, everything non-quoted is splittable
    const splittable = !isQuoted;
    const expanded = await expandPartFn(ctx, part);
    segments.push({ value: expanded, isSplittable: splittable });
  }

  // Word splitting algorithm
  // Key difference from standard smartWordSplit:
  // When a splittable segment starts with an IFS character, it causes a word break
  // from the previous content, even if the split produces only one word.
  const words: string[] = [];
  let currentWord = "";
  let hasProducedWord = false;

  for (const segment of segments) {
    if (!segment.isSplittable) {
      // Non-splittable (quoted): append to current word
      currentWord += segment.value;
    } else {
      // Splittable: check if it starts with IFS (causes word break)
      const startsWithIfsChar = startsWithIfs(segment.value, ifsChars);

      // If the segment starts with IFS and we have accumulated content,
      // finish the current word first
      if (startsWithIfsChar && currentWord !== "") {
        words.push(currentWord);
        currentWord = "";
        hasProducedWord = true;
      }

      // Split by IFS
      const parts = splitByIfsForExpansion(segment.value, ifsChars);

      if (parts.length === 0) {
        // Empty expansion produces nothing
      } else if (parts.length === 1) {
        currentWord += parts[0];
        hasProducedWord = true;
      } else {
        // Multiple results from split
        currentWord += parts[0];
        words.push(currentWord);
        hasProducedWord = true;

        for (let i = 1; i < parts.length - 1; i++) {
          words.push(parts[i]);
        }

        currentWord = parts[parts.length - 1];
      }
    }
  }

  if (currentWord !== "") {
    words.push(currentWord);
  } else if (words.length === 0 && hasProducedWord) {
    words.push("");
  }

  return words;
}

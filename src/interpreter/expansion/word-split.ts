/**
 * Word Splitting
 *
 * IFS-based word splitting for unquoted expansions.
 */

import type { WordPart } from "../../ast/types.js";
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

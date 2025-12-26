/**
 * Word Splitting
 *
 * IFS-based word splitting for unquoted expansions.
 */

import type { WordPart } from "../../ast/types.js";
import type { InterpreterContext } from "../types.js";
import { hasQuotedOperationWord } from "./analysis.js";

/**
 * Type for the expandPart function that will be injected
 */
export type ExpandPartFn = (
  ctx: InterpreterContext,
  part: WordPart,
) => Promise<string>;

/**
 * Smart word splitting that respects expansion boundaries.
 *
 * E.g., with IFS=x: ${v:-AxBxC}x should give "A B Cx" (literal x attaches to last field)
 * E.g., with IFS=x: y${v:-AxBxC}z should give "yA B Cz" (literals attach to first/last fields)
 *
 * @param ctx - Interpreter context
 * @param wordParts - Word parts to expand and split
 * @param _ifsChars - IFS characters (unused, kept for API compatibility)
 * @param ifsPattern - Regex-escaped IFS pattern for splitting
 * @param expandPartFn - Function to expand individual parts (injected to avoid circular deps)
 */
export async function smartWordSplit(
  ctx: InterpreterContext,
  wordParts: WordPart[],
  _ifsChars: string,
  ifsPattern: string,
  expandPartFn: ExpandPartFn,
): Promise<string[]> {
  // First, check if any expansion result contains IFS characters
  // If not, no splitting needed
  type Segment = { value: string; splittable: boolean };
  const segments: Segment[] = [];

  for (const part of wordParts) {
    const isSplittable =
      part.type === "ParameterExpansion" ||
      part.type === "CommandSubstitution" ||
      part.type === "ArithmeticExpansion";

    // Check if parameter expansion has quoted operation word - those shouldn't split
    if (part.type === "ParameterExpansion" && hasQuotedOperationWord(part)) {
      const expanded = await expandPartFn(ctx, part);
      segments.push({ value: expanded, splittable: false });
    } else {
      const expanded = await expandPartFn(ctx, part);
      segments.push({ value: expanded, splittable: isSplittable });
    }
  }

  // Check if any splittable segment contains IFS chars
  const hasSplittableIFS = segments.some(
    (seg) => seg.splittable && new RegExp(`[${ifsPattern}]`).test(seg.value),
  );

  if (!hasSplittableIFS) {
    // No splitting needed - return the joined value to avoid double expansion
    const joined = segments.map((s) => s.value).join("");
    return joined ? [joined] : [];
  }

  // Now do the smart splitting
  const ifsRegex = new RegExp(`[${ifsPattern}]+`);
  const result: string[] = [];
  let currentField = "";

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (!seg.splittable) {
      // Literal: append to current field
      currentField += seg.value;
    } else {
      // Splittable: apply IFS splitting
      const fields = seg.value.split(ifsRegex);

      for (let j = 0; j < fields.length; j++) {
        if (j === 0) {
          // First field: append to current accumulated literal
          currentField += fields[j];
        } else {
          // Subsequent fields: push previous and start new
          if (currentField !== "") {
            result.push(currentField);
          }
          currentField = fields[j];
        }
      }
    }
  }

  // Push final field if not empty
  if (currentField !== "") {
    result.push(currentField);
  }

  // Always return the result to avoid double expansion
  // The result contains [joined_value] if no splitting happened
  return result;
}

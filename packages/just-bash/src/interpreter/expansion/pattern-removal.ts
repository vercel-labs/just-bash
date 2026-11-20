/**
 * Pattern Removal Helpers
 *
 * Functions for ${var#pattern}, ${var%pattern}, ${!prefix*} etc.
 */

import type { WordNode } from "../../ast/types.js";
import { createUserRegex } from "../../regex/index.js";
import { escapeRegex } from "../helpers/regex.js";
import type { InterpreterContext } from "../types.js";
import type {
  ExpandPartFn,
  ExpandWordPartsAsyncFn,
} from "./array-word-expansion.js";
import { patternToRegex } from "./pattern.js";

export async function buildPatternRemovalRegex(
  ctx: InterpreterContext,
  pattern: WordNode,
  greedy: boolean,
  expandWordPartsAsync: ExpandWordPartsAsyncFn,
  expandPart: ExpandPartFn,
): Promise<string> {
  let regexStr = "";
  const extglob = ctx.state.shoptOptions.extglob;
  // Pattern parts can mutate shell state, so expand them sequentially.
  for (const part of pattern.parts) {
    if (part.type === "Glob") {
      regexStr += patternToRegex(part.pattern, greedy, extglob);
    } else if (part.type === "Literal") {
      regexStr += patternToRegex(part.value, greedy, extglob);
    } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
      regexStr += escapeRegex(part.value);
    } else if (part.type === "DoubleQuoted") {
      const expanded = await expandWordPartsAsync(ctx, part.parts);
      regexStr += escapeRegex(expanded);
    } else if (part.type === "ParameterExpansion") {
      const expanded = await expandPart(ctx, part);
      regexStr += patternToRegex(expanded, greedy, extglob);
    } else {
      const expanded = await expandPart(ctx, part);
      regexStr += escapeRegex(expanded);
    }
  }
  return regexStr;
}

/**
 * Apply pattern removal (prefix or suffix strip) to a single value.
 * Used by both scalar and vectorized array operations.
 */
export function applyPatternRemoval(
  ctx: InterpreterContext,
  value: string,
  regexStr: string,
  side: "prefix" | "suffix",
  greedy: boolean,
): string {
  // Use 's' flag (dotall) so that . matches newlines (bash ? matches any char including newline)
  if (side === "prefix") {
    ctx.executionScope.consumeLimited(
      "pattern-removal",
      Math.max(1, value.length),
      ctx.limits.maxGlobOperations,
      "pattern removal",
    );
    // Prefix removal: greedy matches longest from start, non-greedy matches shortest
    return createUserRegex(`^${regexStr}`, "s").replace(value, "");
  }
  // Suffix removal needs special handling because we need to find
  // the rightmost (shortest) or leftmost (longest) match
  const regex = createUserRegex(`${regexStr}$`, "s");
  if (greedy) {
    ctx.executionScope.consumeLimited(
      "pattern-removal",
      Math.max(1, value.length),
      ctx.limits.maxGlobOperations,
      "pattern removal",
    );
    // %% - longest match: use regex directly (finds leftmost match)
    return regex.replace(value, "");
  }
  // % - let a greedy prefix consume as much as possible, leaving the shortest
  // suffix that satisfies the user's pattern. This avoids the old quadratic
  // loop over every copied suffix while preserving Bash's rightmost match.
  ctx.executionScope.consumeLimited(
    "pattern-removal",
    Math.max(1, value.length),
    ctx.limits.maxGlobOperations,
    "pattern removal",
  );
  const shortest = createUserRegex(`^(?:.*)(${regexStr})$`, "s").exec(value);
  if (!shortest) return value;
  const suffix = shortest[1] ?? "";
  return value.slice(0, value.length - suffix.length);
}

/**
 * Get variable names that match a given prefix.
 * Used for ${!prefix*} and ${!prefix@} expansions.
 * Includes names from both the scalar and structured-array namespaces.
 */
export function getVarNamesWithPrefix(
  ctx: InterpreterContext,
  prefix: string,
): string[] {
  const matchingVars = new Set<string>();
  for (const name of ctx.state.env.keys()) {
    if (name.startsWith(prefix)) matchingVars.add(name);
  }
  for (const name of ctx.state.arrays?.keys() ?? []) {
    if (name.startsWith(prefix)) matchingVars.add(name);
  }

  return [...matchingVars].sort();
}

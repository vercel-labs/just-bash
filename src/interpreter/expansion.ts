/**
 * Word Expansion
 *
 * Handles shell word expansion including:
 * - Variable expansion ($VAR, ${VAR})
 * - Command substitution $(...)
 * - Arithmetic expansion $((...))
 * - Tilde expansion (~)
 * - Brace expansion {a,b,c}
 * - Glob expansion (*, ?, [...])
 */

import type {
  ParameterExpansionPart,
  WordNode,
  WordPart,
} from "../ast/types.js";
import { parseArithmeticExpression } from "../parser/arithmetic-parser.js";
import { Parser } from "../parser/parser.js";
import { GlobExpander } from "../shell/glob.js";
import { evaluateArithmetic } from "./arithmetic.js";
import {
  BadSubstitutionError,
  ExecutionLimitError,
  ExitError,
  GlobError,
} from "./errors.js";
import { analyzeWordParts } from "./expansion/analysis.js";
import {
  expandDollarVarsInArithText,
  expandSubscriptForAssocArray,
} from "./expansion/arith-text-expansion.js";
import {
  handleArrayPatternRemoval,
  handleArrayPatternReplacement,
} from "./expansion/array-pattern-ops.js";
import {
  handleArrayDefaultValue,
  handleArrayPatternWithPrefixSuffix,
  handleArrayWithPrefixSuffix,
} from "./expansion/array-prefix-suffix.js";
import {
  handleArraySlicing,
  handleArrayTransform,
} from "./expansion/array-slice-transform.js";
import {
  handleNamerefArrayExpansion,
  handleSimpleArrayExpansion,
} from "./expansion/array-word-expansion.js";
import { expandBraceRange } from "./expansion/brace-range.js";
import { getFileReadShorthand } from "./expansion/command-substitution.js";
// Import from extracted modules
import {
  escapeGlobChars,
  escapeRegexChars,
  hasGlobPattern,
  unescapeGlobPattern,
} from "./expansion/glob-helpers.js";
import {
  handleIndirectArrayExpansion,
  handleIndirectInAlternative,
  handleIndirectionWithInnerAlternative,
} from "./expansion/indirect-expansion.js";
import {
  computeIsEmpty,
  handleArrayKeys,
  handleAssignDefault,
  handleCaseModification,
  handleDefaultValue,
  handleErrorIfUnset,
  handleIndirection,
  handleLength,
  handlePatternRemoval,
  handlePatternReplacement,
  handleSubstring,
  handleTransform,
  handleUseAlternative,
  handleVarNamePrefix,
} from "./expansion/parameter-ops.js";
import {
  expandVariablesInPattern,
  expandVariablesInPatternAsync,
  patternHasCommandSubstitution,
} from "./expansion/pattern-expansion.js";
import { getVarNamesWithPrefix } from "./expansion/pattern-removal.js";
import {
  handlePositionalPatternRemoval,
  handlePositionalPatternReplacement,
  handlePositionalSlicing,
  handleSimplePositionalExpansion,
} from "./expansion/positional-params.js";
import { applyTildeExpansion } from "./expansion/tilde.js";
import {
  handleUnquotedArrayKeys,
  handleUnquotedArrayPatternRemoval,
  handleUnquotedArrayPatternReplacement,
  handleUnquotedPositionalPatternRemoval,
  handleUnquotedPositionalSlicing,
  handleUnquotedPositionalWithPrefixSuffix,
  handleUnquotedSimpleArray,
  handleUnquotedSimplePositional,
  handleUnquotedVarNamePrefix,
} from "./expansion/unquoted-expansion.js";
import {
  getArrayElements,
  getVariable,
  isVariableSet,
} from "./expansion/variable.js";
import { smartWordSplit } from "./expansion/word-split.js";
import {
  buildIfsCharClassPattern,
  getIfs,
  getIfsSeparator,
  isIfsEmpty,
  splitByIfsForExpansion,
} from "./helpers/ifs.js";
import { isNameref, resolveNameref } from "./helpers/nameref.js";
import { getLiteralValue, isQuotedPart } from "./helpers/word-parts.js";
import type { InterpreterContext } from "./types.js";

// Re-export extracted functions for use elsewhere
export { escapeGlobChars, escapeRegexChars } from "./expansion/glob-helpers.js";
// Re-export for backward compatibility
export {
  getArrayElements,
  getVariable,
  isArray,
} from "./expansion/variable.js";

// Helper to fully expand word parts (including variables, arithmetic, etc.)
async function expandWordPartsAsync(
  ctx: InterpreterContext,
  parts: WordPart[],
  inDoubleQuotes = false,
): Promise<string> {
  const results: string[] = [];
  for (const part of parts) {
    results.push(await expandPart(ctx, part, inDoubleQuotes));
  }
  return results.join("");
}

/**
 * Check if a word is "fully quoted" - meaning glob characters should be treated literally.
 * A word is fully quoted if all its parts are either:
 * - SingleQuoted
 * - DoubleQuoted (entirely quoted variable expansion like "$pat")
 * - Escaped characters
 */
function isPartFullyQuoted(part: WordPart): boolean {
  return isQuotedPart(part);
}

/**
 * Check if an entire word is fully quoted
 */
export function isWordFullyQuoted(word: WordNode): boolean {
  // Empty word is considered quoted (matches empty pattern literally)
  if (word.parts.length === 0) return true;

  // Check if we have any unquoted parts with actual content
  for (const part of word.parts) {
    if (!isPartFullyQuoted(part)) {
      return false;
    }
  }
  return true;
}

/**
 * Handle simple part types that don't require recursion or async.
 * Returns the expanded string, or null if the part type needs special handling.
 * inDoubleQuotes flag suppresses tilde expansion (tilde is literal inside "...")
 */
function expandSimplePart(
  ctx: InterpreterContext,
  part: WordPart,
  inDoubleQuotes = false,
): string | null {
  // Handle literal parts (Literal, SingleQuoted, Escaped)
  const literal = getLiteralValue(part);
  if (literal !== null) return literal;

  switch (part.type) {
    case "TildeExpansion":
      // Tilde expansion doesn't happen inside double quotes
      if (inDoubleQuotes) {
        return part.user === null ? "~" : `~${part.user}`;
      }
      if (part.user === null) {
        // Use HOME if set (even if empty), otherwise fall back to /home/user
        return ctx.state.env.HOME !== undefined
          ? ctx.state.env.HOME
          : "/home/user";
      }
      // ~username only expands if user exists
      // In sandboxed environment, we can only verify 'root' exists universally
      // Other unknown users stay literal (matches bash behavior)
      if (part.user === "root") {
        return "/root";
      }
      return `~${part.user}`;
    case "Glob":
      // Expand variables within extglob patterns (e.g., @($var|$other))
      return expandVariablesInPattern(ctx, part.pattern);
    default:
      return null; // Needs special handling (DoubleQuoted, BraceExpansion, ArithmeticExpansion, CommandSubstitution)
  }
}

export async function expandWord(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  return expandWordAsync(ctx, word);
}

/**
 * Expand a word for use as a regex pattern (in [[ =~ ]]).
 * Preserves backslash escapes so they're passed to the regex engine.
 * For example, \[\] becomes \[\] in the regex (matching literal [ and ]).
 */
export async function expandWordForRegex(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const parts: string[] = [];
  for (const part of word.parts) {
    if (part.type === "Escaped") {
      // For regex patterns, preserve ALL backslash escapes
      // This allows \[ \] \. \* etc. to work as regex escapes
      parts.push(`\\${part.value}`);
    } else if (part.type === "SingleQuoted") {
      // Single-quoted content is literal in regex
      parts.push(part.value);
    } else if (part.type === "DoubleQuoted") {
      // Double-quoted: expand contents
      const expanded = await expandWordPartsAsync(ctx, part.parts);
      parts.push(expanded);
    } else if (part.type === "TildeExpansion") {
      // Tilde expansion on RHS of =~ is treated as literal (regex chars escaped)
      // This matches bash 4.x+ behavior where ~ expands but the result is
      // matched literally, not as a regex pattern.
      // e.g., HOME='^a$'; [[ $HOME =~ ~ ]] matches because ~ expands to '^a$'
      // and then '^a$' is escaped to '\^a\$' which matches the literal string
      const expanded = await expandPart(ctx, part);
      parts.push(escapeRegexChars(expanded));
    } else {
      // Other parts: expand normally
      parts.push(await expandPart(ctx, part));
    }
  }
  return parts.join("");
}

/**
 * Expand a word for use as a pattern (e.g., in [[ == ]] or case).
 * Preserves backslash escapes for pattern metacharacters so they're treated literally.
 * This prevents `*\(\)` from being interpreted as an extglob pattern.
 */
export async function expandWordForPattern(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const parts: string[] = [];
  for (const part of word.parts) {
    if (part.type === "Escaped") {
      // For escaped characters that are pattern metacharacters, preserve the backslash
      // This includes: ( ) | * ? [ ] for glob/extglob patterns
      const ch = part.value;
      if ("()|*?[]".includes(ch)) {
        parts.push(`\\${ch}`);
      } else {
        parts.push(ch);
      }
    } else if (part.type === "SingleQuoted") {
      // Single-quoted content should be escaped for literal matching
      parts.push(escapeGlobChars(part.value));
    } else if (part.type === "DoubleQuoted") {
      // Double-quoted: expand contents and escape for literal matching
      const expanded = await expandWordPartsAsync(ctx, part.parts);
      parts.push(escapeGlobChars(expanded));
    } else {
      // Other parts: expand normally
      parts.push(await expandPart(ctx, part));
    }
  }
  return parts.join("");
}

/**
 * Expand a word for glob matching.
 * Unlike regular expansion, this escapes glob metacharacters in quoted parts
 * so they are treated as literals, while preserving glob patterns from Glob parts.
 * This enables patterns like '_tmp/[bc]'*.mm where [bc] is literal and * is a glob.
 */
async function expandWordForGlobbing(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const parts: string[] = [];
  for (const part of word.parts) {
    if (part.type === "SingleQuoted") {
      // Single-quoted content: escape glob metacharacters for literal matching
      parts.push(escapeGlobChars(part.value));
    } else if (part.type === "Escaped") {
      // Escaped character: escape if it's a glob metacharacter
      const ch = part.value;
      if ("*?[]\\()|".includes(ch)) {
        parts.push(`\\${ch}`);
      } else {
        parts.push(ch);
      }
    } else if (part.type === "DoubleQuoted") {
      // Double-quoted: expand contents and escape glob metacharacters
      const expanded = await expandWordPartsAsync(ctx, part.parts);
      parts.push(escapeGlobChars(expanded));
    } else if (part.type === "Glob") {
      // Glob pattern: expand variables and command substitutions within extglob patterns
      // e.g., @($var|$(echo foo)) needs both variable and command substitution expansion
      if (patternHasCommandSubstitution(part.pattern)) {
        // Use async version for command substitutions
        parts.push(await expandVariablesInPatternAsync(ctx, part.pattern));
      } else {
        // Use sync version for simple variable expansion
        parts.push(expandVariablesInPattern(ctx, part.pattern));
      }
    } else if (part.type === "Literal") {
      // Literal: keep as-is (may contain glob characters that should glob)
      parts.push(part.value);
    } else {
      // Other parts (ParameterExpansion, etc.): expand normally
      parts.push(await expandPart(ctx, part));
    }
  }
  return parts.join("");
}

/**
 * Check if word parts contain brace expansion
 */
function hasBraceExpansion(parts: WordPart[]): boolean {
  for (const part of parts) {
    if (part.type === "BraceExpansion") return true;
    if (part.type === "DoubleQuoted" && hasBraceExpansion(part.parts))
      return true;
  }
  return false;
}

// Maximum number of brace expansion results to prevent memory explosion
const MAX_BRACE_EXPANSION_RESULTS = 10000;
// Maximum total operations across all recursive calls
const MAX_BRACE_OPERATIONS = 100000;

type BraceExpandedPart = string | WordPart;

/**
 * Expand brace expansion in word parts, producing multiple arrays of parts.
 * Each result array represents the parts that will be joined to form one word.
 * For example, "pre{a,b}post" produces [["pre", "a", "post"], ["pre", "b", "post"]]
 *
 * Non-brace parts are kept as WordPart objects to allow deferred expansion.
 * This is necessary for bash-like behavior where side effects in expansions
 * (like $((i++))) are evaluated separately for each brace alternative.
 */
async function expandBracesInPartsAsync(
  ctx: InterpreterContext,
  parts: WordPart[],
  operationCounter: { count: number } = { count: 0 },
): Promise<BraceExpandedPart[][]> {
  if (operationCounter.count > MAX_BRACE_OPERATIONS) {
    return [[]];
  }

  let results: BraceExpandedPart[][] = [[]];

  for (const part of parts) {
    if (part.type === "BraceExpansion") {
      const braceValues: string[] = [];
      let hasInvalidRange = false;
      let invalidRangeLiteral = "";
      for (const item of part.items) {
        if (item.type === "Range") {
          const range = expandBraceRange(
            item.start,
            item.end,
            item.step,
            item.startStr,
            item.endStr,
          );
          if (range.expanded) {
            for (const val of range.expanded) {
              operationCounter.count++;
              braceValues.push(val);
            }
          } else {
            hasInvalidRange = true;
            invalidRangeLiteral = range.literal;
            break;
          }
        } else {
          // Word item - expand it (recursively handle nested braces)
          const expanded = await expandBracesInPartsAsync(
            ctx,
            item.word.parts,
            operationCounter,
          );
          for (const exp of expanded) {
            operationCounter.count++;
            // Join all parts, expanding any deferred WordParts
            const joinedParts: string[] = [];
            for (const p of exp) {
              if (typeof p === "string") {
                joinedParts.push(p);
              } else {
                joinedParts.push(await expandPart(ctx, p));
              }
            }
            braceValues.push(joinedParts.join(""));
          }
        }
      }

      if (hasInvalidRange) {
        for (const result of results) {
          operationCounter.count++;
          result.push(invalidRangeLiteral);
        }
        continue;
      }

      const newSize = results.length * braceValues.length;
      if (
        newSize > MAX_BRACE_EXPANSION_RESULTS ||
        operationCounter.count > MAX_BRACE_OPERATIONS
      ) {
        return results;
      }

      const newResults: BraceExpandedPart[][] = [];
      for (const result of results) {
        for (const val of braceValues) {
          operationCounter.count++;
          if (operationCounter.count > MAX_BRACE_OPERATIONS) {
            return newResults.length > 0 ? newResults : results;
          }
          newResults.push([...result, val]);
        }
      }
      results = newResults;
    } else {
      // Non-brace part: keep as WordPart for deferred expansion
      for (const result of results) {
        operationCounter.count++;
        result.push(part);
      }
    }
  }

  return results;
}

/**
 * Async version of expandWordWithBraces
 */
async function expandWordWithBracesAsync(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string[]> {
  const parts = word.parts;

  if (!hasBraceExpansion(parts)) {
    return [await expandWord(ctx, word)];
  }

  const expanded = await expandBracesInPartsAsync(ctx, parts);

  // Now expand each result, evaluating deferred parts separately for each
  // This ensures side effects like $((i++)) are evaluated fresh for each brace alternative
  const results: string[] = [];
  for (const resultParts of expanded) {
    const joinedParts: string[] = [];
    for (const p of resultParts) {
      if (typeof p === "string") {
        joinedParts.push(p);
      } else {
        // Expand the deferred WordPart now (async)
        joinedParts.push(await expandPart(ctx, p));
      }
    }
    // Apply tilde expansion to each result - this handles cases like ~{/src,root}
    // where brace expansion produces ~/src and ~root, which then need tilde expansion
    results.push(applyTildeExpansion(ctx, joinedParts.join("")));
  }
  return results;
}

export async function expandWordWithGlob(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<{ values: string[]; quoted: boolean }> {
  const wordParts = word.parts;
  const {
    hasQuoted,
    hasCommandSub,
    hasArrayVar,
    hasArrayAtExpansion,
    hasParamExpansion,
    hasVarNamePrefixExpansion,
    hasIndirection,
  } = analyzeWordParts(wordParts);

  // Handle brace expansion first (produces multiple values)
  const hasBraces = hasBraceExpansion(wordParts);
  const braceExpanded = hasBraces
    ? await expandWordWithBracesAsync(ctx, word)
    : null;

  if (braceExpanded && braceExpanded.length > 1) {
    // Brace expansion produced multiple values - apply glob to each
    const allValues: string[] = [];
    for (const value of braceExpanded) {
      // Word elision: In bash, empty strings from unquoted brace expansion
      // are elided (removed from the result). For example, {X,,Y,} produces
      // just X and Y, not X, '', Y, ''.
      // This only applies when the word has no quoted parts.
      if (!hasQuoted && value === "") {
        continue;
      }
      // Skip glob expansion if noglob is set (set -f)
      if (
        !hasQuoted &&
        !ctx.state.options.noglob &&
        hasGlobPattern(value, ctx.state.shoptOptions.extglob)
      ) {
        const globExpander = new GlobExpander(
          ctx.fs,
          ctx.state.cwd,
          ctx.state.env,
          {
            globstar: ctx.state.shoptOptions.globstar,
            nullglob: ctx.state.shoptOptions.nullglob,
            failglob: ctx.state.shoptOptions.failglob,
            dotglob: ctx.state.shoptOptions.dotglob,
            extglob: ctx.state.shoptOptions.extglob,
            globskipdots: ctx.state.shoptOptions.globskipdots,
          },
        );
        const matches = await globExpander.expand(value);
        if (matches.length > 0) {
          allValues.push(...matches);
        } else if (globExpander.hasFailglob()) {
          // failglob: throw error when pattern has no matches
          throw new GlobError(value);
        } else if (globExpander.hasNullglob()) {
          // nullglob: don't add anything when pattern has no matches
          // (skip adding this value)
        } else {
          // Default: keep the original pattern
          allValues.push(value);
        }
      } else {
        allValues.push(value);
      }
    }
    return { values: allValues, quoted: false };
  }

  // Special handling for "${a[@]}" - each array element becomes a separate word
  if (hasArrayAtExpansion) {
    const simpleArrayResult = handleSimpleArrayExpansion(ctx, wordParts);
    if (simpleArrayResult !== null) {
      return simpleArrayResult;
    }
  }

  // Handle namerefs pointing to array[@] - "${ref}" where ref='arr[@]'
  {
    const namerefArrayResult = handleNamerefArrayExpansion(ctx, wordParts);
    if (namerefArrayResult !== null) {
      return namerefArrayResult;
    }
  }

  // Handle "${arr[@]:-${default[@]}}", "${arr[@]:+${alt[@]}}", and "${arr[@]:=default}" - array default/alternative values
  {
    const arrayDefaultResult = await handleArrayDefaultValue(ctx, wordParts);
    if (arrayDefaultResult !== null) {
      return arrayDefaultResult;
    }
  }

  // Handle "${prefix}${arr[@]#pattern}${suffix}" and "${prefix}${arr[@]/pat/rep}${suffix}"
  {
    const arrayPatternPrefixSuffixResult =
      await handleArrayPatternWithPrefixSuffix(
        ctx,
        wordParts,
        hasArrayAtExpansion,
        expandPart,
        expandWordPartsAsync,
      );
    if (arrayPatternPrefixSuffixResult !== null) {
      return arrayPatternPrefixSuffixResult;
    }
  }

  // Handle "${prefix}${arr[@]}${suffix}" - array expansion with adjacent text in double quotes
  {
    const arrayPrefixSuffixResult = await handleArrayWithPrefixSuffix(
      ctx,
      wordParts,
      hasArrayAtExpansion,
      expandPart,
    );
    if (arrayPrefixSuffixResult !== null) {
      return arrayPrefixSuffixResult;
    }
  }

  // Handle "${arr[@]:offset}" and "${arr[@]:offset:length}" - array slicing
  {
    const arraySlicingResult = await handleArraySlicing(
      ctx,
      wordParts,
      evaluateArithmetic,
    );
    if (arraySlicingResult !== null) {
      return arraySlicingResult;
    }
  }

  // Handle "${arr[@]@a}", "${arr[@]@P}", "${arr[@]@Q}" - array Transform operations
  {
    const arrayTransformResult = handleArrayTransform(ctx, wordParts);
    if (arrayTransformResult !== null) {
      return arrayTransformResult;
    }
  }

  // Handle "${arr[@]/pattern/replacement}" and "${arr[*]/pattern/replacement}" - array pattern replacement
  {
    const arrayPatReplResult = await handleArrayPatternReplacement(
      ctx,
      wordParts,
      expandWordPartsAsync,
      expandPart,
    );
    if (arrayPatReplResult !== null) {
      return arrayPatReplResult;
    }
  }

  // Handle "${arr[@]#pattern}" and "${arr[*]#pattern}" - array pattern removal (strip)
  {
    const arrayPatRemResult = await handleArrayPatternRemoval(
      ctx,
      wordParts,
      expandWordPartsAsync,
      expandPart,
    );
    if (arrayPatRemResult !== null) {
      return arrayPatRemResult;
    }
  }

  // Handle "${!prefix@}" and "${!prefix*}" - variable name prefix expansion
  // "${!prefix@}": Each variable name becomes a separate word (like "$@")
  // "${!prefix*}": All names joined with IFS[0] into one word (like "$*")
  if (
    hasVarNamePrefixExpansion &&
    wordParts.length === 1 &&
    wordParts[0].type === "DoubleQuoted"
  ) {
    const dqPart = wordParts[0];
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      dqPart.parts[0].operation?.type === "VarNamePrefix"
    ) {
      const op = dqPart.parts[0].operation;
      const matchingVars = getVarNamesWithPrefix(ctx, op.prefix);

      if (op.star) {
        // "${!prefix*}" - join with first char of IFS into one word
        return {
          values: [matchingVars.join(getIfsSeparator(ctx.state.env))],
          quoted: true,
        };
      }
      // "${!prefix@}" - each name as a separate word
      return { values: matchingVars, quoted: true };
    }

    // Handle "${!arr[@]}" and "${!arr[*]}" - array keys/indices expansion
    // "${!arr[@]}": Each key/index becomes a separate word (like "$@")
    // "${!arr[*]}": All keys joined with IFS[0] into one word (like "$*")
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      dqPart.parts[0].operation?.type === "ArrayKeys"
    ) {
      const op = dqPart.parts[0].operation;
      const elements = getArrayElements(ctx, op.array);
      const keys = elements.map(([k]) => String(k));

      if (op.star) {
        // "${!arr[*]}" - join with first char of IFS into one word
        return {
          values: [keys.join(getIfsSeparator(ctx.state.env))],
          quoted: true,
        };
      }
      // "${!arr[@]}" - each key as a separate word
      return { values: keys, quoted: true };
    }
  }

  // Handle "${!ref}" where ref='arr[@]' or ref='arr[*]' - indirect array expansion
  {
    const indirectArrayResult = await handleIndirectArrayExpansion(
      ctx,
      wordParts,
      hasIndirection,
      expandParameterAsync,
      expandWordPartsAsync,
    );
    if (indirectArrayResult !== null) {
      return indirectArrayResult;
    }
  }

  // Handle unquoted ${ref+...} or ${ref-...} where the word contains "${!ref}" (quoted indirect array expansion)
  {
    const indirectInAltResult = await handleIndirectInAlternative(
      ctx,
      wordParts,
    );
    if (indirectInAltResult !== null) {
      return indirectInAltResult;
    }
  }

  // Handle unquoted ${!ref+...} or ${!ref-...} where the word contains "${!ref}" (quoted indirect array expansion)
  {
    const indirectionWithInnerResult =
      await handleIndirectionWithInnerAlternative(ctx, wordParts);
    if (indirectionWithInnerResult !== null) {
      return indirectionWithInnerResult;
    }
  }

  // Handle "${@:offset}" and "${*:offset}" with Substring operations inside double quotes
  {
    const positionalSlicingResult = await handlePositionalSlicing(
      ctx,
      wordParts,
      evaluateArithmetic,
      expandPart,
    );
    if (positionalSlicingResult !== null) {
      return positionalSlicingResult;
    }
  }

  // Handle "${@/pattern/replacement}" and "${*/pattern/replacement}" with PatternReplacement
  {
    const positionalPatReplResult = await handlePositionalPatternReplacement(
      ctx,
      wordParts,
      expandPart,
      expandWordPartsAsync,
    );
    if (positionalPatReplResult !== null) {
      return positionalPatReplResult;
    }
  }

  // Handle "${@#pattern}" and "${*#pattern}" - positional parameter pattern removal (strip)
  {
    const positionalPatRemResult = await handlePositionalPatternRemoval(
      ctx,
      wordParts,
      expandPart,
      expandWordPartsAsync,
    );
    if (positionalPatRemResult !== null) {
      return positionalPatRemResult;
    }
  }

  // Handle "$@" and "$*" with adjacent text inside double quotes, e.g., "-$@-"
  {
    const simplePositionalResult = await handleSimplePositionalExpansion(
      ctx,
      wordParts,
      expandPart,
    );
    if (simplePositionalResult !== null) {
      return simplePositionalResult;
    }
  }

  // Handle unquoted ${array[@]/pattern/replacement} - apply to each element
  {
    const unquotedArrayPatReplResult =
      await handleUnquotedArrayPatternReplacement(
        ctx,
        wordParts,
        expandWordPartsAsync,
        expandPart,
      );
    if (unquotedArrayPatReplResult !== null) {
      return unquotedArrayPatReplResult;
    }
  }

  // Handle unquoted ${array[@]#pattern} - apply pattern removal to each element
  {
    const unquotedArrayPatRemResult = await handleUnquotedArrayPatternRemoval(
      ctx,
      wordParts,
      expandWordPartsAsync,
      expandPart,
    );
    if (unquotedArrayPatRemResult !== null) {
      return unquotedArrayPatRemResult;
    }
  }

  // Handle unquoted ${@#pattern} and ${*#pattern} - apply pattern removal to each positional parameter
  {
    const unquotedPosPatRemResult =
      await handleUnquotedPositionalPatternRemoval(
        ctx,
        wordParts,
        expandWordPartsAsync,
        expandPart,
      );
    if (unquotedPosPatRemResult !== null) {
      return unquotedPosPatRemResult;
    }
  }

  // Special handling for unquoted ${@:offset} and ${*:offset} (with potential prefix/suffix)
  {
    const unquotedSliceResult = await handleUnquotedPositionalSlicing(
      ctx,
      wordParts,
      evaluateArithmetic,
      expandPart,
    );
    if (unquotedSliceResult !== null) {
      return unquotedSliceResult;
    }
  }

  // Special handling for unquoted $@ and $*
  {
    const unquotedSimplePositionalResult = await handleUnquotedSimplePositional(
      ctx,
      wordParts,
    );
    if (unquotedSimplePositionalResult !== null) {
      return unquotedSimplePositionalResult;
    }
  }

  // Special handling for unquoted ${arr[@]} and ${arr[*]} (without operations)
  {
    const unquotedSimpleArrayResult = await handleUnquotedSimpleArray(
      ctx,
      wordParts,
    );
    if (unquotedSimpleArrayResult !== null) {
      return unquotedSimpleArrayResult;
    }
  }

  // Special handling for unquoted ${!prefix@} and ${!prefix*} (variable name prefix expansion)
  {
    const unquotedVarNamePrefixResult = handleUnquotedVarNamePrefix(
      ctx,
      wordParts,
    );
    if (unquotedVarNamePrefixResult !== null) {
      return unquotedVarNamePrefixResult;
    }
  }

  // Special handling for unquoted ${!arr[@]} and ${!arr[*]} (array keys/indices expansion)
  {
    const unquotedArrayKeysResult = handleUnquotedArrayKeys(ctx, wordParts);
    if (unquotedArrayKeysResult !== null) {
      return unquotedArrayKeysResult;
    }
  }

  // Special handling for unquoted $@ or $* with prefix/suffix (e.g., =$@= or =$*=)
  {
    const unquotedPrefixSuffixResult =
      await handleUnquotedPositionalWithPrefixSuffix(
        ctx,
        wordParts,
        expandPart,
      );
    if (unquotedPrefixSuffixResult !== null) {
      return unquotedPrefixSuffixResult;
    }
  }

  // Handle mixed word parts with word-producing expansions like $s1"${array[@]}"_"$@"
  // This case has multiple top-level parts where some are DoubleQuoted containing ${arr[@]} or $@
  // Each word-producing part expands to multiple words, and we need to join adjacent parts properly
  const mixedWordResult = await expandMixedWordParts(ctx, wordParts);
  if (mixedWordResult !== null) {
    // Apply glob expansion to each resulting word
    if (ctx.state.options.noglob) {
      return { values: mixedWordResult, quoted: false };
    }

    const globExpander = new GlobExpander(
      ctx.fs,
      ctx.state.cwd,
      ctx.state.env,
      {
        globstar: ctx.state.shoptOptions.globstar,
        nullglob: ctx.state.shoptOptions.nullglob,
        failglob: ctx.state.shoptOptions.failglob,
        dotglob: ctx.state.shoptOptions.dotglob,
        extglob: ctx.state.shoptOptions.extglob,
        globskipdots: ctx.state.shoptOptions.globskipdots,
      },
    );

    const expandedValues: string[] = [];
    for (const w of mixedWordResult) {
      if (hasGlobPattern(w, ctx.state.shoptOptions.extglob)) {
        const matches = await globExpander.expand(w);
        if (matches.length > 0) {
          expandedValues.push(...matches);
        } else if (globExpander.hasFailglob()) {
          throw new GlobError(w);
        } else if (globExpander.hasNullglob()) {
          // skip
        } else {
          expandedValues.push(w);
        }
      } else {
        expandedValues.push(w);
      }
    }
    return { values: expandedValues, quoted: false };
  }

  // No brace expansion or single value - use original logic
  // Word splitting based on IFS
  // If IFS is set to empty string, no word splitting occurs
  // Word splitting applies to results of parameter expansion, command substitution, and arithmetic expansion
  // Note: hasQuoted being true does NOT prevent word splitting - unquoted expansions like $a in $a"$b"
  // should still be split. The smartWordSplit function handles this by treating quoted parts as
  // non-splittable segments that join with adjacent fields.
  if (
    (hasCommandSub || hasArrayVar || hasParamExpansion) &&
    !isIfsEmpty(ctx.state.env)
  ) {
    const ifsChars = getIfs(ctx.state.env);
    // Build regex-safe pattern from IFS characters
    const ifsPattern = buildIfsCharClassPattern(ifsChars);

    // Smart word splitting: literals should NOT be split, they attach to adjacent fields
    // E.g., ${v:-AxBxC}x with IFS=x should give "A B Cx" not "A B C"
    const splitResult = await smartWordSplit(
      ctx,
      wordParts,
      ifsChars,
      ifsPattern,
      expandPart,
    );
    // Perform glob expansion on each split value (skip if noglob is set)
    const expandedValues: string[] = [];
    if (ctx.state.options.noglob) {
      // noglob is set - skip glob expansion entirely
      return { values: splitResult, quoted: false };
    }
    const globExpander = new GlobExpander(
      ctx.fs,
      ctx.state.cwd,
      ctx.state.env,
      {
        globstar: ctx.state.shoptOptions.globstar,
        nullglob: ctx.state.shoptOptions.nullglob,
        failglob: ctx.state.shoptOptions.failglob,
        dotglob: ctx.state.shoptOptions.dotglob,
        extglob: ctx.state.shoptOptions.extglob,
        globskipdots: ctx.state.shoptOptions.globskipdots,
      },
    );
    for (const sv of splitResult) {
      if (hasGlobPattern(sv, ctx.state.shoptOptions.extglob)) {
        const matches = await globExpander.expand(sv);
        if (matches.length > 0) {
          expandedValues.push(...matches);
        } else if (globExpander.hasFailglob()) {
          throw new GlobError(sv);
        } else if (globExpander.hasNullglob()) {
          // nullglob: skip this value
        } else {
          expandedValues.push(sv);
        }
      } else {
        expandedValues.push(sv);
      }
    }
    return { values: expandedValues, quoted: false };
  }

  const value = await expandWordAsync(ctx, word);

  // Check if the word contains any Glob parts
  const hasGlobParts = wordParts.some((p) => p.type === "Glob");

  // For glob expansion, we need to:
  // 1. Escape glob characters in quoted parts so they're treated as literals
  // 2. Keep glob characters from Glob parts
  // This enables patterns like '_tmp/[bc]'*.mm where [bc] is literal and * is a glob
  if (!ctx.state.options.noglob && hasGlobParts) {
    // Use expandWordForGlobbing which properly escapes quoted parts
    const globPattern = await expandWordForGlobbing(ctx, word);

    if (hasGlobPattern(globPattern, ctx.state.shoptOptions.extglob)) {
      const globExpander = new GlobExpander(
        ctx.fs,
        ctx.state.cwd,
        ctx.state.env,
        {
          globstar: ctx.state.shoptOptions.globstar,
          nullglob: ctx.state.shoptOptions.nullglob,
          failglob: ctx.state.shoptOptions.failglob,
          dotglob: ctx.state.shoptOptions.dotglob,
          extglob: ctx.state.shoptOptions.extglob,
          globskipdots: ctx.state.shoptOptions.globskipdots,
        },
      );
      const matches = await globExpander.expand(globPattern);
      if (matches.length > 0) {
        return { values: matches, quoted: false };
      } else if (globExpander.hasFailglob()) {
        throw new GlobError(value);
      } else if (globExpander.hasNullglob()) {
        return { values: [], quoted: false };
      }
      // Glob failed - return the unescaped pattern (not the raw pattern with backslashes)
      // In bash, [\\]_ outputs [\]_ when no match, not [\\]_
      // Also apply IFS splitting since the pattern may contain spaces (e.g., b[2 + 0]=bar -> b[2 + 0]=bar)
      const unescapedValue = unescapeGlobPattern(value);
      if (!isIfsEmpty(ctx.state.env)) {
        const ifsChars = getIfs(ctx.state.env);
        const splitValues = splitByIfsForExpansion(unescapedValue, ifsChars);
        return { values: splitValues, quoted: false };
      }
      return { values: [unescapedValue], quoted: false };
    }
  } else if (
    !hasQuoted &&
    !ctx.state.options.noglob &&
    hasGlobPattern(value, ctx.state.shoptOptions.extglob)
  ) {
    // No Glob parts but value contains glob characters from Literal parts or expansions
    // Use expandWordForGlobbing to properly handle Escaped parts (e.g., \* should not glob)
    const globPattern = await expandWordForGlobbing(ctx, word);

    // Check if there are still glob patterns after escaping
    // (e.g., "two-\*" becomes "two-\\*" which has no unescaped globs)
    if (hasGlobPattern(globPattern, ctx.state.shoptOptions.extglob)) {
      const globExpander = new GlobExpander(
        ctx.fs,
        ctx.state.cwd,
        ctx.state.env,
        {
          globstar: ctx.state.shoptOptions.globstar,
          nullglob: ctx.state.shoptOptions.nullglob,
          failglob: ctx.state.shoptOptions.failglob,
          dotglob: ctx.state.shoptOptions.dotglob,
          extglob: ctx.state.shoptOptions.extglob,
          globskipdots: ctx.state.shoptOptions.globskipdots,
        },
      );
      const matches = await globExpander.expand(globPattern);
      if (matches.length > 0) {
        return { values: matches, quoted: false };
      } else if (globExpander.hasFailglob()) {
        throw new GlobError(value);
      } else if (globExpander.hasNullglob()) {
        return { values: [], quoted: false };
      }
    }
  }

  // Empty unquoted expansion produces no words (e.g., $empty where empty is unset/empty)
  // But quoted empty string produces one empty word (e.g., "" or "$empty")
  if (value === "" && !hasQuoted) {
    return { values: [], quoted: false };
  }

  // If we have Glob parts and didn't expand (noglob or no glob pattern),
  // we still need to unescape backslashes in the value.
  // In bash, [\\]_ with set -f outputs [\]_, not [\\]_
  // Also apply IFS splitting since the pattern may contain spaces
  if (hasGlobParts && !hasQuoted) {
    const unescapedValue = unescapeGlobPattern(value);
    if (!isIfsEmpty(ctx.state.env)) {
      const ifsChars = getIfs(ctx.state.env);
      const splitValues = splitByIfsForExpansion(unescapedValue, ifsChars);
      return { values: splitValues, quoted: false };
    }
    return { values: [unescapedValue], quoted: false };
  }

  return { values: [value], quoted: hasQuoted };
}

/**
 * Check if a DoubleQuoted part contains a word-producing expansion (${arr[@]} or $@).
 * Returns info about the expansion if found, or null if not found.
 */
function findWordProducingExpansion(
  part: WordPart,
):
  | { type: "array"; name: string; atIndex: number; isStar: boolean }
  | { type: "positional"; atIndex: number; isStar: boolean }
  | null {
  if (part.type !== "DoubleQuoted") return null;

  for (let i = 0; i < part.parts.length; i++) {
    const inner = part.parts[i];
    if (inner.type !== "ParameterExpansion") continue;
    if (inner.operation) continue; // Skip if has operation like ${arr[@]#pattern}

    // Check for ${arr[@]} or ${arr[*]}
    const arrayMatch = inner.parameter.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
    );
    if (arrayMatch) {
      return {
        type: "array",
        name: arrayMatch[1],
        atIndex: i,
        isStar: arrayMatch[2] === "*",
      };
    }

    // Check for $@ or $*
    if (inner.parameter === "@" || inner.parameter === "*") {
      return {
        type: "positional",
        atIndex: i,
        isStar: inner.parameter === "*",
      };
    }
  }
  return null;
}

/**
 * Expand a DoubleQuoted part that contains a word-producing expansion.
 * Returns an array of words.
 */
async function expandDoubleQuotedWithWordProducing(
  ctx: InterpreterContext,
  part: WordPart & { type: "DoubleQuoted" },
  info:
    | { type: "array"; name: string; atIndex: number; isStar: boolean }
    | { type: "positional"; atIndex: number; isStar: boolean },
): Promise<string[]> {
  // Expand prefix (parts before the @ expansion)
  let prefix = "";
  for (let i = 0; i < info.atIndex; i++) {
    prefix += await expandPart(ctx, part.parts[i]);
  }

  // Expand suffix (parts after the @ expansion)
  let suffix = "";
  for (let i = info.atIndex + 1; i < part.parts.length; i++) {
    suffix += await expandPart(ctx, part.parts[i]);
  }

  // Get the values from the expansion
  let values: string[];
  if (info.type === "array") {
    const elements = getArrayElements(ctx, info.name);
    values = elements.map(([, v]) => v);
    if (values.length === 0) {
      // Check for scalar (treat as single-element array)
      const scalarValue = ctx.state.env[info.name];
      if (scalarValue !== undefined) {
        values = [scalarValue];
      }
    }
  } else {
    // Positional parameters
    const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
    values = [];
    for (let i = 1; i <= numParams; i++) {
      values.push(ctx.state.env[String(i)] || "");
    }
  }

  // Handle * (join with IFS into single word)
  if (info.isStar) {
    const ifsSep = getIfsSeparator(ctx.state.env);
    const joined = values.join(ifsSep);
    return [prefix + joined + suffix];
  }

  // Handle @ (each value is a separate word)
  if (values.length === 0) {
    // No values - return prefix+suffix if non-empty
    const combined = prefix + suffix;
    return combined ? [combined] : [];
  }

  if (values.length === 1) {
    return [prefix + values[0] + suffix];
  }

  // Multiple values: prefix joins with first, suffix joins with last
  return [
    prefix + values[0],
    ...values.slice(1, -1),
    values[values.length - 1] + suffix,
  ];
}

/**
 * Expand mixed word parts where some parts are word-producing (contain ${arr[@]} or $@).
 * Returns null if this case doesn't apply.
 *
 * This handles cases like: $s1"${array[@]}"_"$@"
 * - $s1 splits by IFS into multiple words
 * - "${array[@]}" expands to multiple words (one per element)
 * - _ is a literal
 * - "$@" expands to multiple words (one per positional param)
 *
 * The joining rule is: last word of one part joins with first word of next part.
 */
async function expandMixedWordParts(
  ctx: InterpreterContext,
  wordParts: WordPart[],
): Promise<string[] | null> {
  // Only applies if we have multiple parts and at least one word-producing part
  if (wordParts.length < 2) return null;

  // Check if any DoubleQuoted parts have word-producing expansions
  let hasWordProducing = false;
  for (const part of wordParts) {
    if (findWordProducingExpansion(part)) {
      hasWordProducing = true;
      break;
    }
  }
  if (!hasWordProducing) return null;

  const ifsChars = getIfs(ctx.state.env);
  const ifsEmpty = isIfsEmpty(ctx.state.env);

  // Expand each part into an array of words
  // Then join adjacent parts by concatenating boundary words
  const partWords: string[][] = [];

  for (const part of wordParts) {
    const wpInfo = findWordProducingExpansion(part);

    if (wpInfo && part.type === "DoubleQuoted") {
      // This part produces multiple words
      const words = await expandDoubleQuotedWithWordProducing(
        ctx,
        part,
        wpInfo,
      );
      partWords.push(words);
    } else if (part.type === "DoubleQuoted" || part.type === "SingleQuoted") {
      // Quoted part - produces single word, no splitting
      const value = await expandPart(ctx, part);
      partWords.push([value]);
    } else if (part.type === "Literal") {
      // Literal - no splitting
      partWords.push([part.value]);
    } else if (part.type === "ParameterExpansion") {
      // Unquoted parameter expansion - subject to IFS splitting
      const value = await expandPart(ctx, part);
      if (ifsEmpty) {
        partWords.push(value ? [value] : []);
      } else {
        const split = splitByIfsForExpansion(value, ifsChars);
        partWords.push(split);
      }
    } else {
      // Other parts (CommandSubstitution, ArithmeticExpansion, etc.)
      const value = await expandPart(ctx, part);
      if (ifsEmpty) {
        partWords.push(value ? [value] : []);
      } else {
        const split = splitByIfsForExpansion(value, ifsChars);
        partWords.push(split);
      }
    }
  }

  // Join the parts by concatenating boundary words
  // Algorithm: for each pair of adjacent parts, join last word of left with first word of right
  const result: string[] = [];

  for (let i = 0; i < partWords.length; i++) {
    const words = partWords[i];
    if (words.length === 0) {
      // Empty part - nothing to add
      continue;
    }

    if (result.length === 0) {
      // First non-empty part
      result.push(...words);
    } else {
      // Join last word of result with first word of this part
      const lastIdx = result.length - 1;
      result[lastIdx] = result[lastIdx] + words[0];

      // Add remaining words from this part
      for (let j = 1; j < words.length; j++) {
        result.push(words[j]);
      }
    }
  }

  return result;
}

/**
 * Get a simple text representation of word parts for error messages.
 * Only extracts parameter names from ParameterExpansion parts.
 */
function getWordText(parts: WordPart[]): string {
  for (const p of parts) {
    if (p.type === "ParameterExpansion") {
      return p.parameter;
    }
    if (p.type === "Literal") {
      return p.value;
    }
  }
  return "";
}

/**
 * Check if a word contains quoted "$@" that would expand to multiple words.
 * This is used to detect "ambiguous redirect" errors.
 */
export function hasQuotedMultiValueAt(
  ctx: InterpreterContext,
  word: WordNode,
): boolean {
  const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
  // Only a problem if there are 2+ positional parameters
  if (numParams < 2) return false;

  // Check for "$@" inside DoubleQuoted parts
  function checkParts(parts: WordPart[]): boolean {
    for (const part of parts) {
      if (part.type === "DoubleQuoted") {
        // Check inside the double-quoted part
        for (const innerPart of part.parts) {
          if (
            innerPart.type === "ParameterExpansion" &&
            innerPart.parameter === "@" &&
            !innerPart.operation // plain $@ without operations
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  return checkParts(word.parts);
}

/**
 * Expand a redirect target with glob handling.
 *
 * For redirects:
 * - If glob matches 0 files with failglob → error (returns { error: ... })
 * - If glob matches 0 files without failglob → use literal pattern
 * - If glob matches 1 file → use that file
 * - If glob matches 2+ files → "ambiguous redirect" error
 *
 * Returns { target: string } on success or { error: string } on failure.
 */
export async function expandRedirectTarget(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<{ target: string } | { error: string }> {
  // Check for "$@" with multiple positional params - this is an ambiguous redirect
  if (hasQuotedMultiValueAt(ctx, word)) {
    return { error: "bash: $@: ambiguous redirect\n" };
  }

  const wordParts = word.parts;
  const { hasQuoted } = analyzeWordParts(wordParts);

  // Check for brace expansion - if it produces multiple values, it's an ambiguous redirect
  // For example: echo hi > a-{one,two} should error
  if (hasBraceExpansion(wordParts)) {
    const braceExpanded = await expandWordWithBracesAsync(ctx, word);
    if (braceExpanded.length > 1) {
      // Get the original word text for the error message
      const originalText = wordParts
        .map((p) => {
          if (p.type === "Literal") return p.value;
          if (p.type === "BraceExpansion") {
            // Reconstruct brace expression
            const items = p.items
              .map((item) => {
                if (item.type === "Range") {
                  const step = item.step ? `..${item.step}` : "";
                  return `${item.startStr ?? item.start}..${item.endStr ?? item.end}${step}`;
                }
                return item.word.parts
                  .map((wp) => (wp.type === "Literal" ? wp.value : ""))
                  .join("");
              })
              .join(",");
            return `{${items}}`;
          }
          return "";
        })
        .join("");
      return { error: `bash: ${originalText}: ambiguous redirect\n` };
    }
    // Single value from brace expansion - continue with normal processing
    // (value will be re-expanded below, but since there's only one value it's the same)
  }

  const value = await expandWordAsync(ctx, word);

  // Check for word splitting producing multiple words - this is an ambiguous redirect
  // This only applies when the word has unquoted expansions (not all quoted)
  const { hasParamExpansion, hasCommandSub } = analyzeWordParts(wordParts);
  const hasUnquotedExpansion =
    (hasParamExpansion || hasCommandSub) && !hasQuoted;

  if (hasUnquotedExpansion && !isIfsEmpty(ctx.state.env)) {
    const ifsChars = getIfs(ctx.state.env);
    const splitWords = splitByIfsForExpansion(value, ifsChars);
    if (splitWords.length > 1) {
      // Word splitting produces multiple words - ambiguous redirect
      return {
        error: `bash: $${getWordText(wordParts)}: ambiguous redirect\n`,
      };
    }
  }

  // Skip glob expansion if noglob is set (set -f) or if the word was quoted
  // Check these BEFORE building glob pattern to avoid double-expanding side-effectful expressions
  if (hasQuoted || ctx.state.options.noglob) {
    return { target: value };
  }

  // Build glob pattern using expandWordForGlobbing which preserves escaped glob chars
  // For example: two-\* becomes two-\\* (escaped * is literal, not a glob)
  // But: two-$star where star='*' becomes two-* (variable expansion is subject to glob)
  const globPattern = await expandWordForGlobbing(ctx, word);

  // Skip if there are no glob patterns in the pattern
  if (!hasGlobPattern(globPattern, ctx.state.shoptOptions.extglob)) {
    return { target: value };
  }

  // Perform glob expansion for redirect targets
  const globExpander = new GlobExpander(ctx.fs, ctx.state.cwd, ctx.state.env, {
    globstar: ctx.state.shoptOptions.globstar,
    nullglob: ctx.state.shoptOptions.nullglob,
    failglob: ctx.state.shoptOptions.failglob,
    dotglob: ctx.state.shoptOptions.dotglob,
    extglob: ctx.state.shoptOptions.extglob,
    globskipdots: ctx.state.shoptOptions.globskipdots,
  });

  const matches = await globExpander.expand(globPattern);

  if (matches.length === 0) {
    // No matches
    if (globExpander.hasFailglob()) {
      // failglob: error on no match
      return { error: `bash: no match: ${value}\n` };
    }
    // Without failglob, use the literal pattern (unescaped)
    return { target: value };
  }

  if (matches.length === 1) {
    // Exactly one match - use it
    return { target: matches[0] };
  }

  // Multiple matches - ambiguous redirect error
  return { error: `bash: ${value}: ambiguous redirect\n` };
}

// Async version of expandWord (internal)
async function expandWordAsync(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const wordParts = word.parts;
  const len = wordParts.length;

  if (len === 1) {
    return expandPart(ctx, wordParts[0]);
  }

  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    parts.push(await expandPart(ctx, wordParts[i]));
  }
  return parts.join("");
}

async function expandPart(
  ctx: InterpreterContext,
  part: WordPart,
  inDoubleQuotes = false,
): Promise<string> {
  // Always use async expansion for ParameterExpansion
  if (part.type === "ParameterExpansion") {
    return expandParameterAsync(ctx, part, inDoubleQuotes);
  }

  // Try simple cases first (Literal, SingleQuoted, Escaped, TildeExpansion, Glob)
  const simple = expandSimplePart(ctx, part, inDoubleQuotes);
  if (simple !== null) return simple;

  // Handle cases that need recursion or async
  switch (part.type) {
    case "DoubleQuoted": {
      const parts: string[] = [];
      for (const p of part.parts) {
        // Inside double quotes, suppress tilde expansion
        parts.push(await expandPart(ctx, p, true));
      }
      return parts.join("");
    }

    case "CommandSubstitution": {
      // Check for the special $(<file) shorthand pattern
      // This is equivalent to $(cat file) but reads the file directly
      const fileReadShorthand = getFileReadShorthand(part.body);
      if (fileReadShorthand) {
        try {
          // Expand the file path (handles $VAR, etc.)
          const filePath = await expandWord(ctx, fileReadShorthand.target);
          // Resolve relative paths
          const resolvedPath = filePath.startsWith("/")
            ? filePath
            : `${ctx.state.cwd}/${filePath}`;
          // Read the file
          const content = await ctx.fs.readFile(resolvedPath);
          ctx.state.lastExitCode = 0;
          ctx.state.env["?"] = "0";
          // Strip trailing newlines (like command substitution does)
          return content.replace(/\n+$/, "");
        } catch {
          // File not found or read error - return empty string, set exit code
          ctx.state.lastExitCode = 1;
          ctx.state.env["?"] = "1";
          return "";
        }
      }

      // Command substitution runs in a subshell-like context
      // ExitError should NOT terminate the main script, just this substitution
      // But ExecutionLimitError MUST propagate to protect against infinite recursion
      // Command substitutions get a new BASHPID (unlike $$ which stays the same)
      const savedBashPid = ctx.state.bashPid;
      ctx.state.bashPid = ctx.state.nextVirtualPid++;
      // Save environment - command substitutions run in a subshell and should not
      // modify parent environment (e.g., aliases defined inside $() should not leak)
      const savedEnv = { ...ctx.state.env };
      const savedCwd = ctx.state.cwd;
      // Suppress verbose mode (set -v) inside command substitutions
      // bash only prints verbose output for the main script
      const savedSuppressVerbose = ctx.state.suppressVerbose;
      ctx.state.suppressVerbose = true;
      try {
        const result = await ctx.executeScript(part.body);
        // Restore environment but preserve exit code
        const exitCode = result.exitCode;
        ctx.state.env = savedEnv;
        ctx.state.cwd = savedCwd;
        ctx.state.suppressVerbose = savedSuppressVerbose;
        // Store the exit code for $?
        ctx.state.lastExitCode = exitCode;
        ctx.state.env["?"] = String(exitCode);
        // Command substitution stderr should go to the shell's stderr at expansion time,
        // NOT be affected by later redirections on the outer command
        if (result.stderr) {
          ctx.state.expansionStderr =
            (ctx.state.expansionStderr || "") + result.stderr;
        }
        ctx.state.bashPid = savedBashPid;
        return result.stdout.replace(/\n+$/, "");
      } catch (error) {
        // Restore environment on error as well
        ctx.state.env = savedEnv;
        ctx.state.cwd = savedCwd;
        ctx.state.bashPid = savedBashPid;
        ctx.state.suppressVerbose = savedSuppressVerbose;
        // ExecutionLimitError must always propagate - these are safety limits
        if (error instanceof ExecutionLimitError) {
          throw error;
        }
        if (error instanceof ExitError) {
          // Catch exit in command substitution - return output so far
          ctx.state.lastExitCode = error.exitCode;
          ctx.state.env["?"] = String(error.exitCode);
          // Also forward stderr from the exit
          if (error.stderr) {
            ctx.state.expansionStderr =
              (ctx.state.expansionStderr || "") + error.stderr;
          }
          return error.stdout.replace(/\n+$/, "");
        }
        throw error;
      }
    }

    case "ArithmeticExpansion": {
      // If original text is available and contains $var patterns (not ${...}),
      // we need to do text substitution before parsing to maintain operator precedence.
      // E.g., $(( $x * 3 )) where x='1 + 2' should expand to $(( 1 + 2 * 3 )) = 7
      // not $(( (1+2) * 3 )) = 9
      const originalText = part.expression.originalText;
      const hasDollarVars =
        originalText && /\$[a-zA-Z_][a-zA-Z0-9_]*(?![{[(])/.test(originalText);
      if (hasDollarVars) {
        // Expand $var patterns in the text
        const expandedText = await expandDollarVarsInArithText(
          ctx,
          originalText,
        );
        // Re-parse the expanded expression
        const parser = new Parser();
        const newExpr = parseArithmeticExpression(parser, expandedText);
        // true = expansion context, single quotes cause error
        return String(await evaluateArithmetic(ctx, newExpr.expression, true));
      }
      // true = expansion context, single quotes cause error
      return String(
        await evaluateArithmetic(ctx, part.expression.expression, true),
      );
    }

    case "BraceExpansion": {
      const results: string[] = [];
      for (const item of part.items) {
        if (item.type === "Range") {
          const range = expandBraceRange(
            item.start,
            item.end,
            item.step,
            item.startStr,
            item.endStr,
          );
          if (range.expanded) {
            results.push(...range.expanded);
          } else {
            return range.literal;
          }
        } else {
          results.push(await expandWord(ctx, item.word));
        }
      }
      return results.join(" ");
    }

    default:
      return "";
  }
}

// Async version of expandParameter for parameter expansions that contain command substitution
async function expandParameterAsync(
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
  inDoubleQuotes = false,
): Promise<string> {
  let { parameter } = part;
  const { operation } = part;

  // Handle subscript expansion for array access: ${a[...]}
  // We need to expand the subscript before calling getVariable
  const bracketMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
  if (bracketMatch) {
    const [, arrayName, subscript] = bracketMatch;
    const isAssoc = ctx.state.associativeArrays?.has(arrayName);

    // For associative arrays, expand the subscript to handle ${array[@]} and other expansions
    // Also expand if subscript contains command substitution or variables
    if (
      isAssoc ||
      subscript.includes("$(") ||
      subscript.includes("`") ||
      subscript.includes("${")
    ) {
      const expandedSubscript = await expandSubscriptForAssocArray(
        ctx,
        subscript,
      );
      parameter = `${arrayName}[${expandedSubscript}]`;
    }
  } else if (
    // Handle nameref pointing to array subscript with command substitution:
    // typeset -n ref='a[$(echo 2) + 1]'; echo $ref
    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(parameter) &&
    isNameref(ctx, parameter)
  ) {
    const target = resolveNameref(ctx, parameter);
    if (target && target !== parameter) {
      // Check if the resolved target is an array subscript with command substitution
      const targetBracketMatch = target.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/,
      );
      if (targetBracketMatch) {
        const [, targetArrayName, targetSubscript] = targetBracketMatch;
        const isAssoc = ctx.state.associativeArrays?.has(targetArrayName);
        if (
          isAssoc ||
          targetSubscript.includes("$(") ||
          targetSubscript.includes("`") ||
          targetSubscript.includes("${")
        ) {
          const expandedSubscript = await expandSubscriptForAssocArray(
            ctx,
            targetSubscript,
          );
          // Replace the nameref's stored target with the expanded one for this expansion
          // We need to call getVariable with the expanded target directly
          parameter = `${targetArrayName}[${expandedSubscript}]`;
        }
      }
    }
  }

  // Operations that handle unset variables should not trigger nounset
  const skipNounset =
    operation &&
    (operation.type === "DefaultValue" ||
      operation.type === "AssignDefault" ||
      operation.type === "UseAlternative" ||
      operation.type === "ErrorIfUnset");

  const value = await getVariable(ctx, parameter, !skipNounset);

  if (!operation) {
    return value;
  }

  const isUnset = !(await isVariableSet(ctx, parameter));
  // Compute isEmpty and effectiveValue using extracted helper
  const { isEmpty, effectiveValue } = computeIsEmpty(
    ctx,
    parameter,
    value,
    inDoubleQuotes,
  );
  const opCtx = {
    value,
    isUnset,
    isEmpty,
    effectiveValue,
    inDoubleQuotes,
  };

  switch (operation.type) {
    case "DefaultValue":
      return handleDefaultValue(ctx, operation, opCtx, expandWordPartsAsync);

    case "AssignDefault":
      return handleAssignDefault(
        ctx,
        parameter,
        operation,
        opCtx,
        expandWordPartsAsync,
      );

    case "ErrorIfUnset":
      return handleErrorIfUnset(
        ctx,
        parameter,
        operation,
        opCtx,
        expandWordPartsAsync,
      );

    case "UseAlternative":
      return handleUseAlternative(ctx, operation, opCtx, expandWordPartsAsync);

    case "PatternRemoval":
      return handlePatternRemoval(
        ctx,
        value,
        operation,
        expandWordPartsAsync,
        expandPart,
      );

    case "PatternReplacement":
      return handlePatternReplacement(
        ctx,
        value,
        operation,
        expandWordPartsAsync,
        expandPart,
      );

    case "Length":
      return handleLength(ctx, parameter, value);

    case "LengthSliceError":
      throw new BadSubstitutionError(parameter);

    case "BadSubstitution":
      throw new BadSubstitutionError(operation.text);

    case "Substring":
      return handleSubstring(ctx, parameter, value, operation);

    case "CaseModification":
      return handleCaseModification(
        ctx,
        value,
        operation,
        expandWordPartsAsync,
        expandParameterAsync,
      );

    case "Transform":
      return handleTransform(ctx, parameter, value, isUnset, operation);

    case "Indirection":
      return handleIndirection(
        ctx,
        parameter,
        value,
        isUnset,
        operation,
        expandParameterAsync,
        inDoubleQuotes,
      );

    case "ArrayKeys":
      return handleArrayKeys(ctx, operation);

    case "VarNamePrefix":
      return handleVarNamePrefix(ctx, operation);

    default:
      return value;
  }
}

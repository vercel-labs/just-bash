/**
 * Word Splitting
 *
 * IFS-based word splitting for unquoted expansions.
 */

import {
  getCurrentExtglob,
  type ParameterExpansionPart,
  type WordPart,
} from "../../ast/types.js";
import { ExecutionLimitError } from "../errors.js";
import { splitByIfsForExpansionEx } from "../helpers/ifs.js";
import type { InterpreterContext } from "../types.js";
import {
  globPatternHasVarRef,
  isOperationWordEntirelyQuoted,
} from "./analysis.js";
import {
  escapeGlobChars,
  hasGlobPattern,
  unescapeGlobPattern,
} from "./glob-escape.js";

export type SplitWord = {
  value: string;
  globPattern: string;
  shouldGlob: boolean;
};

function pushSplitWord(
  ctx: InterpreterContext,
  words: SplitWord[],
  value: string,
  globPattern: string,
  shouldGlob: boolean,
): void {
  if (words.length >= ctx.limits.maxArrayElements) {
    throw new ExecutionLimitError(
      `word splitting element limit exceeded (${ctx.limits.maxArrayElements})`,
      "array_elements",
    );
  }
  words.push({ value, globPattern, shouldGlob });
}

/**
 * Type for the expandPart function that will be injected
 */
export type ExpandPartFn = (
  ctx: InterpreterContext,
  part: WordPart,
) => Promise<string>;

export type PreparedMixedParameter =
  | { type: "value"; value: string }
  | {
      type: "operationWord";
      wordParts: WordPart[];
      assignmentParameter?: string;
    };

export type PrepareMixedParameterFn = (
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
) => Promise<PreparedMixedParameter | null>;

export type AssignPreparedDefaultFn = (
  ctx: InterpreterContext,
  parameter: string,
  value: string,
) => Promise<void>;

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

  // Glob parts are splittable only if they contain variable references
  // e.g., +($ABC) where ABC contains IFS characters should be split
  if (part.type === "Glob") {
    const extglob = getCurrentExtglob(part);
    if (extglob) {
      return extglob.alternatives.some((alternative) =>
        alternative.parts.some(isPartSplittable),
      );
    }
    return globPatternHasVarRef(part.pattern);
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

type SplitSegment = {
  value: string;
  globPattern: string;
  shouldGlob: boolean;
  isSplittable: boolean;
  isQuoted: boolean;
  preparedOperationWord?: Extract<
    PreparedMixedParameter,
    { type: "operationWord" }
  >;
};

async function appendSplitSegments(
  ctx: InterpreterContext,
  parts: WordPart[],
  expandPartFn: ExpandPartFn,
  prepareMixedParameter: PrepareMixedParameterFn,
  segments: SplitSegment[],
): Promise<boolean> {
  let hasSplittablePart = false;

  for (const part of parts) {
    const extglob = part.type === "Glob" ? getCurrentExtglob(part) : undefined;
    if (extglob) {
      segments.push({
        value: `${extglob.operator}(`,
        globPattern: `${extglob.operator}(`,
        shouldGlob: true,
        isSplittable: false,
        isQuoted: false,
      });
      for (let index = 0; index < extglob.alternatives.length; index++) {
        const alternativeHasSplittablePart = await appendSplitSegments(
          ctx,
          extglob.alternatives[index].parts,
          expandPartFn,
          prepareMixedParameter,
          segments,
        );
        hasSplittablePart ||= alternativeHasSplittablePart;
        if (index < extglob.alternatives.length - 1) {
          segments.push({
            value: "|",
            globPattern: "|",
            shouldGlob: true,
            isSplittable: false,
            isQuoted: false,
          });
        }
      }
      segments.push({
        value: ")",
        globPattern: ")",
        shouldGlob: true,
        isSplittable: false,
        isQuoted: false,
      });
      continue;
    }

    const splittable = isPartSplittable(part);
    const isQuoted =
      part.type === "DoubleQuoted" || part.type === "SingleQuoted";
    const prepared =
      part.type === "ParameterExpansion"
        ? await prepareMixedParameter(ctx, part)
        : null;
    const expanded =
      prepared?.type === "value"
        ? prepared.value
        : prepared?.type === "operationWord"
          ? ""
          : await expandPartFn(ctx, part);
    const globPattern =
      part.type === "DoubleQuoted" || part.type === "SingleQuoted"
        ? escapeGlobChars(expanded)
        : part.type === "Escaped" && "*?[]\\()|".includes(part.value)
          ? `\\${part.value}`
          : expanded;
    const shouldGlob =
      part.type !== "DoubleQuoted" &&
      part.type !== "SingleQuoted" &&
      part.type !== "Escaped" &&
      hasGlobPattern(expanded, ctx.state.shoptOptions.extglob);
    segments.push({
      value: part.type === "Glob" ? unescapeGlobPattern(expanded) : expanded,
      globPattern,
      shouldGlob,
      isSplittable: splittable,
      isQuoted,
      preparedOperationWord:
        prepared?.type === "operationWord" ? prepared : undefined,
    });
    hasSplittablePart ||= splittable;
  }

  return hasSplittablePart;
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
  prepareMixedParameter: PrepareMixedParameterFn,
  assignPreparedDefault: AssignPreparedDefaultFn,
): Promise<SplitWord[]> {
  ctx.coverage?.hit("bash:expansion:word_split");
  const preparedMixedParameters = new Map<
    ParameterExpansionPart,
    Promise<PreparedMixedParameter | null>
  >();
  const prepare: PrepareMixedParameterFn = (_ctx, part) => {
    let prepared = preparedMixedParameters.get(part);
    if (!prepared) {
      prepared = prepareMixedParameter(ctx, part);
      preparedMixedParameters.set(part, prepared);
    }
    return prepared;
  };

  // Check for special case: ParameterExpansion with a default value that should be used
  // In this case, we need to recursively word-split the default value's parts
  // to preserve quote boundaries within the default value.
  if (wordParts.length === 1 && wordParts[0].type === "ParameterExpansion") {
    const paramPart = wordParts[0];
    const prepared = await prepare(ctx, paramPart);
    if (prepared?.type === "operationWord") {
      // Recursively word-split the default value's parts. Literal parts from
      // the default value are splittable because they are unquoted here.
      const split = await smartWordSplitWithUnquotedLiterals(
        ctx,
        prepared.wordParts,
        ifsChars,
        _ifsPattern,
        expandPartFn,
      );
      if (prepared.assignmentParameter) {
        await assignPreparedDefault(
          ctx,
          prepared.assignmentParameter,
          split.value,
        );
      }
      return split.words;
    }
  }

  // Preserve quote boundaries inside structured extglob alternatives.
  const segments: SplitSegment[] = [];
  const hasAnySplittable = await appendSplitSegments(
    ctx,
    wordParts,
    expandPartFn,
    prepare,
    segments,
  );

  if (
    wordParts.some((part) => part.type === "Glob" && getCurrentExtglob(part))
  ) {
    let length = 0;
    for (const segment of segments) {
      if (segment.value.length > ctx.limits.maxStringLength - length) {
        throw new ExecutionLimitError(
          `word expansion: string length limit exceeded (${ctx.limits.maxStringLength} bytes)`,
          "string_length",
        );
      }
      length += segment.value.length;
    }
  }

  // If there's no splittable expansion, return the joined value as-is
  // (pure literals are not subject to IFS splitting)
  if (!hasAnySplittable) {
    const value = segments.map((segment) => segment.value).join("");
    if (!value) return [];
    return [
      {
        value,
        globPattern: segments.map((segment) => segment.globPattern).join(""),
        shouldGlob: segments.some((segment) => segment.shouldGlob),
      },
    ];
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

  const words: SplitWord[] = [];
  let currentWord = "";
  let currentGlobPattern = "";
  let currentShouldGlob = false;
  // Track if we've produced any actual words (including empty ones from splits)
  let hasProducedWord = false;
  // Track if the previous splittable segment ended with a trailing IFS delimiter
  // If true, the next non-splittable content should start a new word
  let pendingWordBreak = false;
  // Track if the previous segment was a quoted empty string (can anchor empty words)
  let prevWasQuotedEmpty = false;

  for (const segment of segments) {
    if (!segment.isSplittable) {
      // Non-splittable: append to current word (no splitting)
      // BUT if we have a pending word break from a previous trailing delimiter,
      // push the current word first and start a new one.
      //
      // Special case: if this is a quoted empty segment and we have a pending word break,
      // we should produce an empty word (the quoted empty "anchors" an empty word).
      if (pendingWordBreak) {
        if (segment.isQuoted && segment.value === "") {
          // Quoted empty after trailing IFS delimiter: push current word and an empty word
          if (currentWord !== "") {
            pushSplitWord(
              ctx,
              words,
              currentWord,
              currentGlobPattern,
              currentShouldGlob,
            );
          }
          // The quoted empty anchors an empty word
          pushSplitWord(ctx, words, "", "", false);
          hasProducedWord = true;
          currentWord = "";
          currentGlobPattern = "";
          currentShouldGlob = false;
          pendingWordBreak = false;
          prevWasQuotedEmpty = true;
        } else if (segment.value !== "") {
          // Non-empty content: push current word (if any) and start new word
          if (currentWord !== "") {
            pushSplitWord(
              ctx,
              words,
              currentWord,
              currentGlobPattern,
              currentShouldGlob,
            );
          }
          currentWord = segment.value;
          currentGlobPattern = segment.globPattern;
          currentShouldGlob = segment.shouldGlob;
          pendingWordBreak = false;
          prevWasQuotedEmpty = false;
        } else {
          // Empty non-quoted segment with pending break: just append (noop)
          currentWord += segment.value;
          currentGlobPattern += segment.globPattern;
          currentShouldGlob ||= segment.shouldGlob;
          prevWasQuotedEmpty = false;
        }
      } else {
        currentWord += segment.value;
        currentGlobPattern += segment.globPattern;
        currentShouldGlob ||= segment.shouldGlob;
        prevWasQuotedEmpty = segment.isQuoted && segment.value === "";
      }
    } else if (segment.preparedOperationWord) {
      // Special case: ParameterExpansion with mixed quoted/unquoted default value
      // We need to recursively word-split the default value's parts to preserve
      // quote boundaries. This handles cases like: 1${undefined:-"2_3"x_x"4_5"}6
      // where the quoted parts "2_3" and "4_5" should NOT be split by IFS.
      const split = await smartWordSplitWithUnquotedLiterals(
        ctx,
        segment.preparedOperationWord.wordParts,
        ifsChars,
        _ifsPattern,
        expandPartFn,
      );
      if (segment.preparedOperationWord.assignmentParameter) {
        await assignPreparedDefault(
          ctx,
          segment.preparedOperationWord.assignmentParameter,
          split.value,
        );
      }
      const flushedLeadingDelimiter =
        split.hadLeadingDelimiter && currentWord !== "";
      if (flushedLeadingDelimiter) {
        pushSplitWord(
          ctx,
          words,
          currentWord,
          currentGlobPattern,
          currentShouldGlob,
        );
        currentWord = "";
        currentGlobPattern = "";
        currentShouldGlob = false;
        hasProducedWord = true;
      }
      const splitParts =
        flushedLeadingDelimiter && split.words[0]?.value === ""
          ? split.words.slice(1)
          : split.words;

      if (splitParts.length === 0) {
        // Empty expansion produces nothing
      } else if (splitParts.length === 1) {
        currentWord += splitParts[0].value;
        currentGlobPattern += splitParts[0].globPattern;
        currentShouldGlob ||= splitParts[0].shouldGlob;
        hasProducedWord = true;
      } else {
        // Multiple results: first joins with current, middle are separate, last starts new
        currentWord += splitParts[0].value;
        currentGlobPattern += splitParts[0].globPattern;
        currentShouldGlob ||= splitParts[0].shouldGlob;
        pushSplitWord(
          ctx,
          words,
          currentWord,
          currentGlobPattern,
          currentShouldGlob,
        );
        hasProducedWord = true;

        for (let i = 1; i < splitParts.length - 1; i++) {
          pushSplitWord(
            ctx,
            words,
            splitParts[i].value,
            splitParts[i].globPattern,
            splitParts[i].shouldGlob,
          );
        }

        currentWord = splitParts[splitParts.length - 1].value;
        currentGlobPattern = splitParts[splitParts.length - 1].globPattern;
        currentShouldGlob = splitParts[splitParts.length - 1].shouldGlob;
      }
      pendingWordBreak = split.hadTrailingDelimiter;
      prevWasQuotedEmpty = false;
    } else {
      // Splittable: split by IFS using extended version that tracks trailing delimiters
      if (pendingWordBreak && currentWord !== "") {
        pushSplitWord(
          ctx,
          words,
          currentWord,
          currentGlobPattern,
          currentShouldGlob,
        );
        currentWord = "";
        currentGlobPattern = "";
        currentShouldGlob = false;
        pendingWordBreak = false;
        hasProducedWord = true;
      }
      const {
        words: parts,
        hadLeadingDelimiter,
        hadTrailingDelimiter,
      } = splitByIfsForExpansionEx(
        segment.value,
        ifsChars,
        ctx.limits.maxArrayElements,
      );

      const flushedLeadingDelimiter = hadLeadingDelimiter && currentWord !== "";
      if (flushedLeadingDelimiter) {
        pushSplitWord(
          ctx,
          words,
          currentWord,
          currentGlobPattern,
          currentShouldGlob,
        );
        currentWord = "";
        currentGlobPattern = "";
        currentShouldGlob = false;
        hasProducedWord = true;
      }

      const splitParts =
        flushedLeadingDelimiter && parts[0] === "" ? parts.slice(1) : parts;

      // If the previous segment was a quoted empty and this splittable segment
      // has leading IFS delimiter, the quoted empty should anchor an empty word
      if (
        prevWasQuotedEmpty &&
        hadLeadingDelimiter &&
        !flushedLeadingDelimiter &&
        currentWord === ""
      ) {
        pushSplitWord(ctx, words, "", "", false);
        hasProducedWord = true;
      }

      if (splitParts.length === 0) {
        // Empty expansion produces nothing - continue building current word
        // This happens for empty string or all-whitespace with default IFS
        // BUT if there was a trailing delimiter (e.g., "   "), mark pending word break
        if (hadTrailingDelimiter) {
          pendingWordBreak = true;
        }
      } else if (splitParts.length === 1) {
        // Single result: just append to current word
        // Note: parts[0] might be empty string (e.g., IFS='_' and var='_' produces [""])
        currentWord += splitParts[0];
        currentGlobPattern += splitParts[0];
        currentShouldGlob ||= segment.shouldGlob;
        hasProducedWord = true;
        // If there was a trailing delimiter, mark pending word break for next segment
        pendingWordBreak = hadTrailingDelimiter;
      } else {
        // Multiple results from split:
        // - First part joins with current word
        // - Middle parts become separate words
        // - Last part starts the new current word
        currentWord += splitParts[0];
        currentGlobPattern += splitParts[0];
        currentShouldGlob ||= segment.shouldGlob;
        pushSplitWord(
          ctx,
          words,
          currentWord,
          currentGlobPattern,
          currentShouldGlob,
        );
        hasProducedWord = true;

        // Add middle parts as separate words
        for (let i = 1; i < splitParts.length - 1; i++) {
          pushSplitWord(
            ctx,
            words,
            splitParts[i],
            splitParts[i],
            segment.shouldGlob,
          );
        }

        // Last part becomes the new current word
        currentWord = splitParts[splitParts.length - 1];
        currentGlobPattern = splitParts[splitParts.length - 1];
        currentShouldGlob = segment.shouldGlob;
        // If there was a trailing delimiter, mark pending word break for next segment
        pendingWordBreak = hadTrailingDelimiter;
      }
      prevWasQuotedEmpty = false;
    }
  }

  // Add the remaining current word
  // We add it if:
  // - currentWord is non-empty, OR
  // - we haven't produced any words yet but we've had a split that produced content
  //   (this handles the case of IFS='_' and var='_' -> [""])
  if (currentWord !== "") {
    pushSplitWord(
      ctx,
      words,
      currentWord,
      currentGlobPattern,
      currentShouldGlob,
    );
  } else if (words.length === 0 && hasProducedWord) {
    // The only content was from a split that produced [""] (empty string)
    pushSplitWord(ctx, words, "", "", false);
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
): Promise<{
  words: SplitWord[];
  value: string;
  hadLeadingDelimiter: boolean;
  hadTrailingDelimiter: boolean;
}> {
  // Expand all parts and track if they are splittable
  // In this context, Literal parts ARE splittable
  type Segment = {
    value: string;
    globPattern: string;
    shouldGlob: boolean;
    isSplittable: boolean;
  };
  const segments: Segment[] = [];

  for (const part of wordParts) {
    // Quoted parts are not splittable
    const isQuoted =
      part.type === "DoubleQuoted" || part.type === "SingleQuoted";
    // In the context of a default value, everything non-quoted is splittable
    const splittable = !isQuoted;
    const expanded = await expandPartFn(ctx, part);
    segments.push({
      value: part.type === "Glob" ? unescapeGlobPattern(expanded) : expanded,
      globPattern:
        part.type === "DoubleQuoted" || part.type === "SingleQuoted"
          ? escapeGlobChars(expanded)
          : part.type === "Escaped" && "*?[]\\()|".includes(part.value)
            ? `\\${part.value}`
            : expanded,
      shouldGlob:
        part.type !== "DoubleQuoted" &&
        part.type !== "SingleQuoted" &&
        part.type !== "Escaped" &&
        hasGlobPattern(expanded, ctx.state.shoptOptions.extglob),
      isSplittable: splittable,
    });
  }

  // Word splitting algorithm
  // Key difference from standard smartWordSplit:
  // When a splittable segment starts with an IFS character, it causes a word break
  // from the previous content, even if the split produces only one word.
  const words: SplitWord[] = [];
  let currentWord = "";
  let currentGlobPattern = "";
  let currentShouldGlob = false;
  let hasProducedWord = false;
  let pendingWordBreak = false;
  let hadLeadingDelimiter = false;

  for (const segment of segments) {
    if (!segment.isSplittable) {
      // Non-splittable (quoted): append to current word
      // BUT if we have a pending word break, push current word first
      // However, don't push an empty current word - that happens when we have
      // whitespace between two quoted parts, which should just separate them
      // without creating an empty word in between
      if (pendingWordBreak && segment.value !== "") {
        if (currentWord !== "") {
          pushSplitWord(
            ctx,
            words,
            currentWord,
            currentGlobPattern,
            currentShouldGlob,
          );
        }
        currentWord = segment.value;
        currentGlobPattern = segment.globPattern;
        currentShouldGlob = segment.shouldGlob;
        pendingWordBreak = false;
      } else {
        currentWord += segment.value;
        currentGlobPattern += segment.globPattern;
        currentShouldGlob ||= segment.shouldGlob;
      }
    } else {
      // Splittable: check if it starts with IFS (causes word break)
      const startsWithIfsChar = startsWithIfs(segment.value, ifsChars);

      if (pendingWordBreak && currentWord !== "") {
        pushSplitWord(
          ctx,
          words,
          currentWord,
          currentGlobPattern,
          currentShouldGlob,
        );
        currentWord = "";
        currentGlobPattern = "";
        currentShouldGlob = false;
        pendingWordBreak = false;
        hasProducedWord = true;
      }

      // If the segment starts with IFS and we have accumulated content,
      // finish the current word first
      const flushedLeadingDelimiter = startsWithIfsChar && currentWord !== "";
      if (flushedLeadingDelimiter) {
        pushSplitWord(
          ctx,
          words,
          currentWord,
          currentGlobPattern,
          currentShouldGlob,
        );
        currentWord = "";
        currentGlobPattern = "";
        currentShouldGlob = false;
        hasProducedWord = true;
      }

      // Split by IFS using extended version
      const {
        words: parts,
        hadLeadingDelimiter: segmentHadLeadingDelimiter,
        hadTrailingDelimiter,
      } = splitByIfsForExpansionEx(
        segment.value,
        ifsChars,
        ctx.limits.maxArrayElements,
      );

      if (
        words.length === 0 &&
        currentWord === "" &&
        segmentHadLeadingDelimiter
      ) {
        hadLeadingDelimiter = true;
      }

      const splitParts =
        flushedLeadingDelimiter && parts[0] === "" ? parts.slice(1) : parts;

      if (splitParts.length === 0) {
        // Empty expansion produces nothing
        if (hadTrailingDelimiter) {
          pendingWordBreak = true;
        }
      } else if (splitParts.length === 1) {
        currentWord += splitParts[0];
        currentGlobPattern += splitParts[0];
        currentShouldGlob ||= segment.shouldGlob;
        hasProducedWord = true;
        pendingWordBreak = hadTrailingDelimiter;
      } else {
        // Multiple results from split
        currentWord += splitParts[0];
        currentGlobPattern += splitParts[0];
        currentShouldGlob ||= segment.shouldGlob;
        pushSplitWord(
          ctx,
          words,
          currentWord,
          currentGlobPattern,
          currentShouldGlob,
        );
        hasProducedWord = true;

        for (let i = 1; i < splitParts.length - 1; i++) {
          pushSplitWord(
            ctx,
            words,
            splitParts[i],
            splitParts[i],
            segment.shouldGlob,
          );
        }

        currentWord = splitParts[splitParts.length - 1];
        currentGlobPattern = splitParts[splitParts.length - 1];
        currentShouldGlob = segment.shouldGlob;
        pendingWordBreak = hadTrailingDelimiter;
      }
    }
  }

  if (currentWord !== "") {
    pushSplitWord(
      ctx,
      words,
      currentWord,
      currentGlobPattern,
      currentShouldGlob,
    );
  } else if (words.length === 0 && hasProducedWord) {
    pushSplitWord(ctx, words, "", "", false);
  }

  return {
    words,
    value: segments.map((segment) => segment.value).join(""),
    hadLeadingDelimiter,
    hadTrailingDelimiter: pendingWordBreak,
  };
}

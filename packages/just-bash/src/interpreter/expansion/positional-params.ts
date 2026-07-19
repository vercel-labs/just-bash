/**
 * Positional Parameter Expansion Handlers
 *
 * Handles $@ and $* expansion with various operations:
 * - "${@:offset}" and "${*:offset}" - slicing
 * - "${@/pattern/replacement}" - pattern replacement
 * - "${@#pattern}" - pattern removal (strip)
 * - "$@" and "$*" with adjacent text
 */

import type {
  ParameterExpansionPart,
  SubstringOp,
  WordNode,
  WordPart,
} from "../../ast/types.js";
import { utf8ByteLength } from "../../commands/printf/escapes.js";
import { createUserRegex } from "../../regex/index.js";
import { ExecutionLimitError } from "../errors.js";
import { getIfsSeparator } from "../helpers/ifs.js";
import { escapeRegex } from "../helpers/regex.js";
import type { InterpreterContext } from "../types.js";
import { patternToRegex } from "./pattern.js";
import { applyPatternRemoval } from "./pattern-removal.js";

/**
 * Result type for positional parameter expansion handlers.
 * `null` means the handler doesn't apply to this case.
 */
export type PositionalExpansionResult = {
  values: string[];
  quoted: boolean;
} | null;

import type { ArithExpr } from "../../ast/types.js";

/**
 * Type for evaluateArithmetic function
 */
export type EvaluateArithmeticFn = (
  ctx: InterpreterContext,
  expr: ArithExpr,
  isExpansionContext?: boolean,
) => Promise<number>;

/**
 * Type for expandPart function
 */
export type ExpandPartFn = (
  ctx: InterpreterContext,
  part: WordPart,
) => Promise<string>;

/**
 * Type for expandWordPartsAsync function
 */
export type ExpandWordPartsAsyncFn = (
  ctx: InterpreterContext,
  parts: WordPart[],
) => Promise<string>;

/**
 * Get positional parameters from context
 */
function getPositionalParams(ctx: InterpreterContext): string[] {
  const numParams = Number.parseInt(ctx.state.env.get("#") || "0", 10);
  if (numParams > ctx.limits.maxArrayElements) {
    throw new ExecutionLimitError(
      `positional parameter element limit exceeded (${ctx.limits.maxArrayElements})`,
      "array_elements",
    );
  }
  const params: string[] = [];
  let bytes = 0;
  for (let i = 1; i <= numParams; i++) {
    const value = ctx.state.env.get(String(i)) || "";
    const valueBytes = utf8ByteLength(value);
    if (valueBytes > ctx.limits.maxStringLength - bytes) {
      throw new ExecutionLimitError(
        `positional parameter string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    }
    params.push(value);
    bytes += valueBytes;
  }
  return params;
}

function appendBounded(
  current: string,
  fragment: string,
  maxBytes: number,
): string {
  if (utf8ByteLength(fragment) > maxBytes - utf8ByteLength(current)) {
    throw new ExecutionLimitError(
      `positional expansion string limit exceeded (${maxBytes} bytes)`,
      "string_length",
    );
  }
  return current + fragment;
}

function pushBounded(
  values: string[],
  value: string,
  usedBytes: { value: number },
  ctx: InterpreterContext,
): void {
  if (values.length >= ctx.limits.maxArrayElements) {
    throw new ExecutionLimitError(
      `positional expansion element limit exceeded (${ctx.limits.maxArrayElements})`,
      "array_elements",
    );
  }
  const bytes = utf8ByteLength(value);
  if (bytes > ctx.limits.maxStringLength - usedBytes.value) {
    throw new ExecutionLimitError(
      `positional expansion string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
      "string_length",
    );
  }
  values.push(value);
  usedBytes.value += bytes;
}

/**
 * Handle "${@:offset}" and "${*:offset}" with Substring operations inside double quotes
 * "${@:offset}": Each sliced positional parameter becomes a separate word
 * "${*:offset}": All sliced params joined with IFS as ONE word
 */
export async function handlePositionalSlicing(
  ctx: InterpreterContext,
  wordParts: WordPart[],
  evaluateArithmetic: EvaluateArithmeticFn,
  expandPart: ExpandPartFn,
): Promise<PositionalExpansionResult> {
  if (wordParts.length !== 1 || wordParts[0].type !== "DoubleQuoted") {
    return null;
  }

  const dqPart = wordParts[0];
  // Find if there's a ${@:offset} or ${*:offset} inside
  let sliceAtIndex = -1;
  let sliceIsStar = false;
  for (let i = 0; i < dqPart.parts.length; i++) {
    const p = dqPart.parts[i];
    if (
      p.type === "ParameterExpansion" &&
      (p.parameter === "@" || p.parameter === "*") &&
      p.operation?.type === "Substring"
    ) {
      sliceAtIndex = i;
      sliceIsStar = p.parameter === "*";
      break;
    }
  }

  if (sliceAtIndex === -1) {
    return null;
  }

  const paramPart = dqPart.parts[sliceAtIndex] as ParameterExpansionPart;
  const operation = paramPart.operation as SubstringOp;

  // Evaluate offset and length
  const offset = operation.offset
    ? await evaluateArithmetic(ctx, operation.offset.expression)
    : 0;
  const length = operation.length
    ? await evaluateArithmetic(ctx, operation.length.expression)
    : undefined;

  // Get positional parameters
  const numParams = Number.parseInt(ctx.state.env.get("#") || "0", 10);
  const allParams: string[] = [];
  for (let i = 1; i <= numParams; i++) {
    allParams.push(ctx.state.env.get(String(i)) || "");
  }

  const shellName = ctx.state.env.get("0") || "bash";

  // Build sliced params array
  let slicedParams: string[];
  if (offset <= 0) {
    // offset 0: include $0 at position 0
    const withZero = [shellName, ...allParams];
    const computedIdx = withZero.length + offset;
    // If negative offset goes beyond array bounds, return empty
    if (computedIdx < 0) {
      slicedParams = [];
    } else {
      const startIdx = offset < 0 ? computedIdx : 0;
      if (length !== undefined) {
        const endIdx =
          length < 0 ? withZero.length + length : startIdx + length;
        slicedParams = withZero.slice(startIdx, Math.max(startIdx, endIdx));
      } else {
        slicedParams = withZero.slice(startIdx);
      }
    }
  } else {
    // offset > 0: start from $<offset>
    const startIdx = offset - 1;
    if (startIdx >= allParams.length) {
      slicedParams = [];
    } else if (length !== undefined) {
      const endIdx = length < 0 ? allParams.length + length : startIdx + length;
      slicedParams = allParams.slice(startIdx, Math.max(startIdx, endIdx));
    } else {
      slicedParams = allParams.slice(startIdx);
    }
  }

  // Expand prefix (parts before ${@:...})
  let prefix = "";
  for (let i = 0; i < sliceAtIndex; i++) {
    prefix += await expandPart(ctx, dqPart.parts[i]);
  }

  // Expand suffix (parts after ${@:...})
  let suffix = "";
  for (let i = sliceAtIndex + 1; i < dqPart.parts.length; i++) {
    suffix += await expandPart(ctx, dqPart.parts[i]);
  }

  if (slicedParams.length === 0) {
    // No params after slicing -> prefix + suffix as one word
    const combined = prefix + suffix;
    return { values: combined ? [combined] : [], quoted: true };
  }

  if (sliceIsStar) {
    // "${*:offset}" - join all sliced params with IFS into one word
    const ifsSep = getIfsSeparator(ctx.state.env);
    return {
      values: [prefix + slicedParams.join(ifsSep) + suffix],
      quoted: true,
    };
  }

  // "${@:offset}" - each sliced param is a separate word
  if (slicedParams.length === 1) {
    return {
      values: [prefix + slicedParams[0] + suffix],
      quoted: true,
    };
  }

  const result = [
    prefix + slicedParams[0],
    ...slicedParams.slice(1, -1),
    slicedParams[slicedParams.length - 1] + suffix,
  ];
  return { values: result, quoted: true };
}

/**
 * Handle "${@/pattern/replacement}" and "${* /pattern/replacement}" with PatternReplacement inside double quotes
 * "${@/pattern/replacement}": Each positional parameter has pattern replaced, each becomes a separate word
 * "${* /pattern/replacement}": All params joined with IFS, pattern replaced, becomes ONE word
 */
export async function handlePositionalPatternReplacement(
  ctx: InterpreterContext,
  wordParts: WordPart[],
  expandPart: ExpandPartFn,
  expandWordPartsAsync: ExpandWordPartsAsyncFn,
): Promise<PositionalExpansionResult> {
  if (wordParts.length !== 1 || wordParts[0].type !== "DoubleQuoted") {
    return null;
  }

  const dqPart = wordParts[0];
  // Find if there's a ${@/...} or ${*/...} inside
  let patReplAtIndex = -1;
  let patReplIsStar = false;
  for (let i = 0; i < dqPart.parts.length; i++) {
    const p = dqPart.parts[i];
    if (
      p.type === "ParameterExpansion" &&
      (p.parameter === "@" || p.parameter === "*") &&
      p.operation?.type === "PatternReplacement"
    ) {
      patReplAtIndex = i;
      patReplIsStar = p.parameter === "*";
      break;
    }
  }

  if (patReplAtIndex === -1) {
    return null;
  }

  const paramPart = dqPart.parts[patReplAtIndex] as ParameterExpansionPart;
  const operation = paramPart.operation as {
    type: "PatternReplacement";
    pattern: WordNode;
    replacement: WordNode | null;
    all: boolean;
    anchor: "start" | "end" | null;
  };

  // Get positional parameters
  const params = getPositionalParams(ctx);

  // Expand prefix (parts before ${@/...})
  let prefix = "";
  for (let i = 0; i < patReplAtIndex; i++) {
    prefix = appendBounded(
      prefix,
      await expandPart(ctx, dqPart.parts[i]),
      ctx.limits.maxStringLength,
    );
  }

  // Expand suffix (parts after ${@/...})
  let suffix = "";
  for (let i = patReplAtIndex + 1; i < dqPart.parts.length; i++) {
    suffix = appendBounded(
      suffix,
      await expandPart(ctx, dqPart.parts[i]),
      ctx.limits.maxStringLength,
    );
  }

  if (params.length === 0) {
    const combined = prefix + suffix;
    return { values: combined ? [combined] : [], quoted: true };
  }

  // Build the replacement regex
  let regex = "";
  if (operation.pattern) {
    for (const part of operation.pattern.parts) {
      if (part.type === "Glob") {
        regex += patternToRegex(
          part.pattern,
          true,
          ctx.state.shoptOptions.extglob,
        );
      } else if (part.type === "Literal") {
        regex += patternToRegex(
          part.value,
          true,
          ctx.state.shoptOptions.extglob,
        );
      } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
        regex += escapeRegex(part.value);
      } else if (part.type === "DoubleQuoted") {
        const expanded = await expandWordPartsAsync(ctx, part.parts);
        regex += escapeRegex(expanded);
      } else if (part.type === "ParameterExpansion") {
        const expanded = await expandPart(ctx, part);
        regex += patternToRegex(expanded, true, ctx.state.shoptOptions.extglob);
      } else {
        const expanded = await expandPart(ctx, part);
        regex += escapeRegex(expanded);
      }
    }
  }

  const replacement = operation.replacement
    ? await expandWordPartsAsync(ctx, operation.replacement.parts)
    : "";

  // Apply anchor modifiers
  let regexPattern = regex;
  if (operation.anchor === "start") {
    regexPattern = `^${regex}`;
  } else if (operation.anchor === "end") {
    regexPattern = `${regex}$`;
  }

  // Apply replacement to each param
  const replacedParams: string[] = [];
  const replacedBytes = { value: 0 };
  try {
    const re = createUserRegex(regexPattern, operation.all ? "g" : "");
    for (const param of params) {
      // Count matches first and reject a conservative upper bound before the
      // regex engine constructs an amplified replacement string.
      let matchCount = 0;
      re.lastIndex = 0;
      for (let match = re.exec(param); match; match = re.exec(param)) {
        matchCount++;
        if (!operation.all) break;
        if (match[0].length === 0) re.lastIndex++;
      }
      const paramBytes = utf8ByteLength(param);
      const replacementBytes = utf8ByteLength(replacement);
      let referenceCount = 0;
      const referencePattern = /\$(?:\$|&|\d+|<[^>]+>|`|')/g;
      while (referencePattern.exec(replacement) !== null) referenceCount++;
      const upperBound =
        paramBytes +
        matchCount * replacementBytes +
        matchCount * referenceCount * paramBytes;
      if (upperBound > ctx.limits.maxStringLength - replacedBytes.value) {
        throw new ExecutionLimitError(
          `positional expansion string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
          "string_length",
        );
      }
      pushBounded(
        replacedParams,
        re.replace(param, replacement),
        replacedBytes,
        ctx,
      );
    }
  } catch (error) {
    if (error instanceof ExecutionLimitError) throw error;
    // Invalid regex - return params unchanged
    for (const param of params) {
      pushBounded(replacedParams, param, replacedBytes, ctx);
    }
  }

  if (patReplIsStar) {
    // "${*/...}" - join all params with IFS into one word
    const ifsSep = getIfsSeparator(ctx.state.env);
    const joinBytes =
      replacedBytes.value +
      Math.max(0, replacedParams.length - 1) * utf8ByteLength(ifsSep) +
      utf8ByteLength(prefix) +
      utf8ByteLength(suffix);
    if (joinBytes > ctx.limits.maxStringLength) {
      throw new ExecutionLimitError(
        `positional expansion string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    }
    return {
      values: [prefix + replacedParams.join(ifsSep) + suffix],
      quoted: true,
    };
  }

  // "${@/...}" - each param is a separate word
  if (
    utf8ByteLength(prefix) + replacedBytes.value + utf8ByteLength(suffix) >
    ctx.limits.maxStringLength
  ) {
    throw new ExecutionLimitError(
      `positional expansion string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
      "string_length",
    );
  }
  if (replacedParams.length === 1) {
    return {
      values: [prefix + replacedParams[0] + suffix],
      quoted: true,
    };
  }

  const result = [
    prefix + replacedParams[0],
    ...replacedParams.slice(1, -1),
    replacedParams[replacedParams.length - 1] + suffix,
  ];
  return { values: result, quoted: true };
}

/**
 * Handle "${@#pattern}" and "${*#pattern}" - positional parameter pattern removal (strip)
 * "${@#pattern}": Remove shortest matching prefix from each parameter, each becomes a separate word
 * "${@##pattern}": Remove longest matching prefix from each parameter
 * "${@%pattern}": Remove shortest matching suffix from each parameter
 * "${@%%pattern}": Remove longest matching suffix from each parameter
 */
export async function handlePositionalPatternRemoval(
  ctx: InterpreterContext,
  wordParts: WordPart[],
  expandPart: ExpandPartFn,
  expandWordPartsAsync: ExpandWordPartsAsyncFn,
): Promise<PositionalExpansionResult> {
  if (wordParts.length !== 1 || wordParts[0].type !== "DoubleQuoted") {
    return null;
  }

  const dqPart = wordParts[0];
  // Find if there's a ${@#...} or ${*#...} inside
  let patRemAtIndex = -1;
  let patRemIsStar = false;
  for (let i = 0; i < dqPart.parts.length; i++) {
    const p = dqPart.parts[i];
    if (
      p.type === "ParameterExpansion" &&
      (p.parameter === "@" || p.parameter === "*") &&
      p.operation?.type === "PatternRemoval"
    ) {
      patRemAtIndex = i;
      patRemIsStar = p.parameter === "*";
      break;
    }
  }

  if (patRemAtIndex === -1) {
    return null;
  }

  const paramPart = dqPart.parts[patRemAtIndex] as ParameterExpansionPart;
  const operation = paramPart.operation as {
    type: "PatternRemoval";
    pattern: WordNode;
    side: "prefix" | "suffix";
    greedy: boolean;
  };

  // Get positional parameters
  const params = getPositionalParams(ctx);

  // Expand prefix (parts before ${@#...})
  let prefix = "";
  for (let i = 0; i < patRemAtIndex; i++) {
    prefix = appendBounded(
      prefix,
      await expandPart(ctx, dqPart.parts[i]),
      ctx.limits.maxStringLength,
    );
  }

  // Expand suffix (parts after ${@#...})
  let suffix = "";
  for (let i = patRemAtIndex + 1; i < dqPart.parts.length; i++) {
    suffix = appendBounded(
      suffix,
      await expandPart(ctx, dqPart.parts[i]),
      ctx.limits.maxStringLength,
    );
  }

  if (params.length === 0) {
    const combined = prefix + suffix;
    return { values: combined ? [combined] : [], quoted: true };
  }

  // Build the regex pattern
  let regexStr = "";
  const extglob = ctx.state.shoptOptions.extglob;
  if (operation.pattern) {
    for (const part of operation.pattern.parts) {
      if (part.type === "Glob") {
        regexStr += patternToRegex(part.pattern, operation.greedy, extglob);
      } else if (part.type === "Literal") {
        regexStr += patternToRegex(part.value, operation.greedy, extglob);
      } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
        regexStr += escapeRegex(part.value);
      } else if (part.type === "DoubleQuoted") {
        const expanded = await expandWordPartsAsync(ctx, part.parts);
        regexStr += escapeRegex(expanded);
      } else if (part.type === "ParameterExpansion") {
        const expanded = await expandPart(ctx, part);
        regexStr += patternToRegex(expanded, operation.greedy, extglob);
      } else {
        const expanded = await expandPart(ctx, part);
        regexStr += escapeRegex(expanded);
      }
    }
  }

  // Apply pattern removal to each param
  const strippedParams: string[] = [];
  const strippedBytes = { value: 0 };
  let removalWork = 0;
  for (const param of params) {
    const paramWork = operation.greedy
      ? param.length
      : param.length * param.length;
    if (paramWork > ctx.limits.maxGlobOperations - removalWork) {
      throw new ExecutionLimitError(
        `positional pattern-removal work limit exceeded (${ctx.limits.maxGlobOperations})`,
        "glob_operations",
      );
    }
    removalWork += paramWork;
    pushBounded(
      strippedParams,
      applyPatternRemoval(param, regexStr, operation.side, operation.greedy),
      strippedBytes,
      ctx,
    );
  }

  if (patRemIsStar) {
    // "${*#...}" - join all params with IFS into one word
    const ifsSep = getIfsSeparator(ctx.state.env);
    const joinBytes =
      strippedBytes.value +
      Math.max(0, strippedParams.length - 1) * utf8ByteLength(ifsSep) +
      utf8ByteLength(prefix) +
      utf8ByteLength(suffix);
    if (joinBytes > ctx.limits.maxStringLength) {
      throw new ExecutionLimitError(
        `positional expansion string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    }
    return {
      values: [prefix + strippedParams.join(ifsSep) + suffix],
      quoted: true,
    };
  }

  // "${@#...}" - each param is a separate word
  if (
    utf8ByteLength(prefix) + strippedBytes.value + utf8ByteLength(suffix) >
    ctx.limits.maxStringLength
  ) {
    throw new ExecutionLimitError(
      `positional expansion string limit exceeded (${ctx.limits.maxStringLength} bytes)`,
      "string_length",
    );
  }
  if (strippedParams.length === 1) {
    return {
      values: [prefix + strippedParams[0] + suffix],
      quoted: true,
    };
  }

  const result = [
    prefix + strippedParams[0],
    ...strippedParams.slice(1, -1),
    strippedParams[strippedParams.length - 1] + suffix,
  ];
  return { values: result, quoted: true };
}

/**
 * Handle "$@" and "$*" with adjacent text inside double quotes, e.g., "-$@-"
 * "$@": Each positional parameter becomes a separate word, with prefix joined to first
 *       and suffix joined to last. If no params, produces nothing (or just prefix+suffix if present)
 * "$*": All params joined with IFS as ONE word. If no params, produces one empty word.
 */
export async function handleSimplePositionalExpansion(
  ctx: InterpreterContext,
  wordParts: WordPart[],
  expandPart: ExpandPartFn,
): Promise<PositionalExpansionResult> {
  if (wordParts.length !== 1 || wordParts[0].type !== "DoubleQuoted") {
    return null;
  }

  const dqPart = wordParts[0];
  // Find if there's a $@ or $* inside
  let atIndex = -1;
  let isStar = false;
  for (let i = 0; i < dqPart.parts.length; i++) {
    const p = dqPart.parts[i];
    if (
      p.type === "ParameterExpansion" &&
      (p.parameter === "@" || p.parameter === "*")
    ) {
      atIndex = i;
      isStar = p.parameter === "*";
      break;
    }
  }

  if (atIndex === -1) {
    return null;
  }

  // Check if this is a simple $@ or $* without operations like ${*-default}
  const paramPart = dqPart.parts[atIndex];
  if (paramPart.type === "ParameterExpansion" && paramPart.operation) {
    // Has an operation - let normal expansion handle it
    return null;
  }

  // Get positional parameters
  const numParams = Number.parseInt(ctx.state.env.get("#") || "0", 10);

  // Expand prefix (parts before $@/$*)
  let prefix = "";
  for (let i = 0; i < atIndex; i++) {
    prefix += await expandPart(ctx, dqPart.parts[i]);
  }

  // Expand suffix (parts after $@/$*)
  let suffix = "";
  for (let i = atIndex + 1; i < dqPart.parts.length; i++) {
    suffix += await expandPart(ctx, dqPart.parts[i]);
  }

  if (numParams === 0) {
    if (isStar) {
      // "$*" with no params -> one empty word (prefix + suffix)
      return { values: [prefix + suffix], quoted: true };
    }
    // "$@" with no params -> no words (unless there's prefix/suffix)
    const combined = prefix + suffix;
    return { values: combined ? [combined] : [], quoted: true };
  }

  // Get individual positional parameters
  const params: string[] = [];
  for (let i = 1; i <= numParams; i++) {
    params.push(ctx.state.env.get(String(i)) || "");
  }

  if (isStar) {
    // "$*" - join all params with IFS into one word
    const ifsSep = getIfsSeparator(ctx.state.env);
    return {
      values: [prefix + params.join(ifsSep) + suffix],
      quoted: true,
    };
  }

  // "$@" - each param is a separate word
  // Join prefix with first, suffix with last
  if (params.length === 1) {
    return { values: [prefix + params[0] + suffix], quoted: true };
  }

  const result = [
    prefix + params[0],
    ...params.slice(1, -1),
    params[params.length - 1] + suffix,
  ];
  return { values: result, quoted: true };
}

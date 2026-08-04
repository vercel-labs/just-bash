import { BoundedStringBuilder } from "../../bounded-builder.js";
import type { RegexLike } from "../../regex/index.js";
import { ExecutionLimitError } from "../errors.js";
import type { InterpreterContext } from "../types.js";

/** Build a regex replacement prospectively without an unbounded host replace. */
export function applyPatternReplacementBounded(
  ctx: InterpreterContext,
  value: string,
  regex: RegexLike,
  replacement: string,
  replaceAll: boolean,
): string {
  const output = new BoundedStringBuilder(
    ctx.limits.maxStringLength,
    "pattern replacement",
    () =>
      new ExecutionLimitError(
        `pattern replacement: string length limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      ),
  );
  regex.lastIndex = 0;
  let lastIndex = 0;
  let match = regex.exec(value);

  while (match !== null) {
    ctx.executionScope.consumeLimited(
      "pattern_operations",
      1,
      ctx.limits.maxGlobOperations,
      "pattern replacement",
    );
    // A global greedy pattern can report a second empty match at EOF. Bash
    // does not apply another replacement there.
    if (replaceAll && match[0].length === 0 && match.index === value.length) {
      break;
    }
    output.append(value.slice(lastIndex, match.index));
    output.append(replacement);
    lastIndex = match.index + match[0].length;

    if (!replaceAll) break;
    if (match[0].length === 0) {
      // Preserve the previous implementation's progress rule and also move
      // engines that do not advance lastIndex after an empty match.
      lastIndex++;
      if (regex.lastIndex <= match.index) regex.lastIndex = match.index + 1;
    }
    match = regex.exec(value);
  }

  output.append(value.slice(lastIndex));
  regex.lastIndex = 0;
  return output.build();
}

import { BoundedStringBuilder } from "../../bounded-builder.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { QueryValue } from "./value-operations.js";

export interface JsonOutputOptions {
  compact?: boolean;
  raw?: boolean;
  sortKeys?: boolean;
  indent?: number;
  useTab?: boolean;
  limitKind?: "output_size" | "string_length";
}

/** Serialize query values directly into a bounded builder. */
export function formatJsonValue(
  value: QueryValue,
  maxBytes: number,
  options: JsonOutputOptions = {},
): string {
  const output = new BoundedStringBuilder(
    maxBytes,
    "query JSON output",
    () =>
      new ExecutionLimitError(
        `output size limit exceeded (${maxBytes} bytes)`,
        options.limitKind ?? "output_size",
      ),
  );
  appendJsonValue(output, value, options, 0);
  return output.build();
}

function appendJsonValue(
  output: BoundedStringBuilder,
  value: QueryValue,
  options: JsonOutputOptions,
  depth: number,
): void {
  if (value === null || value === undefined) {
    output.append("null");
    return;
  }
  if (typeof value === "boolean") {
    output.append(String(value));
    return;
  }
  if (typeof value === "number") {
    output.append(Number.isFinite(value) ? String(value) : "null");
    return;
  }
  if (typeof value === "string") {
    if (options.raw && depth === 0) output.append(value);
    else appendJsonString(output, value);
    return;
  }

  const compact = options.compact ?? false;
  const indentWidth = options.indent ?? 2;
  const indentUnit = options.useTab ? "\t" : " ".repeat(indentWidth);
  if (Array.isArray(value)) {
    output.append("[");
    for (let index = 0; index < value.length; index++) {
      output.append(
        compact ? (index === 0 ? "" : ",") : index === 0 ? "\n" : ",\n",
      );
      if (!compact) output.repeat(indentUnit, depth + 1);
      appendJsonValue(output, value[index], options, depth + 1);
    }
    if (!compact && value.length > 0) {
      output.append("\n").repeat(indentUnit, depth);
    }
    output.append("]");
    return;
  }

  let keys = Object.keys(value as object);
  if (options.sortKeys) keys = keys.sort();
  output.append("{");
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    output.append(
      compact ? (index === 0 ? "" : ",") : index === 0 ? "\n" : ",\n",
    );
    if (!compact) output.repeat(indentUnit, depth + 1);
    appendJsonString(output, key);
    output.append(compact ? ":" : ": ");
    appendJsonValue(
      output,
      // @banned-pattern-ignore: Object.keys returns own properties only.
      (value as Record<string, QueryValue>)[key],
      options,
      depth + 1,
    );
  }
  if (!compact && keys.length > 0) {
    output.append("\n").repeat(indentUnit, depth);
  }
  output.append("}");
}

function appendJsonString(output: BoundedStringBuilder, value: string): void {
  output.append('"');
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    let escaped = "";
    if (code === 34) escaped = '\\"';
    else if (code === 92) escaped = "\\\\";
    else if (code === 8) escaped = "\\b";
    else if (code === 9) escaped = "\\t";
    else if (code === 10) escaped = "\\n";
    else if (code === 12) escaped = "\\f";
    else if (code === 13) escaped = "\\r";
    else if (code < 32) escaped = `\\u${code.toString(16).padStart(4, "0")}`;
    if (!escaped) continue;
    output.append(value.slice(start, index)).append(escaped);
    start = index + 1;
  }
  output.append(value.slice(start)).append('"');
}

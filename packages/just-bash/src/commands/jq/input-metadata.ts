// Automa modifications: patch-jq-input-metadata.mjs source migration.
import { evaluate } from "../query-engine/evaluator.js";
import type { InputMetadata } from "../query-engine/input-state.js";
import type { AstNode } from "../query-engine/parser.js";
import type { QueryValue } from "../query-engine/value-operations.js";
import type {
  AppendValues,
  InputOptions,
  InputSource,
  JsonLimits,
  JsonStreamParser,
} from "./input-types.js";
export function evaluateInputMetadata(
  inputs: InputSource[],
  options: InputOptions,
  nullInput: boolean,
  rawInput: boolean,
  slurp: boolean,
  ast: AstNode,
  parse: JsonStreamParser,
  append: AppendValues,
  jsonLimits: JsonLimits,
) {
  const values: QueryValue[] = [];
  const metadata = (source: string | null, line: number) => {
    options.inputMetadata = { filename: source, line };
  };
  const lines = (content: string) => {
    let count = 0;
    for (let i = 0; i < content.length; i++)
      if (content.charCodeAt(i) === 10) count++;
    return count;
  };
  const documents = (input: InputSource, sourceIndex: number) => {
    const { source, content } = input;
    const positions: InputMetadata[] = [];
    let cursor = 0,
      line = 0;
    const parsed = parse(content, jsonLimits, (end, value) => {
      // jq consumes a physical line including its LF before parsing values on
      // that line. Scan each source monotonically, even with many values/line.
      if (end > cursor) {
        const newline = content.indexOf("\n", end);
        const through = newline < 0 ? content.length : newline + 1;
        while (cursor < through)
          if (content.charCodeAt(cursor++) === 10) line++;
      }
      let position = { filename: source, line };
      // Unquoted scalar tokens need the next delimiter (or EOF) before jq can
      // emit them. Observe the original sources read for that delimiter, without
      // changing the pinned parser's value/token concatenation behavior.
      if (
        end === content.length &&
        (value === null ||
          typeof value === "number" ||
          typeof value === "boolean")
      ) {
        for (let next = sourceIndex + 1; next < inputs.length; next++) {
          const following = inputs[next];
          if (!following.content.length) {
            position = { filename: following.source, line: 0 };
            continue;
          }
          if (/^[ \t\r\n{}[\],:"]/.test(following.content)) {
            position = {
              filename: following.source,
              line: following.content.includes("\n") ? 1 : 0,
            };
          }
          break;
        }
      }
      positions.push(position);
    });
    return { parsed, positions };
  };
  metadata(null, 0);
  if (nullInput) return evaluate(null, ast, options);
  if (rawInput && slurp) {
    for (const input of inputs) metadata(input.source, lines(input.content));
    return evaluate(
      inputs.map(({ content }) => content).join(""),
      ast,
      options,
    );
  }
  if (rawInput) {
    let remainder = "";
    for (const { source, content } of inputs) {
      const carried = remainder.length;
      const text = remainder + content;
      let start = 0,
        newline = text.indexOf("\n"),
        line = 0;
      metadata(source, 0);
      while (newline !== -1) {
        if (newline >= carried) line++;
        metadata(source, line);
        append(values, evaluate(text.slice(start, newline), ast, options));
        start = newline + 1;
        newline = text.indexOf("\n", start);
      }
      remainder = text.slice(start);
    }
    if (remainder !== "") append(values, evaluate(remainder, ast, options));
    return values;
  }
  if (slurp) {
    const items: QueryValue[] = [];
    for (const { source, content } of inputs) {
      if (content.trim()) append(items, parse(content, jsonLimits));
      metadata(source, lines(content));
    }
    return evaluate(items, ast, options);
  }
  for (let sourceIndex = 0; sourceIndex < inputs.length; sourceIndex++) {
    const input = inputs[sourceIndex];
    if (!input.content.trim()) continue;
    const { parsed, positions } = documents(input, sourceIndex);
    for (let i = 0; i < parsed.length; i++) {
      metadata(positions[i].filename, positions[i].line);
      append(values, evaluate(parsed[i], ast, options));
    }
  }
  return values;
}

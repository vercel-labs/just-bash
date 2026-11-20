// Automa modifications: patch-jq-input.mjs invocation-local, bounded shared cursor.
import { utf8ByteLength } from "../../encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { evaluate } from "../query-engine/evaluator.js";
import {
  createInputContextPolicy,
  hasInputCall,
  InputEOFError,
  type InputMetadata,
  type InputState,
} from "../query-engine/input-state.js";
import type { AstNode } from "../query-engine/parser.js";
import type { QueryValue } from "../query-engine/value-operations.js";
import { evaluateInputMetadata } from "./input-metadata.js";
import type {
  AppendValues,
  InputOptions,
  InputSource,
  JsonLimits,
  JsonStreamParser,
} from "./input-types.js";
export function evaluateInputs(
  inputs: InputSource[],
  options: InputOptions,
  nullInput: boolean,
  rawInput: boolean,
  slurp: boolean,
  ast: AstNode,
  parse: JsonStreamParser,
  append: AppendValues,
  jsonLimits: JsonLimits,
  sourceLimits: { maxInputBytes: number },
): QueryValue[] {
  if (!hasInputCall(ast))
    return evaluateInputMetadata(
      inputs,
      options,
      nullInput,
      rawInput,
      slurp,
      ast,
      parse,
      append,
      jsonLimits,
    );
  const values: QueryValue[] = [];
  const metadata: InputMetadata = { filename: null, line: 0 };
  const lines = new WeakMap<InputSource, { cursor: number; line: number }>();
  const counts = new WeakMap<InputSource, number>();
  const checked = new WeakSet<InputSource>();
  const emissions = new WeakMap<readonly QueryValue[], InputMetadata[]>();
  let sourceBytes = 0;
  const tick = () => {
    if (options.budget.operations >= options.limits.maxIterations)
      throw new ExecutionLimitError(
        `query evaluation: too many iterations (${options.limits.maxIterations})`,
        "iterations",
      );
    options.budget.operations++;
  };
  const checkSource = (source: InputSource) => {
    if (checked.has(source)) return;
    checked.add(source);
    sourceBytes += utf8ByteLength(source.content);
    if (sourceBytes > sourceLimits.maxInputBytes)
      throw new ExecutionLimitError(
        `jq: input size limit exceeded (${sourceLimits.maxInputBytes} bytes)`,
        "string_length",
      );
  };
  options.inputMetadata = metadata;
  let sourceIndex = 0,
    offset = 0,
    slurped = false;
  const position = (source: InputSource, end: number) => {
    const newline = source.content.indexOf("\n", end);
    const through = newline < 0 ? source.content.length : newline + 1;
    const state = lines.get(source) || { cursor: 0, line: 0 };
    while (state.cursor < through)
      if (source.content.charCodeAt(state.cursor++) === 10) state.line++;
    lines.set(source, state);
    Object.assign(metadata, { filename: source.source, line: state.line });
  };
  const nextBasic = () => {
    tick();
    let raw = "";
    while (sourceIndex < inputs.length) {
      const source = inputs[sourceIndex];
      if (source.error) {
        state.fileErrors.push(source.error.stderr);
        Object.assign(metadata, { filename: source.source, line: 0 });
        sourceIndex++;
        continue;
      }
      checkSource(source);
      const text = source.content;
      if (rawInput) {
        const end = text.indexOf("\n", offset);
        if (end >= 0) {
          raw += text.slice(offset, end);
          offset = end + 1;
          position(source, offset - 1);
          return { value: raw };
        }
        raw += text.slice(offset);
        sourceIndex++;
        offset = 0;
        if (sourceIndex === inputs.length && raw !== "") {
          position(source, text.length);
          return { value: raw };
        }
        continue;
      }
      while (offset < text.length && /\s/.test(text[offset])) offset++;
      if (offset === text.length) {
        position(source, text.length);
        sourceIndex++;
        offset = 0;
        continue;
      }
      const marker: { value?: QueryValue; end: number } = { end: offset };
      try {
        parse(
          text,
          jsonLimits,
          (end, value) => {
            marker.value = value;
            marker.end = end;
            throw marker;
          },
          offset,
        );
      } catch (error) {
        if (error !== marker) throw error;
        offset = marker.end;
        const count = (counts.get(source) || 0) + 1;
        if (count > jsonLimits.maxElements)
          throw new ExecutionLimitError(
            `query result element limit exceeded (${jsonLimits.maxElements})`,
            "array_elements",
          );
        counts.set(source, count);
        position(source, offset);
        if (
          offset === text.length &&
          (marker.value === null ||
            typeof marker.value === "number" ||
            typeof marker.value === "boolean")
        ) {
          for (let n = sourceIndex + 1; n < inputs.length; n++) {
            const following = inputs[n];
            if (following.error) break;
            if (!following.content.length) {
              Object.assign(metadata, { filename: following.source, line: 0 });
              continue;
            }
            if (/^[ \t\r\n{}[\],:"]/.test(following.content))
              Object.assign(metadata, {
                filename: following.source,
                line: following.content.includes("\n") ? 1 : 0,
              });
            break;
          }
        }
        return { value: marker.value };
      }
      sourceIndex++;
      offset = 0;
    }
    return undefined;
  };
  const next = () => {
    if (slurp) tick();
    if (!slurp) return nextBasic();
    if (slurped) return undefined;
    slurped = true;
    if (rawInput) {
      let value = "";
      for (const source of inputs) {
        if (source.error) {
          state.fileErrors.push(source.error.stderr);
          Object.assign(metadata, { filename: source.source, line: 0 });
          continue;
        }
        checkSource(source);
        value += source.content;
        position(source, source.content.length);
      }
      sourceIndex = inputs.length;
      return { value };
    }
    const all: QueryValue[] = [];
    for (let item = nextBasic(); item !== undefined; item = nextBasic())
      append(all, [item.value]);
    return { value: all };
  };
  const stamp = (array: QueryValue[]) => {
    if (!emissions.has(array))
      emissions.set(
        array,
        array.map(() => ({ ...metadata })),
      );
    return array;
  };
  const state: InputState = {
    fileErrors: [],
    readCount: 0,
    pushRecord(array) {
      const records = emissions.get(array) || [];
      records[array.length - 1] = { ...metadata };
      emissions.set(array, records);
    },
    beforeEach(array, index) {
      const record = emissions.get(array)?.[index];
      if (record) Object.assign(metadata, record);
    },
    stamp,
    append(target, source, offset) {
      const records = emissions.get(target) || [];
      const incoming = emissions.get(source);
      for (let i = 0; i < source.length; i++)
        records[offset + i] = { ...(incoming?.[i] || metadata) };
      emissions.set(target, records);
    },
    concat(result, left, right) {
      emissions.set(result, [
        ...(emissions.get(left) || left.map(() => ({ ...metadata }))),
        ...(emissions.get(right) || right.map(() => ({ ...metadata }))),
      ]);
      return result;
    },
    context: createInputContextPolicy(),
    read(context) {
      const policy = context.inputPolicy;
      if (policy && (typeof policy === "string" || policy.reads++ > 0))
        throw new ExecutionLimitError(
          `Unsupported jq input composition: ${
            typeof policy === "string" ? policy : policy.reason
          }`,
          "input_composition",
        );
      state.readCount++;
      const item = next();
      if (item !== undefined) return stamp([item.value]);
      throw new InputEOFError({ ...metadata }, [...state.fileErrors]);
    },
  };
  options.inputState = state;
  if (nullInput) return evaluate(null, ast, options);
  for (let item = next(); item !== undefined; item = next())
    append(values, evaluate(item.value, ast, options));
  return values;
}

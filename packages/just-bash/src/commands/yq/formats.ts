/**
 * Format parsing and output for yq command
 *
 * Supports YAML, JSON, XML, INI, CSV, and TOML formats with conversion between them.
 */

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import * as ini from "ini";
import Papa from "papaparse";
import * as TOML from "smol-toml";
import YAML from "yaml";
import { BoundedStringBuilder } from "../../bounded-builder.js";
import { utf8ByteLength } from "../../encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { QueryValue } from "../query-engine/index.js";
import { formatJsonValue } from "../query-engine/json-output.js";
import {
  type SanitizeParsedDataLimits,
  sanitizeParsedData,
} from "../query-engine/safe-object.js";

export type InputFormat = "yaml" | "xml" | "json" | "ini" | "csv" | "toml";
export type OutputFormat = "yaml" | "json" | "xml" | "ini" | "csv" | "toml";

const validInputFormats = [
  "yaml",
  "xml",
  "json",
  "ini",
  "csv",
  "toml",
] as const;
const validOutputFormats = [
  "yaml",
  "json",
  "xml",
  "ini",
  "csv",
  "toml",
] as const;

/**
 * Type guard to validate input format strings at runtime
 */
export function isValidInputFormat(value: unknown): value is InputFormat {
  return (
    typeof value === "string" &&
    validInputFormats.includes(value as InputFormat)
  );
}

/**
 * Type guard to validate output format strings at runtime
 */
export function isValidOutputFormat(value: unknown): value is OutputFormat {
  return (
    typeof value === "string" &&
    validOutputFormats.includes(value as OutputFormat)
  );
}

export interface FormatOptions {
  /** Input format (default: yaml) */
  inputFormat: InputFormat;
  /** Output format (default: yaml) */
  outputFormat: OutputFormat;
  /** Output raw strings without quotes (json only) */
  raw: boolean;
  /** Compact output (json only) */
  compact: boolean;
  /** Pretty print output */
  prettyPrint: boolean;
  /** Indentation level */
  indent: number;
  /** XML attribute prefix (default: +@) */
  xmlAttributePrefix: string;
  /** XML text content name (default: +content) */
  xmlContentName: string;
  /** CSV delimiter (empty = auto-detect) */
  csvDelimiter: string;
  /** CSV has header row */
  csvHeader: boolean;
}

export const defaultFormatOptions: FormatOptions = {
  inputFormat: "yaml",
  outputFormat: "yaml",
  raw: false,
  compact: false,
  prettyPrint: false,
  indent: 2,
  xmlAttributePrefix: "+@",
  xmlContentName: "+content",
  csvDelimiter: "",
  csvHeader: true,
};

/**
 * Extract file extension (browser-compatible alternative to node:path extname)
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  const lastSlash = Math.max(
    filename.lastIndexOf("/"),
    filename.lastIndexOf("\\"),
  );
  if (lastDot <= lastSlash + 1) return "";
  return filename.slice(lastDot);
}

/**
 * Detect input format from file extension
 */
export function detectFormatFromExtension(
  filename: string,
): InputFormat | null {
  const ext = getExtension(filename).toLowerCase();
  switch (ext) {
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".json":
      return "json";
    case ".xml":
      return "xml";
    case ".ini":
      return "ini";
    case ".csv":
    case ".tsv":
      return "csv";
    case ".toml":
      return "toml";
    default:
      return null;
  }
}

/**
 * Parse CSV into array of objects (if header) or array of arrays
 */
function parseCsv(
  input: string,
  delimiter: string,
  hasHeader: boolean,
): unknown[] {
  const result = Papa.parse(input, {
    delimiter: delimiter || undefined, // undefined triggers auto-detection
    header: hasHeader,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  return result.data;
}

/**
 * Format data as CSV
 */
function formatCsv(value: unknown, delimiter: string): string {
  if (!Array.isArray(value)) {
    value = [value];
  }
  // Use comma as default for output (empty means auto-detect for input only)
  return Papa.unparse(value as unknown[], { delimiter: delimiter || "," });
}

/**
 * Parse input data from the given format into a QueryValue
 */
export function parseInput(
  input: string,
  options: FormatOptions,
  limits: SanitizeParsedDataLimits = {},
): QueryValue {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const sanitize = (value: unknown): QueryValue =>
    sanitizeParsedData(value, limits);

  switch (options.inputFormat) {
    case "yaml":
      // SECURITY: maxAliasCount limits YAML alias expansion (billion-laughs defense).
      // Default schema is 'core' which does NOT resolve !!js/function or other
      // code-execution tags (those are only in 'yaml-1.1' schema).
      return sanitize(YAML.parse(trimmed, { maxAliasCount: 100 }));

    case "json":
      // SECURITY: JSON.parse returns plain objects — sanitizeParsedData converts
      // them to null-prototype objects at the boundary.
      return sanitize(JSON.parse(trimmed));

    case "xml": {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: options.xmlAttributePrefix,
        textNodeName: options.xmlContentName,
        // Keep values as strings to match real yq behavior
        parseAttributeValue: false,
        parseTagValue: false,
        trimValues: true,
        // SECURITY: Disable DOCTYPE entity processing to prevent entity expansion
        // attacks. External entities already throw, but disabling entirely is safer.
        processEntities: false,
        // Transform empty tags to null to match real yq
        tagValueProcessor: (_name, val) => (val === "" ? null : val),
      });
      return sanitize(parser.parse(trimmed));
    }

    case "ini":
      // SECURITY: sanitizeParsedData converts to null-prototype objects at boundary.
      return sanitize(ini.parse(trimmed));

    case "csv":
      // SECURITY: sanitizeParsedData converts to null-prototype objects at boundary.
      return sanitize(
        parseCsv(trimmed, options.csvDelimiter, options.csvHeader),
      );

    case "toml":
      // SECURITY: sanitizeParsedData converts to null-prototype objects at boundary.
      return sanitize(TOML.parse(trimmed));

    default: {
      const _exhaustive: never = options.inputFormat;
      throw new Error(`Invalid input format: ${_exhaustive}`);
    }
  }
}

/**
 * Parse all YAML documents from input (for slurp mode)
 */
export function parseAllYamlDocuments(
  input: string,
  limits: SanitizeParsedDataLimits = {},
): QueryValue[] {
  const maxDocuments = limits.maxElements ?? 1_000_000;
  let documents = input.trim() ? 1 : 0;
  let lineStart = 0;
  while (lineStart < input.length) {
    const lineEnd = input.indexOf("\n", lineStart);
    const markerEnd = lineStart + 3;
    const next = input[markerEnd];
    if (
      lineStart > 0 &&
      input.startsWith("---", lineStart) &&
      (next === undefined ||
        next === "\n" ||
        next === "\r" ||
        next === " " ||
        next === "\t" ||
        next === "#")
    ) {
      documents++;
      if (documents > maxDocuments) {
        throw new ExecutionLimitError(
          `query input document limit exceeded (${maxDocuments})`,
          "array_elements",
        );
      }
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }
  const docs = YAML.parseAllDocuments(input);
  if (docs.length > maxDocuments) {
    throw new ExecutionLimitError(
      `query input document limit exceeded (${maxDocuments})`,
      "array_elements",
    );
  }
  const elementBudget = { used: docs.length };
  const values: QueryValue[] = [];
  for (const doc of docs) {
    values.push(
      sanitizeParsedData(doc.toJS({ maxAliasCount: 100 }), {
        ...limits,
        elementBudget,
      }) as QueryValue,
    );
  }
  return values;
}

/**
 * Extract front-matter from content
 * Front-matter is YAML/TOML/JSON at the start of a file between --- or +++ delimiters
 * Returns { frontMatter: parsed data, content: remaining content } or null if no front-matter
 */
export function extractFrontMatter(
  input: string,
  limits: SanitizeParsedDataLimits = {},
): { frontMatter: QueryValue; content: string } | null {
  const trimmed = input.trimStart();

  // YAML front-matter: starts with ---
  if (trimmed.startsWith("---")) {
    const endMatch = trimmed.slice(3).match(/\n---(\n|$)/);
    if (endMatch && endMatch.index !== undefined) {
      const yamlContent = trimmed.slice(3, endMatch.index + 3);
      const remaining = trimmed.slice(endMatch.index + 3 + endMatch[0].length);
      return {
        frontMatter: sanitizeParsedData(
          YAML.parse(yamlContent, { maxAliasCount: 100 }),
          limits,
        ),
        content: remaining,
      };
    }
  }

  // TOML front-matter: starts with +++
  if (trimmed.startsWith("+++")) {
    const endMatch = trimmed.slice(3).match(/\n\+\+\+(\n|$)/);
    if (endMatch && endMatch.index !== undefined) {
      const tomlContent = trimmed.slice(3, endMatch.index + 3);
      const remaining = trimmed.slice(endMatch.index + 3 + endMatch[0].length);
      return {
        frontMatter: sanitizeParsedData(
          TOML.parse(tomlContent),
          limits,
        ) as QueryValue,
        content: remaining,
      };
    }
  }

  // JSON front-matter: starts with {{{ (less common)
  if (trimmed.startsWith("{{{")) {
    const endMatch = trimmed.slice(3).match(/\n}}}(\n|$)/);
    if (endMatch && endMatch.index !== undefined) {
      const jsonContent = trimmed.slice(3, endMatch.index + 3);
      const remaining = trimmed.slice(endMatch.index + 3 + endMatch[0].length);
      return {
        frontMatter: sanitizeParsedData(JSON.parse(jsonContent), limits),
        content: remaining,
      };
    }
  }

  return null;
}

/**
 * Format a QueryValue for output in the given format
 */
export function formatOutput(
  value: QueryValue,
  options: FormatOptions,
  maxBytes: number = Number.MAX_SAFE_INTEGER,
): string {
  if (value === undefined) return "";

  if (options.outputFormat !== "json") {
    assertExternalSerializationFits(value, options, maxBytes);
  }
  let serialized: string;
  switch (options.outputFormat) {
    case "yaml":
      serialized = YAML.stringify(value, {
        indent: options.indent,
      }).trimEnd();
      break;

    case "json": {
      return formatJsonValue(value, maxBytes, {
        compact: options.compact,
        raw: options.raw,
        indent: options.indent,
      });
    }

    case "xml": {
      const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: options.xmlAttributePrefix,
        textNodeName: options.xmlContentName,
        format: options.prettyPrint || !options.compact,
        indentBy: " ".repeat(options.indent),
      });
      serialized = builder.build(value);
      break;
    }

    case "ini": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        serialized = "";
        break;
      }
      serialized = ini.stringify(value as Record<string, unknown>);
      break;
    }

    case "csv":
      serialized = formatCsv(value, options.csvDelimiter);
      break;

    case "toml": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        serialized = "";
        break;
      }
      serialized = TOML.stringify(value as Record<string, unknown>);
      break;
    }

    default:
      throw new Error(`Unknown output format: ${options.outputFormat}`);
  }
  const bounded = new BoundedStringBuilder(
    maxBytes,
    "yq output",
    () =>
      new ExecutionLimitError(
        `output size limit exceeded (${maxBytes} bytes)`,
        "output_size",
      ),
  );
  return bounded.append(serialized).build();
}

/**
 * External format libraries construct their result eagerly. Prove a deliberately
 * conservative expansion bound before invoking them so a tiny configured output
 * limit cannot still permit a large temporary serialization.
 */
function assertExternalSerializationFits(
  value: QueryValue,
  options: FormatOptions,
  maxBytes: number,
): void {
  const escapeFactor =
    options.outputFormat === "yaml" || options.outputFormat === "toml" ? 6 : 2;
  const active = new WeakSet<object>();
  type Frame =
    | { kind: "exit"; value: object }
    | { kind: "value"; value: unknown; depth: number; labelBytes: number };
  const pending: Frame[] = [{ kind: "value", value, depth: 0, labelBytes: 0 }];
  let estimated = 0;
  const add = (bytes: number): void => {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > maxBytes - estimated
    ) {
      throw new ExecutionLimitError(
        `output size limit exceeded (${maxBytes} bytes)`,
        "output_size",
      );
    }
    estimated += bytes;
  };

  while (pending.length > 0) {
    const frame = pending.pop();
    if (!frame) break;
    if (frame.kind === "exit") {
      active.delete(frame.value);
      continue;
    }
    const { value: current, depth, labelBytes } = frame;
    if (typeof current === "string") {
      add(labelBytes + depth * options.indent);
      add(utf8ByteLength(current) * (depth === 0 ? 1 : escapeFactor));
      continue;
    }
    if (current === null || typeof current !== "object") {
      add(
        labelBytes + depth * options.indent + utf8ByteLength(String(current)),
      );
      continue;
    }
    add(32 + labelBytes + depth * options.indent);
    if (current instanceof Date) {
      add(utf8ByteLength(current.toISOString()) * escapeFactor);
      continue;
    }
    if (active.has(current)) {
      throw new Error("cyclic value cannot be formatted");
    }
    active.add(current);
    pending.push({ kind: "exit", value: current });
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) {
        pending.push({
          kind: "value",
          value: current[index],
          depth: depth + 1,
          labelBytes,
        });
      }
      continue;
    }
    const record = current as Record<string, unknown>;
    const keys = Object.keys(record);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      const keyBytes = utf8ByteLength(key);
      add(keyBytes * escapeFactor);
      pending.push({
        kind: "value",
        value: record[key],
        depth: depth + 1,
        labelBytes: keyBytes,
      });
    }
  }
}

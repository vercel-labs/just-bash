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
import type { QueryValue } from "../query-engine/index.js";
import { sanitizeParsedData } from "../query-engine/safe-object.js";

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
export function parseInput(input: string, options: FormatOptions): QueryValue {
  const trimmed = input.trim();
  if (!trimmed) return null;

  switch (options.inputFormat) {
    case "yaml":
      // SECURITY: maxAliasCount limits YAML alias expansion (billion-laughs defense).
      // Default schema is 'core' which does NOT resolve !!js/function or other
      // code-execution tags (those are only in 'yaml-1.1' schema).
      return sanitizeParsedData(YAML.parse(trimmed, { maxAliasCount: 100 }));

    case "json":
      // SECURITY: JSON.parse returns plain objects — sanitizeParsedData converts
      // them to null-prototype objects at the boundary.
      return sanitizeParsedData(JSON.parse(trimmed));

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
      return sanitizeParsedData(parser.parse(trimmed));
    }

    case "ini":
      // SECURITY: sanitizeParsedData converts to null-prototype objects at boundary.
      return sanitizeParsedData(ini.parse(trimmed));

    case "csv":
      // SECURITY: sanitizeParsedData converts to null-prototype objects at boundary.
      return sanitizeParsedData(
        parseCsv(trimmed, options.csvDelimiter, options.csvHeader),
      );

    case "toml":
      // SECURITY: sanitizeParsedData converts to null-prototype objects at boundary.
      return sanitizeParsedData(TOML.parse(trimmed)) as QueryValue;

    default: {
      const _exhaustive: never = options.inputFormat;
      throw new Error(`Invalid input format: ${_exhaustive}`);
    }
  }
}

/**
 * Parse all YAML documents from input (for slurp mode)
 */
export function parseAllYamlDocuments(input: string): QueryValue[] {
  const docs = YAML.parseAllDocuments(input);
  return docs.map((doc) =>
    sanitizeParsedData(doc.toJS({ maxAliasCount: 100 })),
  );
}

/**
 * Extract front-matter from content
 * Front-matter is YAML/TOML/JSON at the start of a file between --- or +++ delimiters
 * Returns { frontMatter: parsed data, content: remaining content } or null if no front-matter
 */
export function extractFrontMatter(
  input: string,
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
        frontMatter: sanitizeParsedData(TOML.parse(tomlContent)) as QueryValue,
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
        frontMatter: sanitizeParsedData(JSON.parse(jsonContent)),
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
): string {
  if (value === undefined) return "";

  switch (options.outputFormat) {
    case "yaml":
      return YAML.stringify(value, {
        indent: options.indent,
      }).trimEnd();

    case "json": {
      if (options.raw && typeof value === "string") {
        return value;
      }
      if (options.compact) {
        return JSON.stringify(value);
      }
      return JSON.stringify(value, null, options.indent);
    }

    case "xml": {
      const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: options.xmlAttributePrefix,
        textNodeName: options.xmlContentName,
        format: options.prettyPrint || !options.compact,
        indentBy: " ".repeat(options.indent),
      });
      return builder.build(value);
    }

    case "ini": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return "";
      }
      return ini.stringify(value as Record<string, unknown>);
    }

    case "csv":
      return formatCsv(value, options.csvDelimiter);

    case "toml": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return "";
      }
      return TOML.stringify(value as Record<string, unknown>);
    }

    default:
      throw new Error(`Unknown output format: ${options.outputFormat}`);
  }
}

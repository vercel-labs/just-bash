/**
 * Format parsing and output for yq command
 *
 * Supports YAML, JSON, XML, INI, and CSV formats with conversion between them.
 */

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import * as ini from "ini";
import Papa from "papaparse";
import YAML from "yaml";
import type { QueryValue } from "../query-engine/index.js";

export type InputFormat = "yaml" | "xml" | "json" | "ini" | "csv";
export type OutputFormat = "yaml" | "json" | "xml" | "ini" | "csv";

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
      return YAML.parse(trimmed);

    case "json":
      return JSON.parse(trimmed);

    case "xml": {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: options.xmlAttributePrefix,
        textNodeName: options.xmlContentName,
        // Keep values as strings to match real yq behavior
        parseAttributeValue: false,
        parseTagValue: false,
        trimValues: true,
        // Transform empty tags to null to match real yq
        tagValueProcessor: (_name, val) => (val === "" ? null : val),
      });
      return parser.parse(trimmed);
    }

    case "ini":
      return ini.parse(trimmed);

    case "csv":
      return parseCsv(trimmed, options.csvDelimiter, options.csvHeader);
  }
}

/**
 * Parse all YAML documents from input (for slurp mode)
 */
export function parseAllYamlDocuments(input: string): QueryValue[] {
  const docs = YAML.parseAllDocuments(input);
  return docs.map((doc) => doc.toJSON());
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
  }
}

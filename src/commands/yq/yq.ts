/**
 * yq - Command-line YAML/XML/INI/CSV processor
 *
 * Uses jq-style query expressions to process YAML, XML, INI, and CSV files.
 * Shares the query engine with jq for consistent filtering behavior.
 */

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import * as ini from "ini";
import Papa from "papaparse";
import YAML from "yaml";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import {
  type EvaluateOptions,
  evaluate,
  parse,
  type QueryValue,
} from "../query-engine/index.js";

const yqHelp = {
  name: "yq",
  summary: "command-line YAML/XML/INI/CSV processor",
  usage: "yq [OPTIONS] [FILTER] [FILE]",
  description: `yq uses jq-style expressions to query and transform data in various formats.
Supports YAML, JSON, XML, INI, and CSV with automatic format conversion.

EXAMPLES:
  # Extract a value from YAML
  yq '.name' config.yaml
  yq '.users[0].email' data.yaml

  # Filter arrays
  yq '.items[] | select(.active == true)' data.yaml
  yq '[.users[] | select(.age > 30)]' users.yaml

  # Transform data
  yq '.users | map({name, email})' data.yaml
  yq '.items | sort_by(.price) | reverse' products.yaml

  # Read JSON, output YAML
  yq -p json '.' config.json

  # Read YAML, output JSON
  yq -o json '.' config.yaml
  yq -o json -c '.' config.yaml  # compact JSON

  # Parse XML
  yq -p xml '.root.items.item[].name' data.xml
  yq -p xml '.root.user["@_id"]' data.xml  # XML attributes

  # Parse INI config files
  yq -p ini '.database.host' config.ini
  yq -p ini '.server' config.ini -o json

  # Parse CSV (auto-detects delimiter)
  yq -p csv '.[0].name' data.csv
  yq -p csv '[.[] | select(.category == "A")]' data.csv
  yq -p csv '.[].price | add' prices.csv

  # Convert between formats
  yq -p json -o csv '.users' data.json   # JSON to CSV
  yq -p csv -o yaml '.' data.csv         # CSV to YAML
  yq -p ini -o json '.' config.ini       # INI to JSON
  yq -p xml -o json '.' data.xml         # XML to JSON

  # Common jq functions work in yq:
  yq 'keys' data.yaml                    # get object keys
  yq 'length' data.yaml                  # array/string length
  yq '.items | first' data.yaml          # first element
  yq '.items | last' data.yaml           # last element
  yq '.nums | add' data.yaml             # sum numbers
  yq '.nums | min' data.yaml             # minimum
  yq '.nums | max' data.yaml             # maximum
  yq '.items | unique' data.yaml         # unique values
  yq '.items | group_by(.type)' data.yaml`,
  options: [
    "-p, --input-format=FMT   input format: yaml (default), xml, json, ini, csv",
    "-o, --output-format=FMT  output format: yaml (default), json, xml, ini, csv",
    "-r, --raw-output         output strings without quotes (json only)",
    "-c, --compact            compact output (json only)",
    "-e, --exit-status        set exit status based on output",
    "-s, --slurp              read entire input into array",
    "-n, --null-input         don't read any input",
    "-j, --join-output        don't print newlines after each output",
    "-P, --prettyPrint        pretty print output",
    "-I, --indent=N           set indent level (default: 2)",
    "    --xml-attribute-prefix=STR  XML attribute prefix (default: @_)",
    "    --xml-text-node=STR  XML text node name (default: #text)",
    "    --csv-delimiter=CHAR CSV delimiter (default: auto-detect)",
    "    --csv-header         CSV has header row (default: true)",
    "    --help               display this help and exit",
  ],
};

type InputFormat = "yaml" | "xml" | "json" | "ini" | "csv";
type OutputFormat = "yaml" | "json" | "xml" | "ini" | "csv";

interface YqOptions {
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
  raw: boolean;
  compact: boolean;
  exitStatus: boolean;
  slurp: boolean;
  nullInput: boolean;
  joinOutput: boolean;
  prettyPrint: boolean;
  indent: number;
  xmlAttributePrefix: string;
  xmlTextNode: string;
  csvDelimiter: string;
  csvHeader: boolean;
}

/**
 * Parse CSV into array of objects (if header) or array of arrays
 * If delimiter is empty string, PapaParse will auto-detect
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

function parseInput(
  input: string,
  format: InputFormat,
  options: YqOptions,
): QueryValue {
  const trimmed = input.trim();
  if (!trimmed) return null;

  switch (format) {
    case "yaml":
      return YAML.parse(trimmed);

    case "json":
      return JSON.parse(trimmed);

    case "xml": {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: options.xmlAttributePrefix,
        textNodeName: options.xmlTextNode,
        parseAttributeValue: true,
        parseTagValue: true,
      });
      return parser.parse(trimmed);
    }

    case "ini":
      return ini.parse(trimmed);

    case "csv":
      return parseCsv(trimmed, options.csvDelimiter, options.csvHeader);
  }
}

function formatOutput(value: QueryValue, options: YqOptions): string {
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
        textNodeName: options.xmlTextNode,
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

export const yqCommand: Command = {
  name: "yq",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) return showHelp(yqHelp);

    const options: YqOptions = {
      inputFormat: "yaml",
      outputFormat: "yaml",
      raw: false,
      compact: false,
      exitStatus: false,
      slurp: false,
      nullInput: false,
      joinOutput: false,
      prettyPrint: false,
      indent: 2,
      xmlAttributePrefix: "@_",
      xmlTextNode: "#text",
      csvDelimiter: "", // empty = auto-detect
      csvHeader: true,
    };

    let filter = ".";
    let filterSet = false;
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const a = args[i];

      // Long options with values
      if (a.startsWith("--input-format=")) {
        options.inputFormat = a.slice(15) as InputFormat;
      } else if (a.startsWith("--output-format=")) {
        options.outputFormat = a.slice(16) as OutputFormat;
      } else if (a.startsWith("--indent=")) {
        options.indent = Number.parseInt(a.slice(9), 10);
      } else if (a.startsWith("--xml-attribute-prefix=")) {
        options.xmlAttributePrefix = a.slice(23);
      } else if (a.startsWith("--xml-text-node=")) {
        options.xmlTextNode = a.slice(16);
      } else if (a.startsWith("--csv-delimiter=")) {
        options.csvDelimiter = a.slice(16);
      } else if (a === "--csv-header") {
        options.csvHeader = true;
      } else if (a === "--no-csv-header") {
        options.csvHeader = false;
      } else if (a === "-p" || a === "--input-format") {
        options.inputFormat = args[++i] as InputFormat;
      } else if (a === "-o" || a === "--output-format") {
        options.outputFormat = args[++i] as OutputFormat;
      } else if (a === "-I" || a === "--indent") {
        options.indent = Number.parseInt(args[++i], 10);
      } else if (a === "-r" || a === "--raw-output") {
        options.raw = true;
      } else if (a === "-c" || a === "--compact") {
        options.compact = true;
      } else if (a === "-e" || a === "--exit-status") {
        options.exitStatus = true;
      } else if (a === "-s" || a === "--slurp") {
        options.slurp = true;
      } else if (a === "-n" || a === "--null-input") {
        options.nullInput = true;
      } else if (a === "-j" || a === "--join-output") {
        options.joinOutput = true;
      } else if (a === "-P" || a === "--prettyPrint") {
        options.prettyPrint = true;
      } else if (a === "-") {
        files.push("-");
      } else if (a.startsWith("--")) {
        return unknownOption("yq", a);
      } else if (a.startsWith("-")) {
        // Handle combined short options like -rc
        for (const c of a.slice(1)) {
          if (c === "r") options.raw = true;
          else if (c === "c") options.compact = true;
          else if (c === "e") options.exitStatus = true;
          else if (c === "s") options.slurp = true;
          else if (c === "n") options.nullInput = true;
          else if (c === "j") options.joinOutput = true;
          else if (c === "P") options.prettyPrint = true;
          else return unknownOption("yq", `-${c}`);
        }
      } else if (!filterSet) {
        filter = a;
        filterSet = true;
      } else {
        files.push(a);
      }
    }

    // Read input
    let input: string;
    if (options.nullInput) {
      input = "";
    } else if (files.length === 0 || (files.length === 1 && files[0] === "-")) {
      input = ctx.stdin;
    } else {
      try {
        const filePath = ctx.fs.resolvePath(ctx.cwd, files[0]);
        input = await ctx.fs.readFile(filePath);
      } catch {
        return {
          stdout: "",
          stderr: `yq: ${files[0]}: No such file or directory\n`,
          exitCode: 2,
        };
      }
    }

    try {
      const ast = parse(filter);
      let values: QueryValue[];

      const evalOptions: EvaluateOptions = {
        limits: ctx.limits
          ? { maxIterations: ctx.limits.maxJqIterations }
          : undefined,
      };

      if (options.nullInput) {
        values = evaluate(null, ast, evalOptions);
      } else if (options.slurp) {
        // Parse all documents into array
        const items: QueryValue[] = [];
        if (options.inputFormat === "yaml") {
          // YAML supports multiple documents separated by ---
          const docs = YAML.parseAllDocuments(input);
          for (const doc of docs) {
            items.push(doc.toJSON());
          }
        } else {
          items.push(parseInput(input, options.inputFormat, options));
        }
        values = evaluate(items, ast, evalOptions);
      } else {
        const parsed = parseInput(input, options.inputFormat, options);
        values = evaluate(parsed, ast, evalOptions);
      }

      // Format output
      const formatted = values.map((v) => formatOutput(v, options));
      const separator = options.joinOutput ? "" : "\n";
      const output = formatted.filter((s) => s !== "").join(separator);
      const exitCode =
        options.exitStatus &&
        (values.length === 0 ||
          values.every((v) => v === null || v === undefined || v === false))
          ? 1
          : 0;

      return {
        stdout: output ? (options.joinOutput ? output : `${output}\n`) : "",
        stderr: "",
        exitCode,
      };
    } catch (e) {
      if (e instanceof ExecutionLimitError) {
        return {
          stdout: "",
          stderr: `yq: ${e.message}\n`,
          exitCode: ExecutionLimitError.EXIT_CODE,
        };
      }
      const msg = (e as Error).message;
      if (msg.includes("Unknown function")) {
        return {
          stdout: "",
          stderr: `yq: error: ${msg}\n`,
          exitCode: 3,
        };
      }
      return {
        stdout: "",
        stderr: `yq: parse error: ${msg}\n`,
        exitCode: 5,
      };
    }
  },
};

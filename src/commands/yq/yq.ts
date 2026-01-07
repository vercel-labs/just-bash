/**
 * yq - Command-line YAML/XML/INI/CSV/TOML processor
 *
 * Uses jq-style query expressions to process YAML, XML, INI, CSV, and TOML files.
 * Shares the query engine with jq for consistent filtering behavior.
 *
 * Inspired by mikefarah/yq (https://github.com/mikefarah/yq)
 * This is a reimplementation for the just-bash sandboxed environment.
 */

import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import {
  type EvaluateOptions,
  evaluate,
  parse,
  type QueryValue,
} from "../query-engine/index.js";
import {
  defaultFormatOptions,
  detectFormatFromExtension,
  extractFrontMatter,
  type FormatOptions,
  formatOutput,
  isValidInputFormat,
  isValidOutputFormat,
  parseAllYamlDocuments,
  parseInput,
} from "./formats.js";

const yqHelp = {
  name: "yq",
  summary: "command-line YAML/XML/INI/CSV/TOML processor",
  usage: "yq [OPTIONS] [FILTER] [FILE]",
  description: `yq uses jq-style expressions to query and transform data in various formats.
Supports YAML, JSON, XML, INI, CSV, and TOML with automatic format conversion.

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

  # Modify file in-place
  yq -i '.version = "2.0"' config.yaml

  # Read JSON, output YAML
  yq -p json '.' config.json

  # Read YAML, output JSON
  yq -o json '.' config.yaml
  yq -o json -c '.' config.yaml  # compact JSON

  # Parse TOML config files
  yq '.package.name' Cargo.toml
  yq -o json '.' pyproject.toml

  # Parse XML (attributes use +@ prefix, text uses +content)
  yq -p xml '.root.items.item[].name' data.xml
  yq -p xml '.root.user["+@id"]' data.xml  # XML attributes

  # Parse INI config files
  yq -p ini '.database.host' config.ini
  yq -p ini '.server' config.ini -o json

  # Parse CSV/TSV (auto-detects delimiter)
  yq -p csv '.[0].name' data.csv
  yq '.[0].name' data.tsv              # auto-detected as CSV
  yq -p csv '[.[] | select(.category == "A")]' data.csv

  # Extract front-matter from markdown/content files
  yq --front-matter '.title' post.md

  # Convert between formats
  yq -p json -o csv '.users' data.json   # JSON to CSV
  yq -p csv -o yaml '.' data.csv         # CSV to YAML
  yq -p ini -o json '.' config.ini       # INI to JSON
  yq -p xml -o json '.' data.xml         # XML to JSON
  yq -o toml '.' config.yaml             # YAML to TOML

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
    "-p, --input-format=FMT   input format: yaml (default), xml, json, ini, csv, toml",
    "-o, --output-format=FMT  output format: yaml (default), json, xml, ini, csv, toml",
    "-i, --inplace            modify file in-place",
    "-r, --raw-output         output strings without quotes (json only)",
    "-c, --compact            compact output (json only)",
    "-e, --exit-status        set exit status based on output",
    "-s, --slurp              read entire input into array",
    "-n, --null-input         don't read any input",
    "-j, --join-output        don't print newlines after each output",
    "-f, --front-matter       extract and process front-matter only",
    "-P, --prettyPrint        pretty print output",
    "-I, --indent=N           set indent level (default: 2)",
    "    --xml-attribute-prefix=STR  XML attribute prefix (default: +@)",
    "    --xml-content-name=STR  XML text content name (default: +content)",
    "    --csv-delimiter=CHAR CSV delimiter (default: auto-detect)",
    "    --csv-header         CSV has header row (default: true)",
    "    --help               display this help and exit",
  ],
};

interface YqOptions extends FormatOptions {
  exitStatus: boolean;
  slurp: boolean;
  nullInput: boolean;
  joinOutput: boolean;
  inplace: boolean;
  frontMatter: boolean;
}

interface ParsedArgs {
  options: YqOptions;
  filter: string;
  files: string[];
  inputFormatExplicit: boolean;
}

function parseArgs(args: string[]): ParsedArgs | ExecResult {
  const options: YqOptions = {
    ...defaultFormatOptions,
    exitStatus: false,
    slurp: false,
    nullInput: false,
    joinOutput: false,
    inplace: false,
    frontMatter: false,
  };
  let inputFormatExplicit = false;

  let filter = ".";
  let filterSet = false;
  const files: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    // Long options with values
    if (a.startsWith("--input-format=")) {
      const format = a.slice(15);
      if (!isValidInputFormat(format)) {
        return unknownOption("yq", `--input-format=${format}`);
      }
      options.inputFormat = format;
      inputFormatExplicit = true;
    } else if (a.startsWith("--output-format=")) {
      const format = a.slice(16);
      if (!isValidOutputFormat(format)) {
        return unknownOption("yq", `--output-format=${format}`);
      }
      options.outputFormat = format;
    } else if (a.startsWith("--indent=")) {
      options.indent = Number.parseInt(a.slice(9), 10);
    } else if (a.startsWith("--xml-attribute-prefix=")) {
      options.xmlAttributePrefix = a.slice(23);
    } else if (a.startsWith("--xml-content-name=")) {
      options.xmlContentName = a.slice(19);
    } else if (a.startsWith("--csv-delimiter=")) {
      options.csvDelimiter = a.slice(16);
    } else if (a === "--csv-header") {
      options.csvHeader = true;
    } else if (a === "--no-csv-header") {
      options.csvHeader = false;
    } else if (a === "-p" || a === "--input-format") {
      const format = args[++i];
      if (!isValidInputFormat(format)) {
        return unknownOption("yq", `${a} ${format}`);
      }
      options.inputFormat = format;
      inputFormatExplicit = true;
    } else if (a === "-o" || a === "--output-format") {
      const format = args[++i];
      if (!isValidOutputFormat(format)) {
        return unknownOption("yq", `${a} ${format}`);
      }
      options.outputFormat = format;
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
    } else if (a === "-i" || a === "--inplace") {
      options.inplace = true;
    } else if (a === "-f" || a === "--front-matter") {
      options.frontMatter = true;
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
        else if (c === "i") options.inplace = true;
        else if (c === "f") options.frontMatter = true;
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

  return { options, filter, files, inputFormatExplicit };
}

export const yqCommand: Command = {
  name: "yq",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) return showHelp(yqHelp);

    const parsed = parseArgs(args);
    if ("exitCode" in parsed) return parsed;

    const { options, filter, files, inputFormatExplicit } = parsed;

    // Auto-detect format from file extension if not explicitly set
    if (!inputFormatExplicit && files.length > 0 && files[0] !== "-") {
      const detected = detectFormatFromExtension(files[0]);
      if (detected) {
        options.inputFormat = detected;
      }
    }

    // Inplace requires a file
    if (options.inplace && (files.length === 0 || files[0] === "-")) {
      return {
        stdout: "",
        stderr: "yq: -i/--inplace requires a file argument\n",
        exitCode: 1,
      };
    }

    // Read input
    let input: string;
    let filePath: string | undefined;
    if (options.nullInput) {
      input = "";
    } else if (files.length === 0 || (files.length === 1 && files[0] === "-")) {
      input = ctx.stdin;
    } else {
      try {
        filePath = ctx.fs.resolvePath(ctx.cwd, files[0]);
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
        env: ctx.env,
      };

      if (options.nullInput) {
        values = evaluate(null, ast, evalOptions);
      } else if (options.frontMatter) {
        // Extract and process front-matter only
        const fm = extractFrontMatter(input);
        if (!fm) {
          return {
            stdout: "",
            stderr: "yq: no front-matter found\n",
            exitCode: 1,
          };
        }
        values = evaluate(fm.frontMatter, ast, evalOptions);
      } else if (options.slurp) {
        // Parse all documents into array
        let items: QueryValue[];
        if (options.inputFormat === "yaml") {
          // YAML supports multiple documents separated by ---
          items = parseAllYamlDocuments(input);
        } else {
          items = [parseInput(input, options)];
        }
        values = evaluate(items, ast, evalOptions);
      } else {
        const parsed = parseInput(input, options);
        values = evaluate(parsed, ast, evalOptions);
      }

      // Format output
      const formatted = values.map((v) => formatOutput(v, options));
      const separator = options.joinOutput ? "" : "\n";
      const output = formatted.filter((s) => s !== "").join(separator);
      const finalOutput = output
        ? options.joinOutput
          ? output
          : `${output}\n`
        : "";

      // Handle inplace mode
      if (options.inplace && filePath) {
        await ctx.fs.writeFile(filePath, finalOutput);
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      const exitCode =
        options.exitStatus &&
        (values.length === 0 ||
          values.every((v) => v === null || v === undefined || v === false))
          ? 1
          : 0;

      return {
        stdout: finalOutput,
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

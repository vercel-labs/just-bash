import type { Command, CommandContext, ExecResult } from "../../types.js";
import { readAndConcat } from "../../utils/file-reader.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { createComparator, filterUnique } from "./comparator.js";
import { parseKeySpec } from "./parser.js";
import type { SortOptions } from "./types.js";

const sortHelp = {
  name: "sort",
  summary: "sort lines of text files",
  usage: "sort [OPTION]... [FILE]...",
  options: [
    "-f, --ignore-case    fold lower case to upper case characters",
    "-n, --numeric-sort   compare according to string numerical value",
    "-r, --reverse        reverse the result of comparisons",
    "-u, --unique         output only unique lines",
    "-k, --key=KEYDEF     sort via a key; KEYDEF gives location and type",
    "-t, --field-separator=SEP  use SEP as field separator",
    "    --help           display this help and exit",
  ],
  description: `KEYDEF is F[.C][OPTS][,F[.C][OPTS]]
  F is a field number (1-indexed)
  C is a character position within the field (1-indexed)
  OPTS can be: n (numeric), r (reverse), f (fold case), b (ignore blanks)

Examples:
  -k1        sort by first field
  -k2,2      sort by second field only
  -k1.3      sort by first field starting at 3rd character
  -k1,2n     sort by fields 1-2 numerically
  -k2 -k1    sort by field 2, then by field 1`,
};

export const sortCommand: Command = {
  name: "sort",
  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(sortHelp);
    }

    const options: SortOptions = {
      reverse: false,
      numeric: false,
      unique: false,
      ignoreCase: false,
      keys: [],
      fieldDelimiter: null,
    };
    const files: string[] = [];

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-r" || arg === "--reverse") {
        options.reverse = true;
      } else if (arg === "-n" || arg === "--numeric-sort") {
        options.numeric = true;
      } else if (arg === "-u" || arg === "--unique") {
        options.unique = true;
      } else if (arg === "-f" || arg === "--ignore-case") {
        options.ignoreCase = true;
      } else if (arg === "-t" || arg === "--field-separator") {
        options.fieldDelimiter = args[++i] || null;
      } else if (arg.startsWith("-t")) {
        options.fieldDelimiter = arg.slice(2) || null;
      } else if (arg.startsWith("--field-separator=")) {
        options.fieldDelimiter = arg.slice(18) || null;
      } else if (arg === "-k" || arg === "--key") {
        const keyArg = args[++i];
        if (keyArg) {
          const keySpec = parseKeySpec(keyArg);
          if (keySpec) {
            options.keys.push(keySpec);
          }
        }
      } else if (arg.startsWith("-k")) {
        const keySpec = parseKeySpec(arg.slice(2));
        if (keySpec) {
          options.keys.push(keySpec);
        }
      } else if (arg.startsWith("--key=")) {
        const keySpec = parseKeySpec(arg.slice(6));
        if (keySpec) {
          options.keys.push(keySpec);
        }
      } else if (arg.startsWith("--")) {
        return unknownOption("sort", arg);
      } else if (arg.startsWith("-") && !arg.startsWith("--")) {
        // Handle combined flags like -rn
        let hasUnknown = false;
        for (const char of arg.slice(1)) {
          if (char === "r") options.reverse = true;
          else if (char === "n") options.numeric = true;
          else if (char === "u") options.unique = true;
          else if (char === "f") options.ignoreCase = true;
          else {
            hasUnknown = true;
            break;
          }
        }
        if (hasUnknown) {
          return unknownOption("sort", arg);
        }
      } else {
        files.push(arg);
      }
    }

    // Read from files or stdin
    const readResult = await readAndConcat(ctx, files, { cmdName: "sort" });
    if (!readResult.ok) return readResult.error;
    const content = readResult.content;

    // Split into lines (preserve empty lines at the end for sorting)
    let lines = content.split("\n");

    // Remove last empty element if content ends with newline
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    // Sort lines using the comparator
    const comparator = createComparator(options);
    lines.sort(comparator);

    // Remove duplicates if -u
    if (options.unique) {
      lines = filterUnique(lines, options);
    }

    const output = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    return { stdout: output, stderr: "", exitCode: 0 };
  },
};

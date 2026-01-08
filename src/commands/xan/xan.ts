/**
 * xan - CSV toolkit command
 *
 * Provides ergonomic CLI for CSV operations, translating commands to jq expressions
 * and using the shared query engine. Inspired by xsv and xan tools.
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import {
  cmdAgg,
  cmdBehead,
  cmdCat,
  cmdCount,
  cmdDedup,
  cmdDrop,
  cmdEnum,
  cmdExplode,
  cmdFilter,
  cmdFixlengths,
  cmdFlatmap,
  cmdFlatten,
  cmdFmt,
  cmdFrequency,
  cmdFrom,
  cmdGroupby,
  cmdHead,
  cmdHeaders,
  cmdImplode,
  cmdJoin,
  cmdMap,
  cmdMerge,
  cmdPartition,
  cmdPivot,
  cmdRename,
  cmdReverse,
  cmdSample,
  cmdSearch,
  cmdSelect,
  cmdShuffle,
  cmdSlice,
  cmdSort,
  cmdSplit,
  cmdStats,
  cmdTail,
  cmdTo,
  cmdTop,
  cmdTransform,
  cmdTranspose,
  cmdView,
} from "./subcommands.js";

// Commands that are not yet implemented
const NOT_IMPLEMENTED = new Set([
  "fuzzy-join",
  "glob",
  "hist",
  "input",
  "parallel",
  "plot",
  "progress",
  "range",
  "scrape",
  "tokenize", // Real xan's tokenize is NLP tokenizer
  "union-find",
]);

// All known xan commands (for error messages)
const KNOWN_COMMANDS = new Set([
  // Implemented
  "agg",
  "behead",
  "cat",
  "count",
  "dedup",
  "drop",
  "enum",
  "explode",
  "f", // alias for flatten
  "filter",
  "fixlengths",
  "flatmap",
  "flatten",
  "fmt",
  "frequency",
  "freq",
  "from",
  "groupby",
  "head",
  "headers",
  "implode",
  "join",
  "map",
  "merge",
  "partition",
  "pivot",
  "rename",
  "reverse",
  "sample",
  "search",
  "select",
  "shuffle",
  "slice",
  "sort",
  "split",
  "stats",
  "tail",
  "to",
  "top",
  "transform",
  "transpose",
  "view",
  // Not implemented
  ...NOT_IMPLEMENTED,
]);

const xanHelp = {
  name: "xan",
  summary: "CSV toolkit for data manipulation",
  usage: "xan <COMMAND> [OPTIONS] [FILE]",
  description: `xan is a collection of commands for working with CSV data.
It provides a simple, ergonomic interface for common data operations.

COMMANDS:
  Core:
    headers    Show column names
    count      Count rows
    head       Show first N rows
    tail       Show last N rows
    slice      Extract row range
    reverse    Reverse row order
    behead     Remove header row
    sample     Random sample of rows

  Column operations:
    select     Select columns (supports glob, ranges, negation)
    drop       Drop columns
    rename     Rename columns
    enum       Add row index column

  Row operations:
    filter     Filter rows by expression
    search     Filter rows by regex match
    sort       Sort rows
    dedup      Remove duplicates
    top        Get top N by column

  Transformations:
    map        Add computed columns
    transform  Modify existing columns
    explode    Split column into multiple rows
    implode    Combine rows, join column values
    flatmap    Map returning multiple rows
    pivot      Reshape rows into columns
    transpose  Swap rows and columns

  Aggregation:
    agg        Aggregate values
    groupby    Group and aggregate
    frequency  Count value occurrences
    stats      Show column statistics

  Multi-file:
    cat        Concatenate CSV files
    join       Join two CSV files on key
    merge      Merge sorted CSV files
    split      Split into multiple files
    partition  Split by column value

  Data conversion:
    to         Convert CSV to other formats (json)
    from       Convert other formats to CSV (json)
    shuffle    Randomly reorder rows
    fixlengths Fix ragged CSV files

  Output:
    view       Pretty print as table
    flatten    Display records vertically (alias: f)
    fmt        Format output

EXAMPLES:
  xan headers data.csv
  xan count data.csv
  xan head -n 5 data.csv
  xan select name,email data.csv
  xan select 'vec_*' data.csv          # glob pattern
  xan select 'a:c' data.csv            # column range
  xan filter 'age > 30' data.csv
  xan search -r '^foo' data.csv
  xan sort -N price data.csv
  xan agg 'sum(amount) as total' data.csv
  xan groupby region 'count() as n' data.csv
  xan explode tags data.csv
  xan join id file1.csv id file2.csv
  xan pivot year 'sum(sales)' data.csv`,
  options: ["    --help    display this help and exit"],
};

const subHelps: Record<
  string,
  {
    name: string;
    summary: string;
    usage: string;
    description: string;
    options: string[];
  }
> = {
  headers: {
    name: "xan headers",
    summary: "Show column names",
    usage: "xan headers [OPTIONS] [FILE]",
    description: "Display column names from a CSV file.",
    options: ["-j, --just-names    show names only (no index)"],
  },
  count: {
    name: "xan count",
    summary: "Count rows",
    usage: "xan count [FILE]",
    description: "Count the number of data rows (excluding header).",
    options: [],
  },
  filter: {
    name: "xan filter",
    summary: "Filter rows by expression",
    usage: "xan filter [OPTIONS] EXPR [FILE]",
    description: "Filter CSV rows using moonblade expressions.",
    options: [
      "-v, --invert    invert match",
      "-l, --limit N   limit output rows",
    ],
  },
  search: {
    name: "xan search",
    summary: "Filter rows by regex",
    usage: "xan search [OPTIONS] PATTERN [FILE]",
    description: "Filter CSV rows by regex match on columns.",
    options: [
      "-s, --select COLS   search only these columns",
      "-v, --invert        invert match",
      "-i, --ignore-case   case insensitive",
    ],
  },
  select: {
    name: "xan select",
    summary: "Select columns",
    usage: "xan select COLS [FILE]",
    description: "Select columns by name, index, glob, or range.",
    options: [
      "Supports: col names, indices (0,1), ranges (a:c), globs (vec_*), negation (!col)",
    ],
  },
  explode: {
    name: "xan explode",
    summary: "Split column into rows",
    usage: "xan explode COLUMN [OPTIONS] [FILE]",
    description: "Split delimited column values into multiple rows.",
    options: [
      "-s, --separator SEP  separator (default: |)",
      "--drop-empty         drop empty values",
      "-r, --rename NAME    rename column",
    ],
  },
  implode: {
    name: "xan implode",
    summary: "Combine rows",
    usage: "xan implode COLUMN [OPTIONS] [FILE]",
    description: "Combine consecutive rows, joining column values.",
    options: [
      "-s, --sep SEP        separator (default: |)",
      "-r, --rename NAME    rename column",
    ],
  },
  join: {
    name: "xan join",
    summary: "Join CSV files",
    usage: "xan join KEY1 FILE1 KEY2 FILE2 [OPTIONS]",
    description: "Join two CSV files on key columns.",
    options: [
      "--left               left outer join",
      "--right              right outer join",
      "--full               full outer join",
      "-D, --default VAL    default for missing",
    ],
  },
  pivot: {
    name: "xan pivot",
    summary: "Reshape to columns",
    usage: "xan pivot COLUMN AGG_EXPR [OPTIONS] [FILE]",
    description: "Turn row values into columns.",
    options: ["-g, --groupby COLS   group by columns"],
  },
};

export const xanCommand: Command = {
  name: "xan",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (args.length === 0 || hasHelpFlag(args)) {
      return showHelp(xanHelp);
    }

    const subcommand = args[0];
    const subArgs = args.slice(1);

    // Check for subcommand --help
    if (hasHelpFlag(subArgs)) {
      const help = subHelps[subcommand];
      if (help) {
        return showHelp(help);
      }
      return showHelp(xanHelp);
    }

    // Check if command is known but not implemented
    if (NOT_IMPLEMENTED.has(subcommand)) {
      return {
        stdout: "",
        stderr: `xan ${subcommand}: not yet implemented\n`,
        exitCode: 1,
      };
    }

    switch (subcommand) {
      // Core
      case "headers":
        return cmdHeaders(subArgs, ctx);
      case "count":
        return cmdCount(subArgs, ctx);
      case "head":
        return cmdHead(subArgs, ctx);
      case "tail":
        return cmdTail(subArgs, ctx);
      case "slice":
        return cmdSlice(subArgs, ctx);
      case "reverse":
        return cmdReverse(subArgs, ctx);
      case "behead":
        return cmdBehead(subArgs, ctx);
      case "sample":
        return cmdSample(subArgs, ctx);

      // Column operations
      case "select":
        return cmdSelect(subArgs, ctx);
      case "drop":
        return cmdDrop(subArgs, ctx);
      case "rename":
        return cmdRename(subArgs, ctx);
      case "enum":
        return cmdEnum(subArgs, ctx);

      // Row operations
      case "filter":
        return cmdFilter(subArgs, ctx);
      case "search":
        return cmdSearch(subArgs, ctx);
      case "sort":
        return cmdSort(subArgs, ctx);
      case "dedup":
        return cmdDedup(subArgs, ctx);
      case "top":
        return cmdTop(subArgs, ctx);

      // Transformations
      case "map":
        return cmdMap(subArgs, ctx);
      case "transform":
        return cmdTransform(subArgs, ctx);
      case "explode":
        return cmdExplode(subArgs, ctx);
      case "implode":
        return cmdImplode(subArgs, ctx);
      case "flatmap":
        return cmdFlatmap(subArgs, ctx);
      case "pivot":
        return cmdPivot(subArgs, ctx);

      // Aggregation
      case "agg":
        return cmdAgg(subArgs, ctx);
      case "groupby":
        return cmdGroupby(subArgs, ctx);
      case "frequency":
      case "freq":
        return cmdFrequency(subArgs, ctx);
      case "stats":
        return cmdStats(subArgs, ctx);

      // Multi-file
      case "cat":
        return cmdCat(subArgs, ctx);
      case "join":
        return cmdJoin(subArgs, ctx);
      case "merge":
        return cmdMerge(subArgs, ctx);
      case "split":
        return cmdSplit(subArgs, ctx);
      case "partition":
        return cmdPartition(subArgs, ctx);

      // Data conversion
      case "to":
        return cmdTo(subArgs, ctx);
      case "from":
        return cmdFrom(subArgs, ctx);
      case "transpose":
        return cmdTranspose(subArgs, ctx);
      case "shuffle":
        return cmdShuffle(subArgs, ctx);
      case "fixlengths":
        return cmdFixlengths(subArgs, ctx);

      // Output
      case "view":
        return cmdView(subArgs, ctx);
      case "flatten":
      case "f":
        return cmdFlatten(subArgs, ctx);
      case "fmt":
        return cmdFmt(subArgs, ctx);

      default:
        // Check if it's a known command (typo suggestion)
        if (KNOWN_COMMANDS.has(subcommand)) {
          return {
            stdout: "",
            stderr: `xan ${subcommand}: not yet implemented\n`,
            exitCode: 1,
          };
        }
        return {
          stdout: "",
          stderr: `xan: unknown command '${subcommand}'\nRun 'xan --help' for usage.\n`,
          exitCode: 1,
        };
    }
  },
};

/**
 * CLI argument parser for psql command
 */

import type { ExecResult } from "../../types.js";

export interface PsqlOptions {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  command?: string;
  file?: string;
  outputFormat: "aligned" | "unaligned" | "csv" | "json" | "html";
  fieldSeparator: string;
  recordSeparator: string;
  tuplesOnly: boolean;
  quiet: boolean;
  singleTransaction: boolean;
  outputFile?: string;
  variables: Record<string, string>;
}

export function parseArgs(args: string[]): PsqlOptions | ExecResult {
  const options: PsqlOptions = {
    outputFormat: "aligned",
    fieldSeparator: "|",
    recordSeparator: "\n",
    tuplesOnly: false,
    quiet: false,
    singleTransaction: false,
    variables: {},
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--host") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "psql: option requires an argument -- 'h'\n",
          exitCode: 1,
        };
      }
      options.host = args[++i];
    } else if (arg === "-p" || arg === "--port") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "psql: option requires an argument -- 'p'\n",
          exitCode: 1,
        };
      }
      const port = Number.parseInt(args[++i], 10);
      if (Number.isNaN(port) || port <= 0 || port > 65535) {
        return {
          stdout: "",
          stderr: `psql: invalid port number: ${args[i]}\n`,
          exitCode: 1,
        };
      }
      options.port = port;
    } else if (arg === "-U" || arg === "--username") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "psql: option requires an argument -- 'U'\n",
          exitCode: 1,
        };
      }
      options.username = args[++i];
    } else if (arg === "-d" || arg === "--dbname") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "psql: option requires an argument -- 'd'\n",
          exitCode: 1,
        };
      }
      options.database = args[++i];
    } else if (arg === "-c" || arg === "--command") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "psql: option requires an argument -- 'c'\n",
          exitCode: 1,
        };
      }
      options.command = args[++i];
    } else if (arg === "-f" || arg === "--file") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "psql: option requires an argument -- 'f'\n",
          exitCode: 1,
        };
      }
      options.file = args[++i];
    } else if (arg === "-t" || arg === "--tuples-only") {
      options.tuplesOnly = true;
    } else if (arg === "-A" || arg === "--no-align") {
      options.outputFormat = "unaligned";
    } else if (arg === "-F") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "psql: option requires an argument -- 'F'\n",
          exitCode: 1,
        };
      }
      options.fieldSeparator = args[++i];
    } else if (arg === "-R") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "psql: option requires an argument -- 'R'\n",
          exitCode: 1,
        };
      }
      options.recordSeparator = args[++i];
    } else if (arg === "--csv") {
      options.outputFormat = "csv";
    } else if (arg === "--json") {
      options.outputFormat = "json";
    } else if (arg === "-H" || arg === "--html") {
      options.outputFormat = "html";
    } else if (arg === "-q" || arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "-1" || arg === "--single-transaction") {
      options.singleTransaction = true;
    } else if (arg === "-o" || arg === "--output") {
      if (i + 1 >= args.length) {
        return {
          stdout: "",
          stderr: "psql: option requires an argument -- 'o'\n",
          exitCode: 1,
        };
      }
      options.outputFile = args[++i];
    } else if (arg.startsWith("--set=")) {
      const varDef = arg.slice(6);
      const eqIndex = varDef.indexOf("=");
      if (eqIndex === -1) {
        return {
          stdout: "",
          stderr: `psql: invalid variable definition: ${arg}\n`,
          exitCode: 1,
        };
      }
      const name = varDef.slice(0, eqIndex);
      const value = varDef.slice(eqIndex + 1);
      options.variables[name] = value;
    } else if (arg.startsWith("-")) {
      return {
        stdout: "",
        stderr: `psql: invalid option -- '${arg}'\nTry 'psql --help' for more information.\n`,
        exitCode: 1,
      };
    } else {
      // Positional argument (database name or connection string)
      if (!options.database) {
        options.database = arg;
      } else {
        return {
          stdout: "",
          stderr: `psql: too many command-line arguments (first is "${arg}")\nTry 'psql --help' for more information.\n`,
          exitCode: 1,
        };
      }
    }

    i++;
  }

  return options;
}

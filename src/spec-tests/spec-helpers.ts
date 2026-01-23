/**
 * Test helper commands for spec tests
 * These replace the Python scripts used in the original Oil shell tests
 *
 * NOTE: Standard Unix commands (tac, od, hostname) are now in src/commands/
 */

import { defineCommand } from "../custom-commands.js";
import type { Command } from "../types.js";

// argv.py - prints arguments in Python repr() format: ['arg1', "arg with '"]
// Python uses single quotes by default, double quotes when string contains single quotes
// Special characters like \n, \r, \t are escaped in repr format
export const argvCommand: Command = defineCommand("argv.py", async (args) => {
  const formatted = args.map((arg) => {
    // First escape special characters in Python repr format
    let escaped = arg
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");

    const hasSingleQuote = arg.includes("'");
    const hasDoubleQuote = arg.includes('"');

    if (hasSingleQuote && !hasDoubleQuote) {
      // Use double quotes when string contains single quotes but no double quotes
      return `"${escaped}"`;
    }
    // Default: use single quotes (escape single quotes)
    escaped = escaped.replace(/'/g, "\\'");
    return `'${escaped}'`;
  });
  return { stdout: `[${formatted.join(", ")}]\n`, stderr: "", exitCode: 0 };
});

// printenv.py - prints environment variable values, one per line
// Prints "None" for variables that are not set (matching Python's printenv.py)
export const printenvCommand: Command = defineCommand(
  "printenv.py",
  async (args, ctx) => {
    const output = args.map((name) => ctx.env[name] ?? "None").join("\n");
    return {
      stdout: output ? `${output}\n` : "",
      stderr: "",
      exitCode: 0,
    };
  },
);

// stdout_stderr.py - outputs to both stdout and stderr
// If an argument is provided, it outputs that to stdout instead of "STDOUT"
export const stdoutStderrCommand: Command = defineCommand(
  "stdout_stderr.py",
  async (args) => {
    const stdout = args.length > 0 ? `${args[0]}\n` : "STDOUT\n";
    return { stdout, stderr: "STDERR\n", exitCode: 0 };
  },
);

// read_from_fd.py - reads from specified file descriptors
// Arguments are FD numbers. For each FD, outputs "<fd>: <content>" (without trailing newline from content)
export const readFromFdCommand: Command = defineCommand(
  "read_from_fd.py",
  async (args, ctx) => {
    const results: string[] = [];

    for (const arg of args) {
      const fd = Number.parseInt(arg, 10);
      if (Number.isNaN(fd)) {
        continue;
      }

      let content = "";
      if (fd === 0) {
        // FD 0 is stdin
        content = ctx.stdin || "";
      } else if (ctx.fileDescriptors) {
        // Other FDs from the fileDescriptors map
        content = ctx.fileDescriptors.get(fd) || "";
      }

      // Remove trailing newline from content for the output format
      const trimmedContent = content.replace(/\n$/, "");
      results.push(`${fd}: ${trimmedContent}`);
    }

    return {
      stdout: results.length > 0 ? `${results.join("\n")}\n` : "",
      stderr: "",
      exitCode: 0,
    };
  },
);

/** All test helper commands (Python script replacements) */
export const testHelperCommands: Command[] = [
  argvCommand,
  printenvCommand,
  stdoutStderrCommand,
  readFromFdCommand,
];

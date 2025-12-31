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
export const argvCommand: Command = defineCommand("argv.py", async (args) => {
  const formatted = args.map((arg) => {
    const hasSingleQuote = arg.includes("'");
    const hasDoubleQuote = arg.includes('"');

    if (hasSingleQuote && !hasDoubleQuote) {
      // Use double quotes when string contains single quotes but no double quotes
      const escaped = arg.replace(/\\/g, "\\\\");
      return `"${escaped}"`;
    }
    // Default: use single quotes (escape single quotes and backslashes)
    const escaped = arg.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
export const stdoutStderrCommand: Command = defineCommand(
  "stdout_stderr.py",
  async () => {
    return { stdout: "STDOUT\n", stderr: "STDERR\n", exitCode: 0 };
  },
);

// read_from_fd.py - reads from a file descriptor (simplified - reads from stdin)
export const readFromFdCommand: Command = defineCommand(
  "read_from_fd.py",
  async (args, ctx) => {
    // In real bash, this reads from a specific FD. Here we just return stdin or empty.
    const fd = args[0] || "0";
    if (fd === "0" && ctx.stdin) {
      return { stdout: ctx.stdin, stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  },
);

/** All test helper commands (Python script replacements) */
export const testHelperCommands: Command[] = [
  argvCommand,
  printenvCommand,
  stdoutStderrCommand,
  readFromFdCommand,
];

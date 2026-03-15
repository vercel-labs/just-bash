/**
 * ps - report a snapshot of the current processes.
 *
 * Displays virtual process information from the interpreter's job table.
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";

export const psCommand: Command = {
  name: "ps",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    // Parse flags
    let showAll = false;
    for (const arg of args) {
      if (arg === "-e" || arg === "-A" || arg === "aux" || arg === "-ef") {
        showAll = true;
      }
      if (arg === "--help") {
        return {
          stdout:
            "Usage: ps [options]\n\nOptions:\n  -e, -A  Select all processes\n  --help  Display this help\n",
          stderr: "",
          exitCode: 0,
        };
      }
    }

    // Build output
    let output = "  PID TTY          TIME CMD\n";

    // Always show the shell process
    output += "    1 ?        00:00:00 bash\n";

    // Show background jobs from the process table
    const processTable = ctx.processTable ?? [];
    for (const entry of processTable) {
      if (!showAll && entry.status !== "Running") continue;
      const pid = String(entry.pid).padStart(5);
      output += `${pid} ?        00:00:00 ${entry.command}\n`;
    }

    return { stdout: output, stderr: "", exitCode: 0 };
  },
};

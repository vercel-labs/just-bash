/**
 * jobs builtin - list background jobs.
 *
 * Usage:
 *   jobs        - List all jobs
 *   jobs -l     - List with PIDs
 *   jobs -p     - List PIDs only
 *   jobs -r     - List running jobs only
 *   jobs -s     - List stopped jobs only
 */

import type { ExecResult } from "../../types.js";
import { OK, success } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleJobs(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  const jobTable = ctx.state.jobTable;
  if (!jobTable || jobTable.size === 0) {
    return OK;
  }

  // Parse flags
  let showPids = false;
  let pidsOnly = false;
  let runningOnly = false;
  let stoppedOnly = false;

  for (const arg of args) {
    if (arg.startsWith("-")) {
      for (const char of arg.slice(1)) {
        if (char === "l") showPids = true;
        else if (char === "p") pidsOnly = true;
        else if (char === "r") runningOnly = true;
        else if (char === "s") stoppedOnly = true;
      }
    }
  }

  let output = "";
  for (const [, job] of jobTable) {
    // Apply filters
    if (runningOnly && job.status !== "Running") continue;
    if (stoppedOnly && job.status !== "Stopped") continue;

    if (pidsOnly) {
      output += `${job.pid}\n`;
    } else if (showPids) {
      const statusStr = padRight(job.status, 20);
      output += `[${job.jobId}]+  ${job.pid} ${statusStr} ${job.command} &\n`;
    } else {
      const statusStr = padRight(job.status, 20);
      output += `[${job.jobId}]+  ${statusStr} ${job.command} &\n`;
    }
  }

  return success(output);
}

function padRight(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - s.length));
}

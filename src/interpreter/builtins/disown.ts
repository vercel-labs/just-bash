/**
 * disown builtin - remove jobs from the job table.
 *
 * Usage:
 *   disown       - Remove most recent job
 *   disown %N    - Remove job N
 *   disown -a    - Remove all jobs
 */

import type { ExecResult } from "../../types.js";
import { failure, OK } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleDisown(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  const jobTable = ctx.state.jobTable;
  if (!jobTable || jobTable.size === 0) {
    if (
      args.length > 0 &&
      !args.includes("-a") &&
      !args.includes("-h") &&
      !args.includes("-r")
    ) {
      return failure("bash: disown: current: no such job\n");
    }
    return OK;
  }

  // disown -a: remove all
  if (args.includes("-a")) {
    jobTable.clear();
    return OK;
  }

  // disown %N: remove specific
  if (args.length > 0) {
    for (const arg of args) {
      if (arg === "-h" || arg === "-r") continue;
      if (arg.startsWith("%")) {
        const jobNum = Number.parseInt(arg.slice(1), 10);
        if (!jobTable.has(jobNum)) {
          return failure(`bash: disown: ${arg}: no such job\n`);
        }
        jobTable.delete(jobNum);
      } else {
        // Try as PID
        const pid = Number.parseInt(arg, 10);
        if (Number.isNaN(pid)) {
          return failure(`bash: disown: ${arg}: no such job\n`);
        }
        let found = false;
        for (const [id, job] of jobTable) {
          if (job.pid === pid) {
            jobTable.delete(id);
            found = true;
            break;
          }
        }
        if (!found) {
          return failure(`bash: disown: ${arg}: no such job\n`);
        }
      }
    }
    return OK;
  }

  // disown (no args): remove most recent job (highest job ID)
  let maxId = 0;
  for (const id of jobTable.keys()) {
    if (id > maxId) maxId = id;
  }
  if (maxId > 0) {
    jobTable.delete(maxId);
  }
  return OK;
}

/**
 * fg/bg - not supported in non-interactive mode.
 */
export function handleFg(): ExecResult {
  return failure("bash: fg: no job control\n");
}

export function handleBg(): ExecResult {
  return failure("bash: bg: no job control\n");
}

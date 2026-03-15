/**
 * kill builtin - send signals to background jobs.
 *
 * Usage:
 *   kill PID     - Terminate job by PID
 *   kill %N      - Terminate job by job number
 *   kill -0 PID  - Check if process exists
 *   kill -l      - List signal names
 */

import type { ExecResult } from "../../types.js";
import { failure, OK, success } from "../helpers/result.js";
import type { InterpreterContext, Job } from "../types.js";

const SIGNAL_NAMES: Record<string, number> = Object.assign(
  Object.create(null) as Record<string, number>,
  {
    HUP: 1,
    INT: 2,
    QUIT: 3,
    ILL: 4,
    TRAP: 5,
    ABRT: 6,
    BUS: 7,
    FPE: 8,
    KILL: 9,
    USR1: 10,
    SEGV: 11,
    USR2: 12,
    PIPE: 13,
    ALRM: 14,
    TERM: 15,
    STKFLT: 16,
    CHLD: 17,
    CONT: 18,
    STOP: 19,
    TSTP: 20,
    TTIN: 21,
    TTOU: 22,
    URG: 23,
    XCPU: 24,
    XFSZ: 25,
    VTALRM: 26,
    PROF: 27,
    WINCH: 28,
    IO: 29,
    PWR: 30,
    SYS: 31,
  },
);

export function handleKill(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  if (args.length === 0) {
    return failure(
      "kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n",
    );
  }

  // kill -l: list signals
  if (args[0] === "-l" || args[0] === "-L") {
    const names = Object.keys(SIGNAL_NAMES);
    let output = "";
    for (let i = 0; i < names.length; i++) {
      const num = SIGNAL_NAMES[names[i]];
      output += `${String(num).padStart(2)}) SIG${names[i]}`;
      output += (i + 1) % 5 === 0 ? "\n" : "\t";
    }
    if (!output.endsWith("\n")) output += "\n";
    return success(output);
  }

  // Parse signal
  let signal = 15; // SIGTERM default
  let signalCheck = false;
  let argStart = 0;

  if (args[0].startsWith("-")) {
    const sigArg = args[0].slice(1);
    if (sigArg === "0") {
      signalCheck = true;
      argStart = 1;
    } else if (sigArg === "s" && args.length > 1) {
      const name = args[1].toUpperCase().replace(/^SIG/, "");
      if (Object.hasOwn(SIGNAL_NAMES, name)) {
        signal = SIGNAL_NAMES[name];
      }
      argStart = 2;
    } else {
      // -N or -SIGNAME
      const num = Number.parseInt(sigArg, 10);
      if (!Number.isNaN(num)) {
        signal = num;
        signalCheck = signal === 0;
      } else {
        const name = sigArg.toUpperCase().replace(/^SIG/, "");
        if (Object.hasOwn(SIGNAL_NAMES, name)) {
          signal = SIGNAL_NAMES[name];
        }
      }
      argStart = 1;
    }
  }

  if (argStart >= args.length) {
    return failure(
      "kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ...\n",
    );
  }

  const jobTable = ctx.state.jobTable;
  let exitCode = 0;
  let stderr = "";

  for (let i = argStart; i < args.length; i++) {
    const target = args[i];
    let job: Job | undefined;

    if (target.startsWith("%")) {
      // Job spec
      const jobNum = Number.parseInt(target.slice(1), 10);
      job = jobTable?.get(jobNum);
      if (!job) {
        stderr += `bash: kill: ${target}: no such job\n`;
        exitCode = 1;
        continue;
      }
    } else {
      // PID
      const pid = Number.parseInt(target, 10);
      if (Number.isNaN(pid)) {
        stderr += `bash: kill: ${target}: arguments must be process or job IDs\n`;
        exitCode = 1;
        continue;
      }
      job = findJobByPid(jobTable, pid);
      if (!job) {
        stderr += `bash: kill: (${pid}) - No such process\n`;
        exitCode = 1;
        continue;
      }
    }

    if (signalCheck) {
      // kill -0: just check existence — job found, so success
      continue;
    }

    // Abort the job
    if (job.status === "Running") {
      job.abortController.abort();
      job.status = "Terminated";
      job.exitCode = 128 + signal;
    }
  }

  if (stderr) {
    return { stdout: "", stderr, exitCode };
  }
  return OK;
}

function findJobByPid(
  jobTable: Map<number, Job> | undefined,
  pid: number,
): Job | undefined {
  if (!jobTable) return undefined;
  for (const [, job] of jobTable) {
    if (job.pid === pid) return job;
  }
  return undefined;
}

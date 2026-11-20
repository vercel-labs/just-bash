import { BoundedStringBuilder } from "../../bounded-builder.js";
import type { ExecResult } from "../../types.js";
import { failure, success } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

const signals = new Map<number, string>([
  ...[
    "HUP",
    "INT",
    "QUIT",
    "ILL",
    "TRAP",
    "ABRT",
    "BUS",
    "FPE",
    "KILL",
    "USR1",
    "SEGV",
    "USR2",
    "PIPE",
    "ALRM",
    "TERM",
    "STKFLT",
    "CHLD",
    "CONT",
    "STOP",
    "TSTP",
    "TTIN",
    "TTOU",
    "URG",
    "XCPU",
    "XFSZ",
    "VTALRM",
    "PROF",
    "WINCH",
    "IO",
    "PWR",
    "SYS",
  ].map((name, i): [number, string] => [i + 1, name]),
  ...Array.from({ length: 31 }, (_, i): [number, string] => [
    i + 34,
    i === 0
      ? "RTMIN"
      : i === 30
        ? "RTMAX"
        : i <= 15
          ? `RTMIN+${i}`
          : `RTMAX-${30 - i}`,
  ]),
]);
const usage =
  "kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n";

function signalNumber(value: string): number | undefined {
  if (/^[0-9]+$/.test(value)) {
    const number = Number(value);
    return number === 0 || signals.has(number) ? number : undefined;
  }
  const normalized = value.toUpperCase().replace(/^SIG/, "");
  if (normalized === "EXIT") return 0;
  return [...signals].find(([, name]) => name === normalized)?.[0];
}

export function handleKill(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  const limit = Math.min(ctx.limits.maxOutputSize, ctx.limits.maxStringLength);
  const stdout = new BoundedStringBuilder(limit, "kill");
  const stderr = new BoundedStringBuilder(limit, "kill");
  const checkpoint = () => {
    ctx.executionScope.throwIfAborted("kill");
    ctx.executionScope.consumeWork(1, "kill");
  };
  if (args[0] === "-l" || args[0] === "-L") {
    if (args.length === 1) {
      const entries = [...signals].map(
        ([number, name]) => `${String(number).padStart(2, " ")}) SIG${name}`,
      );
      return success(
        `${entries
          .map((entry, i) => `${entry}${(i + 1) % 5 === 0 ? "\n" : "\t"}`)
          .join("")}\n`,
      );
    }
    for (const value of args.slice(1)) {
      checkpoint();
      const numeric = /^[0-9]+$/.test(value);
      const number = numeric
        ? Number(value) > 128
          ? Number(value) - 128
          : Number(value)
        : signalNumber(value);
      const name =
        number === 0
          ? "EXIT"
          : number === undefined
            ? undefined
            : signals.get(number);
      if (!name)
        stderr.append(`bash: kill: ${value}: invalid signal specification\n`);
      else stdout.append(`${numeric ? name : number}\n`);
    }
    const errors = stderr.build();
    return { stdout: stdout.build(), stderr: errors, exitCode: errors ? 1 : 0 };
  }
  let signal = 15;
  let index = 0;
  if (args[0] === "-s" || args[0] === "-n") {
    if (args[1] === undefined) return failure(usage, 2);
    const parsed = signalNumber(args[1]);
    if (parsed === undefined)
      return failure(`bash: kill: ${args[1]}: invalid signal specification\n`);
    signal = parsed;
    index = 2;
  } else if (args[0]?.startsWith("-") && args[0] !== "--") {
    const parsed = signalNumber(args[0].slice(1));
    if (parsed === undefined)
      return failure(
        `bash: kill: ${args[0].slice(1)}: invalid signal specification\n`,
      );
    signal = parsed;
    index++;
  }
  if (args[index] === "--") index++;
  if (index === args.length) return failure(usage, 2);
  for (const pid of args.slice(index)) {
    checkpoint();
    if (!/^[+-]?[0-9]+$/.test(pid)) {
      stderr.append(
        pid.startsWith("%")
          ? `bash: kill: ${pid}: no such job\n`
          : `bash: kill: ${pid}: arguments must be process or job IDs\n`,
      );
      continue;
    }
    const id = Number(pid);
    const own = id === ctx.state.virtualPid || id === ctx.state.bashPid;
    if (signal === 0 && own) continue;
    stderr.append(
      own
        ? `bash: kill: (${pid}): signal delivery is unavailable in this interpreter\n`
        : `bash: kill: (${pid}) - No such process\n`,
    );
  }
  const errors = stderr.build();
  return { stdout: "", stderr: errors, exitCode: errors ? 1 : 0 };
}

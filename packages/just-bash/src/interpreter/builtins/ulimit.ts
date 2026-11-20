import type { ExecResult } from "../../types.js";
import { failure, success } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

// Bash 5.2's Linux labels and columns. Only open files has an equivalent
// interpreter limit; wall time, heap budgets and command counts are not rlimits.
const resources: ReadonlyArray<readonly [string, string, string]> = [
  ["R", "real-time non-blocking time", "  (microseconds, -R)"],
  ["c", "core file size", "              (blocks, -c)"],
  ["d", "data seg size", "               (kbytes, -d)"],
  ["e", "scheduling priority", "                 (-e)"],
  ["f", "file size", "                   (blocks, -f)"],
  ["i", "pending signals", "                     (-i)"],
  ["l", "max locked memory", "           (kbytes, -l)"],
  ["m", "max memory size", "             (kbytes, -m)"],
  ["n", "open files", "                          (-n)"],
  ["p", "pipe size", "                (512 bytes, -p)"],
  ["q", "POSIX message queues", "         (bytes, -q)"],
  ["r", "real-time priority", "                  (-r)"],
  ["s", "stack size", "                  (kbytes, -s)"],
  ["t", "cpu time", "                   (seconds, -t)"],
  ["u", "max user processes", "                  (-u)"],
  ["v", "virtual memory", "              (kbytes, -v)"],
  ["x", "file locks", "                          (-x)"],
];

export function handleUlimit(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  const selected = new Set<string>();
  let all = false;
  let index = 0;
  let limit: string | undefined;
  options: for (; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      index++;
      break;
    }
    if (!arg.startsWith("-") || arg === "-") break;
    for (let position = 1; position < arg.length; position++) {
      const option = arg[position];
      if (option === "S" || option === "H") continue;
      if (option === "a") all = true;
      else if (resources.some(([key]) => key === option)) {
        selected.add(option);
        if (position + 1 < arg.length) {
          limit = arg.slice(position + 1);
          index++;
          break options;
        }
      } else
        return failure(
          `bash: ulimit: -${option}: invalid option\nulimit: usage: ulimit [-SHabcdefiklmnpqrstuvxPRT] [limit]\n`,
          2,
        );
    }
  }
  if (!selected.size) selected.add("f");
  const rows = resources.filter(([key]) => all || selected.has(key));
  if (limit !== undefined || index < args.length) {
    if (args.length - index > (limit === undefined ? 1 : 0))
      return failure("bash: ulimit: too many arguments\n");
    limit ??= args[index];
    if (
      !/^[0-9]+$/.test(limit) &&
      !["unlimited", "soft", "hard"].includes(limit)
    )
      return failure(`bash: ulimit: ${limit}: invalid number\n`);
    return failure(
      `bash: ulimit: ${rows[0][1]}: cannot modify limit: Operation not permitted\n`,
    );
  }
  return success(
    rows
      .map(([key, label, suffix]) => {
        const value =
          key === "n" && Number.isFinite(ctx.limits.maxFileDescriptors)
            ? String(ctx.limits.maxFileDescriptors)
            : "unlimited";
        return `${all || rows.length > 1 ? `${label}${suffix} ` : ""}${value}\n`;
      })
      .join(""),
  );
}

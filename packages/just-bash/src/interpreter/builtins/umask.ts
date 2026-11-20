import { parseFileMode } from "../../commands/file-mode.js";
import type { ExecResult } from "../../types.js";
import { failure, OK, success } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export function handleUmask(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  let symbolic = false;
  let reusable = false;
  let index = 0;
  for (; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      index++;
      break;
    }
    if (!arg.startsWith("-") || arg === "-") break;
    for (const option of arg.slice(1)) {
      if (option === "S") symbolic = true;
      else if (option === "p") reusable = true;
      else
        return failure(
          `bash: umask: -${option}: invalid option\numask: usage: umask [-p] [-S] [mode]\n`,
          2,
        );
    }
  }
  const mode = args[index];
  const mask = ctx.state.fileCreationMask ?? 0o022;
  if (mode !== undefined) {
    try {
      if (/^[0-9]/.test(mode)) {
        if (!/^[0-7]+$/.test(mode))
          return failure(`bash: umask: ${mode}: octal number out of range\n`);
        const parsed = Number.parseInt(mode, 8);
        if (!Number.isSafeInteger(parsed))
          return failure(`bash: umask: ${mode}: octal number out of range\n`);
        ctx.state.fileCreationMask = parsed & 0o777;
      } else {
        ctx.state.fileCreationMask =
          ~parseFileMode(mode, ~mask & 0o777, true) & 0o777;
      }
      return OK;
    } catch {
      return failure(
        `bash: umask: \`${mode}': invalid symbolic mode operator\n`,
      );
    }
  }
  if (!symbolic)
    return success(
      `${reusable ? "umask " : ""}${mask.toString(8).padStart(4, "0")}\n`,
    );
  const fields = ["u", "g", "o"].map((who, i) => {
    const allowed = (~mask >> (6 - 3 * i)) & 7;
    return `${who}=${allowed & 4 ? "r" : ""}${allowed & 2 ? "w" : ""}${allowed & 1 ? "x" : ""}`;
  });
  return success(`${reusable ? "umask -S " : ""}${fields.join(",")}\n`);
}

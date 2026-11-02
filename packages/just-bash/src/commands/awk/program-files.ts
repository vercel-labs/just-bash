// Automa modifications: patch-awk-program-files.mjs uses original workspace ports.
import { decodeBytesToUtf8, utf8ByteLength } from "../../encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { RuntimeCommandContext } from "../../types.js";

export async function readProgramFiles(
  files: string[],
  command: RuntimeCommandContext,
  withDefenseContext: <T>(phase: string, op: () => Promise<T>) => Promise<T>,
): Promise<{ source: string; stdinConsumed: boolean }> {
  const limit = Math.min(
    command.limits.maxInputBytes,
    command.limits.maxStringLength,
  );
  if (files.length > command.limits.maxArrayElements)
    throw new ExecutionLimitError(
      "awk program file count limit exceeded",
      "array_elements",
    );
  let source = "",
    size = 0,
    stdinConsumed = false;
  for (const name of files) {
    let text: string;
    if (name === "-") {
      text = stdinConsumed ? "" : decodeBytesToUtf8(command.stdin);
      stdinConsumed = true;
    } else {
      const path = command.fs.resolvePath(command.cwd, name);
      const stat = await withDefenseContext("program file stat", () =>
        command.fs.stat(path),
      );
      if (stat.size > limit - size)
        throw new ExecutionLimitError(
          `awk program size limit exceeded (${limit} bytes)`,
          "string_length",
        );
      text = await withDefenseContext("program file read", () =>
        command.fs.readFile(path),
      );
    }
    const added = utf8ByteLength(text) + (source.length ? 1 : 0);
    if (added > limit - size)
      throw new ExecutionLimitError(
        `awk program size limit exceeded (${limit} bytes)`,
        "string_length",
      );
    source += (source.length ? "\n" : "") + text;
    size += added;
  }
  return { source, stdinConsumed };
}

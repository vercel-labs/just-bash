/**
 * Flag-Driven Fuzzer Generator
 *
 * Consumes CommandFuzzInfo metadata from command files to automatically
 * generate commands with random flag subsets and appropriate arguments.
 * This covers all ~70 commands without hand-coded generators.
 */

import fc from "fast-check";
import {
  type CommandFuzzInfo,
  getAllCommandFuzzInfo,
} from "../../../commands/fuzz-flags.js";
import { simpleWord } from "./grammar-generator.js";

function generateValue(hint?: string): fc.Arbitrary<string> {
  switch (hint) {
    case "number":
      return fc.integer({ min: 1, max: 20 }).map(String);
    case "path":
      return fc.constantFrom("/tmp", ".", "/home/user");
    case "pattern":
      return simpleWord;
    case "delimiter":
      return fc.constantFrom(",", ":", "|", " ");
    case "format":
      return simpleWord;
    default:
      return simpleWord;
  }
}

function defaultValue(hint?: string): string {
  switch (hint) {
    case "number":
      return "3";
    case "path":
      return "/tmp";
    case "pattern":
      return "test";
    case "delimiter":
      return ",";
    case "format":
      return "%s";
    default:
      return "val";
  }
}

function generateStdin(info: CommandFuzzInfo): string {
  if (info.stdinType === "json") return `echo '{"a":1,"b":"test"}' | `;
  if (info.stdinType === "text") return `echo "hello world\\nfoo bar\\nbaz" | `;
  return "";
}

function appendArgs(info: CommandFuzzInfo, parts: string[]): void {
  if (info.needsFiles) {
    parts.push("file.txt");
  } else if (info.needsArgs) {
    const min = info.minArgs ?? 1;
    for (let i = 0; i < min; i++) parts.push(`arg${i}`);
  }
}

function makeGenerator(info: CommandFuzzInfo): fc.Arbitrary<string> {
  const bools = info.flags.filter((f) => f.type === "boolean");
  const vals = info.flags.filter((f) => f.type === "value");
  const stdin = generateStdin(info);

  return fc
    .tuple(
      fc.subarray(
        bools.map((f) => f.flag),
        { minLength: 0 },
      ),
      fc.subarray(vals, { minLength: 0, maxLength: Math.min(2, vals.length) }),
    )
    .chain(([boolFlags, valueFlags]) => {
      if (valueFlags.length === 0) {
        return fc.constant(boolFlags as string[]);
      }
      return fc
        .tuple(
          ...valueFlags.map((f) =>
            generateValue(f.valueHint).map((v) => [f.flag, v]),
          ),
        )
        .map((pairs) => [...boolFlags, ...(pairs as string[][]).flat()]);
    })
    .map((flags) => {
      const parts = [stdin + info.name, ...flags];
      appendArgs(info, parts);
      return parts.join(" ");
    });
}

/** Builds a deterministic command string exercising ALL flags for a command */
function buildAllFlagsCommand(info: CommandFuzzInfo): string {
  const stdin = generateStdin(info);
  const flags: string[] = [];
  for (const f of info.flags) {
    flags.push(f.flag);
    if (f.type === "value") {
      flags.push(defaultValue(f.valueHint));
    }
  }
  // 'time' is a shell keyword parsed before command dispatch;
  // use 'command time' to force it through the command registry.
  const cmd = info.name === "time" ? "command time" : info.name;
  const parts = [stdin + cmd, ...flags];
  appendArgs(info, parts);
  return parts.join(" ");
}

const allFlagInfos = getAllCommandFuzzInfo().filter((i) => i.flags.length > 0);

// Pre-compute batched scripts that exercise all flags for groups of commands.
// Use large batches so few batches exist and all get picked within numRuns.
const flagBatches: string[] = [];
for (let i = 0; i < allFlagInfos.length; i += 20) {
  flagBatches.push(
    allFlagInfos
      .slice(i, i + 20)
      .map(buildAllFlagsCommand)
      .join("\n"),
  );
}

/** Generates commands from all commands that have flags defined */
export const flagDrivenCommand: fc.Arbitrary<string> = fc.oneof(
  ...getAllCommandFuzzInfo()
    .filter((info) => info.flags.length > 0)
    .map((info) => ({ weight: 1, arbitrary: makeGenerator(info) })),
);

/** Generates batch scripts exercising all flags for groups of commands */
export const flagBatchCommand: fc.Arbitrary<string> = fc.constantFrom(
  ...flagBatches,
);

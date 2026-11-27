import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import {
  encodeUtf8ToBytes,
  latin1FromBytes,
  unsafeBytesFromLatin1,
} from "../../encoding.js";

describe("rg streaming stdin", () => {
  it("propagates downstream closure through a stdin search", async () => {
    let produced = 0;
    const produce = defineCommand(
      "produce",
      async (_args, ctx) => {
        if (!ctx.stdio) throw new Error("Expected streaming stdio");
        for (let i = 0; i < 10000; i++) {
          await ctx.stdio.write(
            encodeUtf8ToBytes(`needle ${i} ${"x".repeat(1000)}\n`),
          );
          produced++;
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { streaming: true },
    );
    const result = await new Bash({ customCommands: [produce] }).exec(
      "produce | rg --no-line-number needle | head -n 1",
    );
    expect(result).toMatchObject({
      stdout: `needle 0 ${"x".repeat(1000)}\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(produced).toBeLessThan(10000);
  });

  it.each([
    "-n 'שלום|😀'",
    "--no-line-number -v other",
    "-n '^$'",
    "-C 1 שלום",
    "-c שלום",
    "-o שלום",
    "-U 'other\nשלום'",
  ])("preserves stdin results across UTF-8 chunk boundaries: %s", async (flags) => {
    const input = "other\nשלום\n\n😀 שלום\r\nשלום";
    const bytes = latin1FromBytes(encodeUtf8ToBytes(input));
    const produce = defineCommand(
      "produce",
      async (_args, ctx) => {
        if (!ctx.stdio) return { stdout: input, stderr: "", exitCode: 0 };
        for (const byte of bytes)
          await ctx.stdio.write(unsafeBytesFromLatin1(byte));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { streaming: true },
    );
    const bash = new Bash({ customCommands: [produce] });
    const full = await bash.exec(`rg ${flags}`, { stdin: input });
    expect(
      await bash.exec(`set -o pipefail; produce | rg ${flags} | cat`),
    ).toMatchObject({
      stdout: full.stdout,
      stderr: full.stderr,
      exitCode: full.exitCode,
    });
  });
  it.each([
    "prefix\n\ufeffneedle\n",
    "\ufeffneedle\n",
    "needle café\n\xff\n",
  ])("preserves whole-input decoding for BOM and mixed encodings: %j", async (input) => {
    const raw = input.includes("\xff")
      ? `${latin1FromBytes(encodeUtf8ToBytes(input.slice(0, -2)))}\xff\n`
      : latin1FromBytes(encodeUtf8ToBytes(input));
    const produce = defineCommand(
      "produce",
      async (_args, ctx) => {
        if (!ctx.stdio) throw new Error("Expected stdio");
        for (const byte of raw)
          await ctx.stdio.write(unsafeBytesFromLatin1(byte));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { streaming: true },
    );
    const bash = new Bash({ customCommands: [produce] });
    // -A 1 selects the existing buffered matcher without changing output
    // when every line matches.
    const full = await bash.exec("produce | rg --no-line-number -A 1 '.'");
    const streaming = await bash.exec("produce | rg --no-line-number '.'");
    expect(streaming).toMatchObject({
      stdout: full.stdout,
      stderr: full.stderr,
      exitCode: full.exitCode,
    });
  });
});

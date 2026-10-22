import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";
import { encodeUtf8ToBytes } from "../encoding.js";

describe("streaming pipeline glob arguments", () => {
  it("stops a globbed producer after downstream closure", async () => {
    const producer = defineCommand(
      "producer",
      async (args, ctx) => {
        if (!ctx.stdio) throw new Error("Expected streaming I/O");
        for (;;)
          await ctx.stdio.write(encodeUtf8ToBytes(`${args.join(":")}\n`));
      },
      { streaming: true },
    );
    const bash = new Bash({
      files: { "/a.txt": "a\n", "/b.txt": "b\n" },
      customCommands: [producer],
      executionLimits: { maxOutputSize: 32 },
    });
    expect(await bash.exec("producer /*.txt | head -n 1")).toMatchObject({
      stdout: "/a.txt:/b.txt\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves sorted matches, duplicate operands and quoted globs", async () => {
    const bash = new Bash({
      files: { "/b.txt": "b\n", "/a.txt": "a\n", "/star*": "star\n" },
    });
    expect(await bash.exec("cat /*.txt /a.txt '/star*' | cat")).toMatchObject({
      stdout: "a\nb\na\nstar\n",
      stderr: "",
      exitCode: 0,
    });
    expect(
      await bash.exec("shopt -s nullglob; cat /missing* /a.txt | cat"),
    ).toMatchObject({ stdout: "a\n", stderr: "", exitCode: 0 });
  });

  it("captures substitutions inside glob patterns before piping file contents", async () => {
    const bash = new Bash({ files: { "/1.txt": "one\n", "/2.txt": "two\n" } });
    for (const pattern of ["/@($(seq 1)).txt", "/@(`seq 1`).txt"]) {
      expect(
        await bash.exec(`shopt -s extglob; cat ${pattern} | cat`),
      ).toMatchObject({
        stdout: "one\n",
        stderr: "",
        exitCode: 0,
      });
    }
  });
});

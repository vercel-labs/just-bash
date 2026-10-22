import { describe, expect, it, vi } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";

describe("for-loop pipeline producers", () => {
  it("stops before reading later loop inputs", async () => {
    const fs = new InMemoryFs(
      Object.fromEntries(
        Array.from({ length: 1000 }, (_, i) => [
          `/f${String(i).padStart(4, "0")}`,
          `${i}\n`,
        ]),
      ),
    );
    const reads = vi.spyOn(fs, "readFileBuffer");
    expect(
      await new Bash({ fs }).exec(
        'for f in /f*; do cat "$f"; done | head -n 1',
      ),
    ).toMatchObject({ stdout: "0\n", stderr: "", exitCode: 0 });
    expect(reads.mock.calls.length).toBeLessThan(1000);
  });
  it.each([
    'for f in a b c; do echo "$f"; done',
    'for f in a b c; do echo "$f"; continue; echo bad; done',
    'for f in a b c; do echo "$f"; break; done',
    "for f in a b c; do { echo hidden; } > /out; cat /out; done",
  ])("preserves complete output and state: %s", async (script) => {
    const expected = await new Bash().exec(script);
    expect(
      await new Bash().exec(`f=original; ${script} | cat; echo "$f"`),
    ).toMatchObject({
      stdout: `${expected.stdout}original\n`,
      stderr: expected.stderr,
      exitCode: 0,
    });
  });

  it("fully consumes more than 64 loop statements with defense enabled", async () => {
    const words = Array(80).fill("x").join(" ");
    expect(
      await new Bash().exec(`for i in ${words}; do echo ok; done | cat`),
    ).toMatchObject({
      stdout: "ok\n".repeat(80),
      stderr: "",
      exitCode: 0,
    });
  });

  it("contains exit and errexit within the producer stage", async () => {
    for (const command of ["exit 7", "false"]) {
      expect(
        await new Bash().exec(
          `set -e; for i in a; do ${command}; done | cat; echo survived`,
        ),
      ).toMatchObject({
        stdout: "survived\n",
        stderr: "",
        exitCode: 0,
      });
    }
  });

  it.each([
    "echo err >&2; echo out",
    "{ echo err >&2; echo out; break; }",
    "{ echo err >&2; echo out; continue; }",
    "{ echo err >&2; echo out; exit 7; }",
  ])("retains diagnostics on a closed pipe: %s", async (body) => {
    expect(
      await new Bash().exec(`for i in a; do ${body}; done | head -n 0`),
    ).toMatchObject({
      stdout: "",
      stderr: "err\n",
      exitCode: 0,
    });
  });
});

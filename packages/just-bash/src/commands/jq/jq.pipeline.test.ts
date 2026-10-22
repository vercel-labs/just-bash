import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import { jqCommand } from "./jq.js";

describe("jq per-input pipeline output", () => {
  it.each([
    false,
    true,
  ])("stops reading later batches when head closes (direct registration: %s)", async (direct) => {
    const fs = new InMemoryFs(
      Object.fromEntries(
        Array.from({ length: 1000 }, (_, i) => [`/f${i}.json`, `{"id":${i}}`]),
      ),
    );
    const bash = new Bash({ fs, customCommands: direct ? [jqCommand] : [] });
    await bash.exec("head -n 1 /f0.json");
    const reads = vi.spyOn(fs, "readFileBuffer");
    const result = await bash.exec(
      `jq -r .id ${Array.from({ length: 1000 }, (_, i) => `/f${i}.json`).join(" ")} | head -n 1`,
    );
    expect(result).toMatchObject({ stdout: "0\n", stderr: "", exitCode: 0 });
    expect(reads.mock.calls.length).toBeGreaterThan(0);
    expect(reads.mock.calls.length).toBeLessThan(1000);
  });

  it.each([
    "-r .id",
    "-cs .",
    "-R .",
    "-Rs .",
    "-j .id",
    "-n 42",
  ])("preserves all results for %s", async (filter) => {
    const files = { "/a": '{"id":"é"}\n{"id":2}\n', "/b": '{"id":3}\n' };
    const expected = await new Bash({ files }).exec(`jq ${filter} /a /b`);
    expect(
      await new Bash({ files }).exec(
        `set -o pipefail; jq ${filter} /a /b | cat`,
      ),
    ).toMatchObject({
      stdout: expected.stdout,
      stderr: expected.stderr,
      exitCode: expected.exitCode,
    });
  });
  it("reads piped stdin and preserves file failures", async () => {
    expect(await new Bash().exec("seq 3 | jq -c . | cat")).toMatchObject({
      stdout: "1\n2\n3\n",
      stderr: "",
      exitCode: 0,
    });
    expect(
      await new Bash().exec("set -o pipefail; jq . /missing | cat"),
    ).toMatchObject({
      stdout: "",
      stderr: "jq: /missing: No such file or directory\n",
      exitCode: 2,
    });
  });

  it("emits earlier files before stdin or a later file error", async () => {
    const bash = new Bash({
      files: { "/first": JSON.stringify("x".repeat(200000)) },
      executionLimits: { maxInputBytes: 1000000 },
    });
    expect(
      await bash.exec("seq 1000000000 | jq -r . /first - | head -c 1"),
    ).toMatchObject({
      stdout: "x",
      stderr: "",
      exitCode: 0,
    });
    expect(
      await new Bash({ files: { "/first": "1" } }).exec(
        "set -o pipefail; jq . /first /missing | cat",
      ),
    ).toMatchObject({
      stdout: "1\n",
      stderr: "jq: /missing: No such file or directory\n",
      exitCode: 2,
    });
  });

  it("treats a rawfile/slurpfile dash as a literal filename like native jq", async () => {
    for (const [flag, stdout] of [
      ["--rawfile", '"1\\n2\\n"\n'],
      ["--slurpfile", "[1,2]\n"],
    ]) {
      const result = await new Bash({
        cwd: "/",
        files: { "/-": "1\n2\n" },
      }).exec(`seq 3 | jq -cn ${flag} v - '$v' | cat`);
      expect(result).toMatchObject({ stdout, stderr: "", exitCode: 0 });
    }
  });

  it("preserves an empty raw value's newline inside and outside a pipeline", async () => {
    for (const suffix of ["", " | cat"]) {
      expect(
        await new Bash({ files: { "/in": '{"a":""}' } }).exec(
          `jq -r .a /in${suffix}`,
        ),
      ).toMatchObject({
        stdout: "\n",
        stderr: "",
        exitCode: 0,
      });
    }
  });
});

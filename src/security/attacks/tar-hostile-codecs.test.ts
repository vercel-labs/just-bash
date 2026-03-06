import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { assertExecResultSafe } from "../fuzzing/oracles/assertions.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "exploit-fixtures",
);

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("Tar hostile codec exploit probes", () => {
  it("rejects malformed xz/zstd payloads without extracting files", async () => {
    const env = new Bash();
    const result = await env.exec(loadFixture("tar-hostile-codecs.sh"));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "XZ_MALFORMED_REJECTED",
        "XZ_OUTPUT_EMPTY",
        "ZSTD_MALFORMED_REJECTED",
        "ZSTD_OUTPUT_EMPTY",
        "TAR_AUTODETECT_MALFORMED_REJECTED",
        "TAR_AUTODETECT_OUTPUT_EMPTY",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    assertExecResultSafe(result);
  });
});

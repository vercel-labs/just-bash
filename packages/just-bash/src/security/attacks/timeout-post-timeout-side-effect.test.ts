import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "exploit-fixtures",
);

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("timeout post-timeout side effects", () => {
  it("timed-out command does NOT execute or mutate filesystem after timeout", async () => {
    const env = new Bash();
    const result = await env.exec(
      loadFixture("timeout-post-timeout-side-effect.sh"),
    );

    // The fix: abort signal stops the timed-out command at the next
    // statement boundary, so the filesystem write never happens.
    expect(result.stdout).toBe(
      ["TIMEOUT_EXIT=124", "POST_TIMEOUT_SIDE_EFFECT_ABSENT", ""].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

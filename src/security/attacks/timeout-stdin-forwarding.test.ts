import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("timeout stdin forwarding", () => {
  it("piped stdin is forwarded to wrapped commands", async () => {
    const bash = new Bash();

    const result = await bash.exec(`
      printf "one\\ntwo\\n" | timeout 1 xargs -n 1 echo ITEM
      echo "TIMEOUT_EXIT=$?"
    `);

    expect(result.stdout).toBe("ITEM one\nITEM two\nTIMEOUT_EXIT=0\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

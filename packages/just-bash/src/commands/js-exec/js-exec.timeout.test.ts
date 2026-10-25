import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec timeout", () => {
  it(
    "lets a guest run past run 2.1.3's fixed work cap within maxJsTimeoutMs",
    { timeout: 90_000 },
    async () => {
      const bash = new Bash({
        javascript: true,
        executionLimits: { maxJsTimeoutMs: 60_000 },
      });
      // run 2.1.3 stopped every guest after 10,000 interrupt checks, about
      // 5e7 iterations of this loop, whatever maxJsTimeoutMs allowed.
      const result = await bash.exec(
        `js-exec -c "for (let i = 0; i < 1e8; i++) {} console.log('done')"`,
      );

      expect(result).toMatchObject({
        exitCode: 0,
        stderr: "",
        stdout: "done\n",
      });
    },
  );
});

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { clearCommandCache } from "../registry.js";

describe("python3 lazy load cancellation", () => {
  it(
    "keeps the shell and the command usable after a cancelled cold load",
    { timeout: 60000 },
    async () => {
      // Cold: the first python3 use in this file loads the command module and
      // starts its worker.
      clearCommandCache();
      const bash = new Bash({ python: true });

      const cancelled = await bash.exec(`
        timeout 0.001 python3 -c 'print(1)'
        echo "EXIT=$?"
        echo AFTER
      `);

      // The deadline should land during the load. If the load wins instead, the
      // same invariants must still hold.
      expect(["EXIT=124\nAFTER\n", "1\nEXIT=0\nAFTER\n"]).toContain(
        cancelled.stdout,
      );
      expect(cancelled.stderr).toBe("");
      expect(cancelled.exitCode).toBe(0);

      const later = await bash.exec("python3 -c 'print(1)'");
      expect(later.stdout).toBe("1\n");
      expect(later.stderr).toBe("");
      expect(later.exitCode).toBe(0);
    },
  );
});

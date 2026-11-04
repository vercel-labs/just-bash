import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("shift builtin", () => {
  describe("host limits", () => {
    it("should move only stored parameters above maxArrayElements", async () => {
      const env = new Bash({
        env: { "#": "5000", "1": "a", "2": "b" },
        executionLimits: { maxArrayElements: 10 },
      });
      const start = Date.now();
      const result = await env.exec(`
        shift
        echo "count=$# [$1] [\${2-U}]"
      `);
      expect(result.stdout).toBe("count=4999 [b] [U]\n");
      expect(result.stderr).toBe("");
      expect(Date.now() - start).toBeLessThan(1000);
    });

    it("should keep the existing walk below the bound", async () => {
      const defaults = new Bash({ env: { "#": "500", "1": "a" } });
      const fromDefaults = await defaults.exec(
        'shift; echo "count=$# [${2-U}]"',
      );
      expect(fromDefaults.stdout).toBe("count=499 []\n");

      const vars = Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`V${i}`, "x"]),
      );
      const largeEnv = new Bash({
        env: { ...vars, "#": "20", "1": "a" },
        executionLimits: { maxArrayElements: 10 },
      });
      const fromLargeEnv = await largeEnv.exec(
        'shift; echo "count=$# [${2-U}]"',
      );
      expect(fromLargeEnv.stdout).toBe("count=19 []\n");
    });

    it("should leave stored keys past $# alone", async () => {
      const env = new Bash({
        env: { "#": " +1000", "1": "a", "1001": "X" },
        executionLimits: { maxArrayElements: 10 },
      });
      const result = await env.exec(
        'shift; v=$@; echo "$# [${1-U}] [${1000-U}] [${1001-U}] [$v]"',
      );
      expect(result.stdout).toBe("999 [U] [U] [X] []\n");
      expect(result.stderr).toBe("");
    });

    it("should stay exact past 2 ** 53", async () => {
      const env = new Bash({
        env: {
          "#": "9007199254740993",
          "1": "a",
          "2": "b",
          "9007199254740993": "z",
        },
      });
      const result = await env.exec(`
        shift
        v=$@
        echo "$# [$v] [\${9007199254740992-U}]"
        shift 9007199254740993
        echo "rc=$? $#"
        shift 9007199254740992
        echo "rc=$? $#"
      `);
      expect(result.stdout).toBe(
        "9007199254740992 [b z] [z]\nrc=1 9007199254740992\nrc=0 0\n",
      );
      expect(result.stderr).toBe("bash: shift: shift count out of range\n");
    });
  });
});

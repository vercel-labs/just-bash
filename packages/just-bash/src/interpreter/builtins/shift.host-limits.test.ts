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

    it("should give the same result however many other variables exist", async () => {
      const script = 'shift; echo "count=$# [${2-U}]"; [ -v 2 ] || echo unset';
      const vars = Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`V${i}`, "x"]),
      );
      for (const extra of [{}, vars]) {
        const env = new Bash({
          env: { ...extra, "#": "20", "1": "a" },
          executionLimits: { maxArrayElements: 10 },
        });
        const result = await env.exec(script);
        expect(result.stdout).toBe("count=19 [U]\nunset\n");
      }

      const defaults = new Bash({ env: { "#": "500", "1": "a" } });
      const fromDefaults = await defaults.exec(script);
      expect(fromDefaults.stdout).toBe("count=499 [U]\nunset\n");
    });

    it("should not walk every slot when $# is seeded at maxArrayElements", async () => {
      const env = new Bash({ env: { "#": "1000000", "1": "a", "2": "b" } });
      const start = Date.now();
      const result = await env.exec(`
        i=0
        while [ $i -lt 2000 ]; do shift; i=$((i + 1)); done
        echo "count=$# [\${1-U}]"
      `);
      expect(result.stdout).toBe("count=998000 [U]\n");
      expect(result.stderr).toBe("");
      expect(Date.now() - start).toBeLessThan(2000);
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

    it("should keep a non numeric $# as main does", async () => {
      const env = new Bash({ env: { "#": "abc", "1": "a" } });
      const result = await env.exec(
        'shift 0; echo "rc=$? $#"; shift; echo "rc=$? $# [$1]"',
      );
      expect(result.stdout).toBe("rc=0 abc\nrc=0 0 [a]\n");
    });
  });
});

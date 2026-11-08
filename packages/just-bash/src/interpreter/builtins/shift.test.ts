import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("shift builtin", () => {
  describe("basic shift", () => {
    it("should shift positional parameters by 1", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          echo "before: $1 $2 $3"
          shift
          echo "after: $1 $2 $3"
        }
        myfunc a b c
      `);
      expect(result.stdout).toBe("before: a b c\nafter: b c \n");
    });

    it("should update $# after shift", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          echo "count: $#"
          shift
          echo "count: $#"
        }
        myfunc a b c
      `);
      expect(result.stdout).toBe("count: 3\ncount: 2\n");
    });

    it("should update $@ after shift", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          echo "args: $@"
          shift
          echo "args: $@"
        }
        myfunc a b c
      `);
      expect(result.stdout).toBe("args: a b c\nargs: b c\n");
    });
  });

  describe("shift with count", () => {
    it("should shift by specified count", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          echo "before: $1 $2 $3 $4"
          shift 2
          echo "after: $1 $2"
        }
        myfunc a b c d
      `);
      expect(result.stdout).toBe("before: a b c d\nafter: c d\n");
    });

    it("should shift all parameters", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          shift 3
          echo "count: $#"
        }
        myfunc a b c
      `);
      expect(result.stdout).toBe("count: 0\n");
    });

    it("should handle shift 0", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          shift 0
          echo "$1 $2"
        }
        myfunc a b
      `);
      expect(result.stdout).toBe("a b\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("error cases", () => {
    it("should error when shift count exceeds parameters", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          shift 5
        }
        myfunc a b c
      `);
      expect(result.stderr).toContain("shift count out of range");
      expect(result.exitCode).toBe(1);
    });

    it("should error on negative count", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          shift -1
        }
        myfunc a b
      `);
      expect(result.stderr).toContain("numeric argument required");
      expect(result.exitCode).toBe(1);
    });

    it("should error on non-numeric argument", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          shift abc
        }
        myfunc a b
      `);
      expect(result.stderr).toContain("numeric argument required");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("multiple shifts", () => {
    it("should handle consecutive shifts", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          echo $1
          shift
          echo $1
          shift
          echo $1
        }
        myfunc a b c
      `);
      expect(result.stdout).toBe("a\nb\nc\n");
    });

    it("should work in a loop", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          while [ $# -gt 0 ]; do
            echo $1
            shift
          done
        }
        myfunc x y z
      `);
      expect(result.stdout).toBe("x\ny\nz\n");
    });
  });

  describe("nested functions", () => {
    it("should only affect current function scope", async () => {
      const env = new Bash();
      const result = await env.exec(`
        outer() {
          inner() {
            shift
            echo "inner: $1"
          }
          inner x y z
          echo "outer: $1"
        }
        outer a b c
      `);
      expect(result.stdout).toBe("inner: y\nouter: a\n");
    });
  });

  describe("edge cases", () => {
    it("should work with no parameters", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          shift
        }
        myfunc
      `);
      expect(result.stderr).toContain("shift count out of range");
      expect(result.exitCode).toBe(1);
    });

    it("should work with single parameter", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          echo "before: $1"
          shift
          echo "after: $1"
        }
        myfunc only
      `);
      expect(result.stdout).toBe("before: only\nafter: \n");
    });

    it("should not build every slot when $# is seeded high", async () => {
      const env = new Bash({ env: { "#": "1000000000", "1": "a", "2": "b" } });
      const result = await env.exec(`
        shift
        echo "rc=$? count=$# [$1] [\${2-U}]"
      `);
      expect(result.stdout).toBe("rc=0 count=999999999 [b] [U]\n");
      expect(result.stderr).toBe("");
    });

    it("should leave empty slots unset when $# is seeded above the set parameters", async () => {
      const env = new Bash({ env: { "#": "3", "1": "a" } });
      const result = await env.exec(`
        while [ $# -gt 0 ]; do printf "%s," "\${1-U}"; shift; done
        echo
      `);
      expect(result.stdout).toBe("a,U,U,\n");
      expect(result.stderr).toBe("");
    });

    it("should move later parameters down across an unset one", async () => {
      const env = new Bash({ env: { "#": "4", "1": "a", "2": "b", "4": "d" } });
      const result = await env.exec(`
        shift
        echo "count=$# [$1] [\${2-U}] [$3] [\${4-U}]"
        [ -v 2 ] && echo v2
      `);
      expect(result.stdout).toBe("count=3 [b] [U] [d] [U]\n");
      expect(result.stderr).toBe("");
    });

    it("should keep each slot set or unset for a sourced file with more than nine arguments", async () => {
      const env = new Bash({
        files: {
          "/s.sh":
            'a="${9+set} ${10+set} ${11+set}"; shift; b="${8+set} ${9+set} ${10+set}"; [ "$a" = "$b" ] && echo same; echo "$# [$1] [$8]"; shift 9; echo "rc=$? $#"',
        },
      });
      const result = await env.exec("source /s.sh a b c d e f g h i j k");
      expect(result.stdout).toBe("same\n10 [b] [i]\nrc=0 1\n");
      expect(result.stderr).toBe("");
    });

    it("should treat slots up to $# as set under set -u after a shift", async () => {
      const sourced = new Bash({
        files: { "/s.sh": 'shift; echo "[$8] [$9] [${10}]"' },
      });
      const fromSource = await sourced.exec(
        "set -u; source /s.sh a b c d e f g h i j k",
      );
      expect(fromSource.stdout).toMatch(/^\[i\] \[(j)?\] \[(k)?\]\n$/);
      expect(fromSource.stderr).toBe("");

      const seeded = new Bash({ env: { "#": "3", "1": "a" } });
      const fromSeeded = await seeded.exec(
        'set -u; shift; echo "[$1] [$2]"; echo "$3"',
      );
      expect(fromSeeded.stdout).toBe("[] []\n");
      expect(fromSeeded.stderr).toBe("bash: 3: unbound variable\n");
    });
  });
});

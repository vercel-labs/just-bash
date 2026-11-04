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
        echo "rc=$? count=$# [$1] [$2]"
      `);
      expect(result.stdout).toBe("rc=0 count=999999999 [b] []\n");
      expect(result.stderr).toBe("");
    });

    it("should still count down when $# is seeded above the set parameters", async () => {
      const env = new Bash({ env: { "#": "3" } });
      const result = await env.exec(`
        n=0
        while [ $# -gt 0 ]; do n=$((n+1)); shift; done
        echo "iters=$n"
      `);
      expect(result.stdout).toBe("iters=3\n");
      expect(result.stderr).toBe("");
    });

    it("should move later parameters down across an unset one", async () => {
      const env = new Bash({ env: { "#": "4", "1": "a", "2": "b", "4": "d" } });
      const result = await env.exec(`
        shift
        echo "count=$# [$1] [$2] [$3] [$4]"
      `);
      expect(result.stdout).toBe("count=3 [b] [] [d] []\n");
      expect(result.stderr).toBe("");
    });

    it("should keep the count for a sourced file with more than nine arguments", async () => {
      const env = new Bash({
        files: { "/s.sh": 'shift; echo "$#"; shift 9; echo "rc=$? $#"' },
      });
      const result = await env.exec("source /s.sh a b c d e f g h i j k");
      expect(result.stdout).toBe("10\nrc=0 1\n");
      expect(result.stderr).toBe("");
    });
  });
});

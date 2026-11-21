import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import type { CommandExecutionBudget } from "../../execution-scope.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";
import { AwkInterpreter, createRuntimeContext } from "./interpreter/index.js";
import { AwkParser } from "./parser2.js";

describe("awk associative arrays", () => {
  describe("basic array operations", () => {
    it("should create and access array elements", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a["foo"] = 42; print a["foo"] }'`,
      );
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support numeric indices", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a[1] = "one"; a[2] = "two"; print a[1], a[2] }'`,
      );
      expect(result.stdout).toBe("one two\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return empty string for uninitialized element", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { print "[" a["missing"] "]" }'`,
      );
      expect(result.stdout).toBe("[]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should overwrite existing array elements", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a["x"] = 1; a["x"] = 2; print a["x"] }'`,
      );
      expect(result.stdout).toBe("2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support expressions as indices", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { i=5; a[i*2] = "ten"; print a[10] }'`,
      );
      expect(result.stdout).toBe("ten\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support string concatenation as index", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a["key" "1"] = "value"; print a["key1"] }'`,
      );
      expect(result.stdout).toBe("value\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("in operator", () => {
    it("should return true for existing key", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a["x"] = 1; if ("x" in a) print "found" }'`,
      );
      expect(result.stdout).toBe("found\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return false for missing key", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a["x"] = 1; if ("y" in a) print "found"; else print "not found" }'`,
      );
      expect(result.stdout).toBe("not found\n");
      expect(result.exitCode).toBe(0);
    });

    it("should work with numeric keys", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a[42] = "answer"; print (42 in a), (99 in a) }'`,
      );
      expect(result.stdout).toBe("1 0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not create element when checking with in", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { if ("x" in a) print "yes"; for (k in a) print k }'`,
      );
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("delete statement", () => {
    it("should delete array element", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a["x"] = 1; delete a["x"]; print ("x" in a) }'`,
      );
      expect(result.stdout).toBe("0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not error when deleting non-existent element", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { delete a["missing"]; print "ok" }'`,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
    });

    it("should delete entire array", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a[1]=1; a[2]=2; a[3]=3; delete a; for(k in a) count++; print count+0 }'`,
      );
      expect(result.stdout).toBe("0\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("for-in loops", () => {
    it("should iterate over array keys", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a["a"]=1; a["b"]=2; a["c"]=3; for (k in a) count++; print count }'`,
      );
      expect(result.stdout).toBe("3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access values via key in loop", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a[1]=10; a[2]=20; a[3]=30; sum=0; for (k in a) sum += a[k]; print sum }'`,
      );
      expect(result.stdout).toBe("60\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle empty array", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { for (k in a) print k; print "done" }'`,
      );
      expect(result.stdout).toBe("done\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("split() function with arrays", () => {
    it("should split string into array", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { n = split("a:b:c", arr, ":"); print n, arr[1], arr[2], arr[3] }'`,
      );
      expect(result.stdout).toBe("3 a b c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return count of elements", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { n = split("one,two,three,four", arr, ","); print n }'`,
      );
      expect(result.stdout).toBe("4\n");
      expect(result.exitCode).toBe(0);
    });

    it("should split on whitespace by default", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { n = split("a b c", arr); print n, arr[1], arr[2], arr[3] }'`,
      );
      expect(result.stdout).toBe("3 a b c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should clear existing array before split", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { arr[5]="old"; split("a:b", arr, ":"); print (5 in arr), arr[1], arr[2] }'`,
      );
      expect(result.stdout).toBe("0 a b\n");
      expect(result.exitCode).toBe(0);
    });

    it("should reject split when the initial count already exceeds the limit", async () => {
      // ENVIRON alone already fills a maxArrayElements of 5, so the
      // room for a split is negative: the split must fail on the limit
      // without doing unbounded work on the input first.
      const bash = new Bash({ executionLimits: { maxArrayElements: 5 } });
      const result = await bash.exec(
        `echo "" | awk 'BEGIN { n = split("a,b,c,d,e,f,g,h", arr, ","); print "n=" n }'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("awk: array element limit exceeded (5)\n");
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });
  });

  describe("counting with arrays", () => {
    it("should count occurrences", async () => {
      const env = new Bash({
        files: { "/data.txt": "apple\nbanana\napple\ncherry\napple\n" },
      });
      const result = await env.exec(
        `awk '{ count[$1]++ } END { print count["apple"] }' /data.txt`,
      );
      expect(result.stdout).toBe("3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should count unique values", async () => {
      const env = new Bash({
        files: { "/data.txt": "a\nb\na\nc\nb\na\n" },
      });
      const result = await env.exec(
        `awk '{ seen[$1]++ } END { for (k in seen) n++; print n }' /data.txt`,
      );
      expect(result.stdout).toBe("3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sum values by category", async () => {
      const env = new Bash({
        files: { "/data.csv": "fruit,10\nveg,20\nfruit,15\nveg,5\n" },
      });
      const result = await env.exec(
        `awk -F, '{ sum[$1]+=$2 } END { print sum["fruit"], sum["veg"] }' /data.csv`,
      );
      expect(result.stdout).toBe("25 25\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("multi-dimensional arrays (SUBSEP)", () => {
    it("should simulate 2D array with SUBSEP", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a[1,2] = "val"; print a[1,2] }'`,
      );
      expect(result.stdout).toBe("val\n");
      expect(result.exitCode).toBe(0);
    });

    it("should store matrix values", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN {
          a[0,0]=1; a[0,1]=2;
          a[1,0]=3; a[1,1]=4;
          print a[0,0], a[0,1], a[1,0], a[1,1]
        }'`,
      );
      expect(result.stdout).toBe("1 2 3 4\n");
      expect(result.exitCode).toBe(0);
    });

    it("should check multi-dimensional key with in", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a[1,2] = "x"; print ((1,2) in a), ((1,3) in a) }'`,
      );
      expect(result.stdout).toBe("1 0\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("arrays with field data", () => {
    it("should use field value as key", async () => {
      const env = new Bash({
        files: { "/data.txt": "alice 100\nbob 200\nalice 50\n" },
      });
      const result = await env.exec(
        `awk '{ totals[$1] += $2 } END { print totals["alice"], totals["bob"] }' /data.txt`,
      );
      expect(result.stdout).toBe("150 200\n");
      expect(result.exitCode).toBe(0);
    });

    it("should store lines by field", async () => {
      const env = new Bash({
        files: { "/data.txt": "1 first\n2 second\n3 third\n" },
      });
      const result = await env.exec(
        `awk '{ lines[$1] = $2 } END { print lines[2] }' /data.txt`,
      );
      expect(result.stdout).toBe("second\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("array increment patterns", () => {
    it("should pre-increment array element", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a["x"] = 5; print ++a["x"], a["x"] }'`,
      );
      expect(result.stdout).toBe("6 6\n");
      expect(result.exitCode).toBe(0);
    });

    it("should post-increment array element", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a["x"] = 5; print a["x"]++, a["x"] }'`,
      );
      expect(result.stdout).toBe("5 6\n");
      expect(result.exitCode).toBe(0);
    });

    it("should compound assign to array element", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a["x"] = 10; a["x"] += 5; a["x"] *= 2; print a["x"] }'`,
      );
      expect(result.stdout).toBe("30\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("asort", () => {
    it("should sort values in place and return the count (fixes #737)", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1] = 3; x[2] = 1; n = asort(x); print "n=[" n "]", x[1], x[2] }'`,
      );
      expect(result.stdout).toBe("n=[2] 1 3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort into a destination array and leave the source unchanged", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x["b"] = 3; x["a"] = 1; n = asort(x, y); print n, y[1], y[2], x["a"], x["b"] }'`,
      );
      expect(result.stdout).toBe("2 1 3 1 3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should compare strings as strings and numbers numerically", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1] = "10"; x[2] = "9"; x[3] = "banana"; x[4] = "apple"; n = asort(x); print n, x[1], x[2], x[3], x[4] }'`,
      );
      expect(result.stdout).toBe("4 9 10 apple banana\n");
      expect(result.exitCode).toBe(0);
    });

    it("should honor @val_str_desc ordering", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1] = 10; x[2] = 9; n = asort(x, y, "@val_str_desc"); print n, y[1], y[2] }'`,
      );
      expect(result.stdout).toBe("2 9 10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return 0 for an empty array", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { n = asort(x); print "[" n "]" }'`,
      );
      expect(result.stdout).toBe("[0]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read ENVIRON as a source array (fixes #737)", async () => {
      const env = new Bash();
      const result = await env.exec(
        `export ZZASORT=hello; echo "" | awk 'BEGIN { n = asort(ENVIRON, e); found = 0; for (i = 1; i <= n; i++) if (e[i] == "hello") found = 1; print (n > 0), found }'`,
      );
      expect(result.stdout).toBe("1 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read ARGV as a source array (fixes #737)", async () => {
      const env = new Bash({
        files: { "/tmp/f1": "", "/tmp/f2": "" },
      });
      const result = await env.exec(
        `awk 'BEGIN { n = asort(ARGV, a); print n, a[1], a[2], a[3] }' /tmp/f2 /tmp/f1`,
      );
      expect(result.stdout).toBe("3 /tmp/f1 /tmp/f2 awk\n");
      expect(result.exitCode).toBe(0);
    });

    it("should write into ARGV as a destination array (fixes #737)", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1] = "b"; x[2] = "a"; n = asort(x, ARGV); print n, ARGV[1], ARGV[2] }'`,
      );
      expect(result.stdout).toBe("2 a b\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort numbers before non-numeric strings in the default order (fixes #737)", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1] = "1a"; x[2] = 2; x[3] = 10; n = asort(x); print n, x[1], x[2], x[3] }'`,
      );
      // The old `<`-based comparison cycled for these values ("1a" < "2"
      // as strings, 2 < 10 numerically, but "1a" > "10" as strings), so
      // the order depended on the input permutation and the tested output
      // had its last element less than its first. gawk's default puts
      // numeric-looking values first, numerically, then the rest as strings.
      expect(result.stdout).toBe("3 2 10 1a\n");
      expect(result.exitCode).toBe(0);
    });

    it("should give the same default order for every permutation of mixed values", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a[1]="1a"; a[2]=2; a[3]=10; asort(a); print a[1], a[2], a[3]; b[1]=10; b[2]="1a"; b[3]=2; asort(b); print b[1], b[2], b[3]; c[1]=2; c[2]=10; c[3]="1a"; asort(c); print c[1], c[2], c[3] }'`,
      );
      expect(result.stdout).toBe("2 10 1a\n2 10 1a\n2 10 1a\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort a numeric-looking string before punctuation in the default order", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1] = "10"; x[2] = "!"; n = asort(x); print n, x[1], x[2] }'`,
      );
      // Numeric-looking values sort before non-numeric strings, so "10"
      // comes first even though "!" < "10" as plain strings.
      expect(result.stdout).toBe("2 10 !\n");
      expect(result.exitCode).toBe(0);
    });

    it("should accept an explicitly supplied empty how argument as the default", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1] = 2; x[2] = 1; n = asort(x, y, ""); print n, y[1], y[2] }'`,
      );
      // gawk accepts "" as the default ordering; head used to reject it.
      expect(result.stdout).toBe("2 1 2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort in place when source and destination are the same array", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1] = 3; x[2] = 1; n = asort(x, x); print n, x[1], x[2] }'`,
      );
      expect(result.stdout).toBe("2 1 3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep the source alias when a how function uses the same parameter name", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function g(arr) { return "@val_num_asc" } function f(arr) { n = asort(arr, arr, g(arr)); print "n=" n, arr[1], arr[2] } BEGIN { x[1]=3; x[2]=1; f(x); print "x:", x[1], x[2] }'`,
      );
      expect(result.stdout).toBe("n=2 1 3\nx: 1 3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read and write ARGV through a function-parameter alias", async () => {
      const env = new Bash({
        files: { "/tmp/f1": "", "/tmp/f2": "" },
      });
      const result = await env.exec(
        `awk 'function f(a) { print "[" a[1] "]", "[" a[2] "]"; a[1] = "zzz"; print ARGV[1] } BEGIN { f(ARGV) }' /tmp/f2 /tmp/f1`,
      );
      expect(result.stdout).toBe("[/tmp/f2] [/tmp/f1]\nzzz\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read ENVIRON through a function-parameter alias", async () => {
      const env = new Bash();
      const result = await env.exec(
        `export ZZASORT=hello; echo "" | awk 'function f(e) { print e["ZZASORT"] } BEGIN { f(ENVIRON) }'`,
      );
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should count values copied into ARGV against maxArrayElements", async () => {
            // ENVIRON holds 12 default entries, already more than the
      // maxArrayElements of 5, so delete it first: without that, the
      // limit would trip while building the source array, before asort
      // ever copies anything into ARGV.
      const bash = new Bash({ executionLimits: { maxArrayElements: 5 } });
      const result = await bash.exec(
        `echo "" | awk 'BEGIN { delete ENVIRON; r[1]=4; r[2]=3; r[3]=2; r[4]=1; print "built"; n = asort(r, ARGV); print "n=" n }'`,
      );
      expect(result.stdout).toBe("built\n");
      expect(result.stderr).toBe("awk: array element limit exceeded (5)\n");
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });

    it("should charge the sort to the shared work budget", async () => {
            // 10,000 values against a 10,002 budget: the conversion charge
      // costs 10,000 units and fits, so the sort itself trips the
      // limit at the 3rd comparison charge (one unit per 1024
      // comparisons).
      const bash = new Bash({ executionLimits: { maxWorkUnits: 10002 } });
      const result = await bash.exec(
        `echo "" | awk 'BEGIN { for (i = 10000; i >= 1; i--) x[i] = i; n = asort(x); print "n=" n }'`,
      );
      expect(result.stdout).toBe("");
      // Scope-charged work errors surface with the shell's "bash:" prefix
      // (the same shape as other commands' consumeWork errors, e.g. xan).
      expect(result.stderr).toBe(
        "bash: asort comparison: work work limit exceeded (10002)\n",
      );
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });

    it("should let an abort interrupt a large sort", async () => {
      const scope = {
        consumeWork: () => 0,
        throwIfAborted: () => {
          throw new ExecutionAbortedError("", "bash: asort sort aborted\n");
        },
      };
      const parser = new AwkParser();
      const ast = parser.parse(
        `BEGIN { for (i = 3000; i >= 1; i--) x[i] = i; n = asort(x); print n }`,
      );
      const ctx = createRuntimeContext({
        executionScope: scope as unknown as CommandExecutionBudget,
      });
      const interp = new AwkInterpreter(ctx);
      interp.execute(ast);
      await expect(interp.executeBegin()).rejects.toThrow(
        ExecutionAbortedError,
      );
    });

    it("should break numeric ties by string value for @val_num_asc (fixes #737)", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1] = "1.0"; x[2] = "01"; x[3] = "1"; n = asort(x, y, "@val_num_asc"); print n, y[1], y[2], y[3] }'`,
      );
      expect(result.stdout).toBe("3 01 1 1.0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should evaluate the how argument before reading the source (fixes #737)", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function pick() { delete a[3]; return "@val_num_asc" } BEGIN { a[1] = 3; a[2] = 1; a[3] = 2; n = asort(a, b, pick()); print n, b[1], b[2] }'`,
      );
      expect(result.stdout).toBe("2 1 3\n");
      expect(result.exitCode).toBe(0);
    });
  });
});

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import type { CommandExecutionBudget } from "../../execution-scope.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";
import { AwkInterpreter, createRuntimeContext } from "./interpreter/index.js";
import { setArrayElement } from "./interpreter/variables.js";
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

    it("should iterate over ENVIRON keys", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { ENVIRON["ZZ_TEST"]="value"; n=0; for (k in ENVIRON) if (k=="ZZ_TEST") n++; print n }'`,
      );
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should iterate over ARGV keys", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { ARGV["key"]=1; n=0; for (k in ARGV) if (k=="key") n++; print n }'`,
      );
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should iterate over an array passed as a function parameter", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(e){n=0; for (k in e) if (k=="ZZ_TEST") n++; print n} BEGIN{ENVIRON["ZZ_TEST"]="v"; f(ENVIRON)}'`,
      );
      expect(result.stdout).toBe("1\n");
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

    it("should not count prepopulated ARGV/ENVIRON against the split room", async () => {
      // ENVIRON holds a dozen default entries, but they are
      // prepopulated, not program-created, so they do not consume the
      // maxArrayElements allowance: a five-part split fits a limit of
      // five. This also passes at base, where the count started at
      // zero — it is a regression guard, not the discriminator for
      // the fix (see the exempt-slots test below).
      const bash = new Bash({ executionLimits: { maxArrayElements: 5 } });
      const result = await bash.exec(
        `echo "" | awk 'BEGIN { n = split("a,b,c,d,e", arr, ","); print "n=" n, arr[1], arr[5] }'`,
      );
      expect(result.stdout).toBe("n=5 a e\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should still reject a split that exceeds the limit", async () => {
      // Eight parts against a limit of five: the split must fail on
      // the limit without doing unbounded work on the input first.
      // (This guards the limit itself; it also passes at base, where
      // the same error came from the prepopulated count instead.)
      const bash = new Bash({ executionLimits: { maxArrayElements: 5 } });
      const result = await bash.exec(
        `echo "" | awk 'BEGIN { n = split("a,b,c,d,e,f,g,h", arr, ","); print "n=" n }'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("awk: array element limit exceeded (5)\n");
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });

    it("should let a split into ARGV fit wholly in its exempt slots", async () => {
      // One part against a limit of five with five other elements
      // already charged: the part fits ARGV's single prepopulated
      // slot, so the split must succeed. At base the prospective
      // bound omitted the baseline and rejected it.
      const bash = new Bash({ executionLimits: { maxArrayElements: 5 } });
      const result = await bash.exec(
        `echo "" | awk 'BEGIN { a[1]=1; a[2]=2; a[3]=3; a[4]=4; a[5]=5; n = split("x", ARGV, ","); print "n=" n, ARGV[1] }'`,
      );
      expect(result.stdout).toBe("n=1 x\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should split into a function-parameter array", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(a){split("c:a:b",a,":"); print asort(a), a[1], a[2], a[3]} BEGIN{f(x); print x[1], x[2], x[3]}'`,
      );
      expect(result.stdout).toBe("3 a b c\na b c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should split into ENVIRON through its dedicated store", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { split("a:b", ENVIRON, ":"); print ENVIRON[1], ENVIRON[2] }'`,
      );
      expect(result.stdout).toBe("a b\n");
      expect(result.exitCode).toBe(0);
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
      // Numeric-looking strings are still strings for the default
      // order, so "10" sorts before "9" lexically, as in gawk.
      expect(result.stdout).toBe("4 10 9 apple banana\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort input field values numerically in the default order", async () => {
      const env = new Bash();
      const result = await env.exec(
        `printf '10\\n9\\n' | awk '{a[NR]=$1} END{asort(a); print a[1],a[2]}'`,
      );
      // Fields are numeric strings (strnums) in gawk, so "10" and "9"
      // sort numerically here — unlike string literals, which sort
      // lexically ("10" before "9").
      expect(result.stdout).toBe("9 10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort split values numerically in the default order", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{split("10 9",a); asort(a); print a[1],a[2]}'`,
      );
      expect(result.stdout).toBe("9 10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep numeric-string provenance through a scalar variable", async () => {
      const env = new Bash();
      const result = await env.exec(
        `printf '10\\n9\\n' | awk '{x=$1; a[NR]=x} END{asort(a); print a[1],a[2]}'`,
      );
      expect(result.stdout).toBe("9 10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not treat concatenated field values as numeric strings", async () => {
      const env = new Bash();
      const result = await env.exec(
        `printf '10\\n9\\n' | awk '{a[NR]=$1 ""} END{asort(a); print a[1],a[2]}'`,
      );
      // Concatenation produces a plain string in gawk, so the values
      // sort lexically.
      expect(result.stdout).toBe("10 9\n");
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
      // numeric values first, numerically, then the rest as strings.
      expect(result.stdout).toBe("3 2 10 1a\n");
      expect(result.exitCode).toBe(0);
    });

    it("should give the same default order for every permutation of mixed values", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a[1]="1a"; a[2]=2; a[3]=10; asort(a); print a[1], a[2], a[3]; b[1]="1a"; b[2]=10; b[3]=2; asort(b); print b[1], b[2], b[3]; c[1]=2; c[2]="1a"; c[3]=10; asort(c); print c[1], c[2], c[3]; d[1]=2; d[2]=10; d[3]="1a"; asort(d); print d[1], d[2], d[3]; e[1]=10; e[2]="1a"; e[3]=2; asort(e); print e[1], e[2], e[3]; f[1]=10; f[2]=2; f[3]="1a"; asort(f); print f[1], f[2], f[3] }'`,
      );
      expect(result.stdout).toBe(
        "2 10 1a\n2 10 1a\n2 10 1a\n2 10 1a\n2 10 1a\n2 10 1a\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should sort a numeric-looking string after punctuation in the default order", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1] = "10"; x[2] = "!"; n = asort(x); print n, x[1], x[2] }'`,
      );
      // Both values are strings, so plain string order applies: "!"
      // comes before "10", matching the interpreter's `<` and gawk.
      expect(result.stdout).toBe("2 ! 10\n");
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

    it("should treat an omitted function parameter as an uninitialized array for asort", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(a){print asort(a)} BEGIN{f()}'`,
      );
      // gawk prints 0: an omitted parameter is untyped, not a scalar.
      expect(result.stdout).toBe("0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should let a how function using the same parameter name write the source array", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function g(a){a[1]=7; return "@val_num_asc"} function f(a){asort(a,a,g(a)); print a[1],a[2]} BEGIN{x[1]=3;x[2]=1;f(x)}'`,
      );
      // g's parameter must keep pointing at f's array while g runs,
      // so its write of a[1]=7 is visible to the sort, as in gawk.
      expect(result.stdout).toBe("1 7\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep swapped array arguments pointing at the right arrays", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(x,y){asort(x); asort(y); print x[1], x[2], y[1], y[2]} function g(x,y){f(y,x)} BEGIN{a[1]=3; a[2]=1; b[1]=4; b[2]=2; g(a,b)}'`,
      );
      expect(result.stdout).toBe("2 4 1 3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep same-named swapped array arguments pointing at the right arrays", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(a,b){asort(a); asort(b); print a[1], a[2], b[1], b[2]} BEGIN{a[1]=3; a[2]=1; b[1]=4; b[2]=2; f(b,a)}'`,
      );
      // The parameters have the same names as the caller arrays, so
      // the bindings form a cycle (a -> b, b -> a) in a flat alias
      // map and asort sorts each array in place instead of the array
      // actually passed. gawk prints the swapped result.
      expect(result.stdout).toBe("2 4 1 3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep same-named swapped array arguments pointing at the right arrays for split", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(a,b){split("z:y",a,":"); print a[1], a[2], b[1], b[2]} BEGIN{a[1]=3; a[2]=1; b[1]=4; b[2]=2; f(b,a)}'`,
      );
      expect(result.stdout).toBe("z y 3 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep same-named swapped array arguments pointing at the right arrays for for-in", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(a,b){n=0; for(k in a) n++; print n, b[1], b[2]} BEGIN{a[1]=1; a[2]=2; b[1]=9; f(b,a)}'`,
      );
      expect(result.stdout).toBe("1 1 2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should give an omitted array parameter its own local array", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(a){print asort(a); a[1]=99; print a[1]} BEGIN{a[1]=3; a[2]=1; f(); print a[1], a[2]}'`,
      );
      // gawk: the omitted parameter is a fresh empty local array, so
      // asort returns 0, the write lands in the local array, and the
      // outer array is untouched.
      expect(result.stdout).toBe("0\n99\n3 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should give an omitted array parameter its own local array for split", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(a){split("z:y",a,":"); print a[1], a[2]} BEGIN{a[1]=3; a[2]=1; f(); print a[1], a[2]}'`,
      );
      expect(result.stdout).toBe("z y\n3 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not let a callee see a caller's array parameter as a global", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function g(){print a[1]} function f(a){a[1]=99; g()} BEGIN{a[1]=5; b[1]=9; f(b); print a[1], b[1]}'`,
      );
      // g has no parameter named a, so its a[1] is the global array
      // (5), not f's parameter bound to b (99).
      expect(result.stdout).toBe("5\n5 99\n");
      expect(result.exitCode).toBe(0);
    });

    it("should reject a how function that assigns a scalar to an uninitialized source", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function h(){s=5; return ""} BEGIN{d[1]="keep"; n=asort(s,d,h()); print n, d[1]}'`,
      );
      // gawk rejects this; head validated before evaluating how, then
      // read the source as an empty array and cleared d.
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: first argument is not an array\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should reject a how function that assigns a scalar to the destination", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function h(){d=5; return ""} BEGIN{s[1]=3; s[2]=1; n=asort(s,d,h()); print n}'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: second argument is not an array\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should reject asort of a scalar function parameter", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(a){print asort(a)} BEGIN{a[1]=3; f(1)}'`,
      );
      // gawk rejects this; head sorted the outer array of the same
      // name instead, because the scalar parameter had no binding.
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: first argument is not an array\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should sort the right array when a parameter shadows an argument (fixes #737)", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(x,a){asort(x)} BEGIN{a[1]=2;a[2]=1;b[1]=4;b[2]=3; f(a,b); print a[1],a[2],b[1],b[2]}'`,
      );
      // f(a, b) binds x to a and a to b; asort(x) must sort a, not b
      // (review 6007463856).
      expect(result.stdout).toBe("1 2 4 3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should break numeric ties by string value in the default mode (fixes #737)", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{split("1.0 01 1",a); asort(a); print a[1],a[2],a[3]}'`,
      );
      // gawk breaks a numeric tie with the string values: "01" <
      // "1" < "1.0". The earlier stability claim (review 6007650999)
      // was wrong; review 6009811820 corrects it.
      expect(result.stdout).toBe("01 1 1.0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should break numeric ties by string value across magnitudes in the default mode", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{split("2 10 1.0 01 1",a); asort(a); print a[1],a[2],a[3],a[4],a[5]}'`,
      );
      // 1.0, 01 and 1 tie numerically and order by string value;
      // 2 and 10 sort numerically after them (review 6009811820).
      expect(result.stdout).toBe("01 1 1.0 2 10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep input order for a genuine tie in the default mode", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{a[1]=1.0; a[2]=1; a[3]=1.00; asort(a); print a[1],a[2],a[3]}'`,
      );
      // All three are the number 1 with the same CONVFMT form "1",
      // so the string tie-break also ties and the stable sort keeps
      // input order (review 6009811820).
      expect(result.stdout).toBe("1 1 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort numbers by their CONVFMT form in @val_str_asc", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{a[1]=0.00009; a[2]=0.001; asort(a,b,"@val_str_asc"); print b[1], b[2]}'`,
      );
      // gawk formats 0.00009 as "9e-05" (CONVFMT "%.6g"), which sorts
      // after "0.001". The order is the assertion: with the plain
      // String form ("0.00009") it would sort first. The printed
      // "9e-5" (not gawk's "9e-05") is this codebase's existing %g
      // display in print, not the sort key.
      expect(result.stdout).toBe("0.001 9e-5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should treat 'Infinity' as numeric zero in @val_num_asc", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{a[1]="Infinity"; a[2]="1"; asort(a,b,"@val_num_asc"); print b[1], b[2]}'`,
      );
      expect(result.stdout).toBe("Infinity 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should honor IGNORECASE in string orderings", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{IGNORECASE=1; a[1]="b"; a[2]="A"; a[3]="a"; a[4]="B"; asort(a); print a[1],a[2],a[3],a[4]}'`,
      );
      expect(result.stdout).toBe("A a B b\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort supplementary characters after BMP characters by code point", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{a[1]="😀"; a[2]="Ａ"; asort(a); print a[1],a[2]}'`,
      );
      // gawk compares by code point (UTF-8 byte order), not by UTF-16
      // code unit, so full-width Ａ (U+FF21) comes before 😀 (U+1F600).
      expect(result.stdout).toBe("Ａ 😀\n");
      expect(result.exitCode).toBe(0);
    });

    it("should let an abort interrupt a large sort", async () => {
      // The mock aborts only once the comparator starts charging: the
      // conversion phase's own abort checks must pass first, so the
      // test genuinely exercises an abort during sorting instead of
      // failing before the sort begins.
      let comparisonCharging = false;
      const scope = {
        consumeWork: (_units: number, site?: string) => {
          if (site === "asort comparison") comparisonCharging = true;
          return 0;
        },
        throwIfAborted: () => {
          if (comparisonCharging) {
            throw new ExecutionAbortedError("", "bash: asort sort aborted\n");
          }
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
      // ENVIRON's prepopulated entries no longer consume the
      // allowance, so the source array builds fine under a limit of
      // five; copying four values into ARGV (which holds one
      // prepopulated entry) still charges three past it and trips the
      // limit.
      const bash = new Bash({ executionLimits: { maxArrayElements: 5 } });
      const result = await bash.exec(
        `echo "" | awk 'BEGIN { r[1]=4; r[2]=3; r[3]=2; r[4]=1; print "built"; n = asort(r, ARGV); print "n=" n }'`,
      );
      expect(result.stdout).toBe("built\n");
      expect(result.stderr).toBe("awk: array element limit exceeded (5)\n");
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });

    it("should charge the sort to the shared work budget", async () => {
      // 10,000 values against a 10,002 budget: the conversion charge
      // costs 10,000 units and fits, leaving 2 units — so the first
      // comparison flush (1,024 comparisons at one unit each)
      // exceeds what is left and trips the limit.
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

    it("should reject a scalar source instead of wiping the destination", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x=123; d[1]="important"; n=asort(x,d); print n, (1 in d) }'`,
      );
      // gawk rejects a scalar source; head used to treat it as an
      // empty array, return 0, and clear d.
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: first argument is not an array\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should reject a scalar destination", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a[1]=2; s="x"; n=asort(a,s); print n }'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: second argument is not an array\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should reject asort with no arguments", async () => {
      const env = new Bash();
      const result = await env.exec(`echo "" | awk 'BEGIN { print asort() }'`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: wrong number of arguments (expected 1 to 3, got 0)\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should reject asort with more than three arguments", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { x[1]=1; print asort(x, y, "@val_num_asc", "extra") }'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: wrong number of arguments (expected 1 to 3, got 4)\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should reject a non-variable first argument", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { print asort(42, y, "invalid") }'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: first argument is not an array\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should reject a non-variable destination", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { a[1]=1; print asort(a, "oops") }'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: second argument is not an array\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should leave a small maxArrayElements allowance usable for ordinary programs", async () => {
      // ENVIRON's dozen prepopulated entries do not consume the
      // allowance, so even BEGIN{a[1]=1} works under a limit of five.
      // This also passes at base, where the count started at zero —
      // it is a regression guard, not the discriminator for the fix
      // (see the exempt-slots test above).
      const bash = new Bash({ executionLimits: { maxArrayElements: 5 } });
      const result = await bash.exec(
        `echo "" | awk 'BEGIN { a[1]=1; print "ok" }'`,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should still enforce maxArrayElements on program-created arrays", async () => {
      const bash = new Bash({ executionLimits: { maxArrayElements: 5 } });
      const result = await bash.exec(
        `echo "" | awk 'BEGIN { a[1]=1; a[2]=2; a[3]=3; a[4]=4; a[5]=5; print "five"; a[6]=6; print "six" }'`,
      );
      expect(result.stdout).toBe("five\n");
      expect(result.stderr).toBe("awk: array element limit exceeded (5)\n");
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });

    it("should read files from the current ARGV after asort into ARGV", async () => {
      const env = new Bash({
        files: {
          "/one": "one-line\n",
          "/two": "two-line\n",
          "/three": "three-line\n",
        },
      });
      const result = await env.exec(
        `awk 'BEGIN { a[1]="/three"; a[2]="/two"; asort(a, ARGV) } { print FILENAME, $0 }' /one /two`,
      );
      expect(result.stdout).toBe("/three three-line\n/two two-line\n");
      expect(result.exitCode).toBe(0);
    });

    it("should skip a deleted ARGV entry when reading files", async () => {
      const env = new Bash({
        files: { "/one": "one-line\n", "/two": "two-line\n" },
      });
      const result = await env.exec(
        `awk 'BEGIN { delete ARGV[1] } { print FILENAME, $0 }' /one /two`,
      );
      expect(result.stdout).toBe("/two two-line\n");
      expect(result.exitCode).toBe(0);
    });

    it("should honor a lowered ARGC when reading files", async () => {
      const env = new Bash({
        files: { "/one": "one-line\n", "/two": "two-line\n" },
      });
      const result = await env.exec(
        `awk 'BEGIN { ARGC=2 } { print FILENAME, $0 }' /one /two`,
      );
      expect(result.stdout).toBe("/one one-line\n");
      expect(result.exitCode).toBe(0);
    });

    it("should terminate when ARGC is set to Infinity", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { ARGC=1e400 } END { print "done" }'`,
      );
      // gawk converts a non-finite ARGC to no files (it reads stdin
      // instead); a huge finite ARGC makes gawk itself spin, but the
      // input scan here stops at the entries that actually exist
      // instead of following ARGC.
      expect(result.stdout).toBe("done\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read stdin when ARGC is negative Infinity", async () => {
      const env = new Bash({ files: { "/f": "file-line\n" } });
      const result = await env.exec(
        `printf 'stdin-line\\n' | awk 'BEGIN{ARGC=-1e400; ARGV[1]="/f"} {print FILENAME, $0}'`,
      );
      // gawk converts a non-finite ARGC to no files and reads stdin
      // (review 6007290268).
      expect(result.stdout).toBe("- stdin-line\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read stdin when ARGC is positive Infinity", async () => {
      const env = new Bash({ files: { "/f": "file-line\n" } });
      const result = await env.exec(
        `echo "" | awk 'BEGIN{ARGC=1e400; ARGV[1]="/f"} {print FILENAME, $0}'`,
      );
      // As above: a non-finite ARGC admits no files (review 6007290268).
      expect(result.stdout).toBe("- \n");
      expect(result.exitCode).toBe(0);
    });

    it("should read a file once when ARGV has a noncanonical duplicate key", async () => {
      const env = new Bash({ files: { "/one": "one-line\n" } });
      const result = await env.exec(
        `awk 'BEGIN{ARGC=2; ARGV["01"]="/one"; ARGV[1]="/one"} {print $0}'`,
      );
      // "01" and "1" are distinct keys in gawk, but only the canonical
      // key is consulted as input index 1; both map to pending index 1
      // here, so without dedup the file is read twice. gawk reads it
      // once (review 6008016191).
      expect(result.stdout).toBe("one-line\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read a file named by ARGV during an earlier file", async () => {
      const env = new Bash({
        files: {
          "/one": "one-line\n",
          "/two": "two-line\n",
          "/three": "three-line\n",
        },
      });
      const result = await env.exec(
        `awk 'FNR==1 {print FILENAME,$0; if (FILENAME=="/one") ARGV[2]="/three"}' /one /two`,
      );
      expect(result.stdout).toBe("/one one-line\n/three three-line\n");
      expect(result.exitCode).toBe(0);
    });

    it("should bump argvVersion when an existing ARGV element is replaced (review 6009811820)", () => {
      const ctx = createRuntimeContext();
      expect(ctx.argvVersion).toBe(0);
      setArrayElement(ctx, "ARGV", "1", "/one");
      expect(ctx.argvVersion).toBe(1);
      // Replacing the existing key bumps too: the documented
      // contract on ctx.argvVersion is a bump on every
      // insert/delete/replacement, so the input loop's cached index
      // list can never go stale.
      setArrayElement(ctx, "ARGV", "1", "/two");
      expect(ctx.argvVersion).toBe(2);
      expect(ctx.ARGV["1"]).toBe("/two");
      // An ENVIRON replacement must not invalidate the input loop.
      setArrayElement(ctx, "ENVIRON", "X", "1");
      setArrayElement(ctx, "ENVIRON", "X", "2");
      expect(ctx.argvVersion).toBe(2);
    });

    it("should read the replacement file when ARGV is replaced in BEGIN", async () => {
      const env = new Bash({
        files: { "/one": "one-line\n", "/two": "two-line\n" },
      });
      const result = await env.exec(
        `awk 'BEGIN { ARGV[2]="/one" } { print FILENAME, $0 }' /one /two`,
      );
      // The loop reads each entry fresh when its turn comes, so the
      // replacement takes effect; the argvVersion bump keeps the
      // cached index list honest for the same case mid-file.
      expect(result.stdout).toBe("/one one-line\n/one one-line\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read stdin for a '-' ARGV entry", async () => {
      const env = new Bash({
        files: { "/one": "one-line\n" },
      });
      const result = await env.exec(
        `printf 'stdin\\n' | awk 'BEGIN {a[1]="-"; asort(a,ARGV)} {print FILENAME, $0}' /one`,
      );
      expect(result.stdout).toBe("- stdin\n");
      expect(result.exitCode).toBe(0);
    });

    it("should skip a numeric ARGV entry and read stdin instead", async () => {
      const env = new Bash({
        files: { "/one": "one-line\n" },
      });
      const result = await env.exec(
        `printf 'stdin\\n' | awk 'BEGIN {a[1]=1; asort(a,ARGV)} {print}' /one`,
      );
      expect(result.stdout).toBe("stdin\n");
      expect(result.exitCode).toBe(0);
    });

    it("should fill ARGV with many entries without rescanning it per insert", async () => {
      // Correctness pin for the incremental size tracking: filling
      // ARGV used to rescan its keys on every insert (quadratic), so
      // 100,000 inserts burned ~5e9 key visits uncharged. The speed
      // itself is verified by timing, not by this test.
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { for (i=1; i<=5000; i++) ARGV[i]=i; print ARGV[5000], ARGV[1] }'`,
      );
      expect(result.stdout).toBe("5000 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read a sparse high ARGV index without visiting the missing ones", async () => {
      // One entry at index 999,999 with ARGC=1e6: the old loop
      // visited every missing index below it (a trillion lookups for
      // the reviewer's ARGC=1e12 repro, which hangs gawk too). The
      // input loop now iterates the present indices only; the 1e12
      // repro finishes in milliseconds, verified by timing.
      const env = new Bash({
        files: { "/high": "high-line\n" },
      });
      const result = await env.exec(
        `echo "" | awk 'BEGIN{ARGC=1000000; ARGV[999999]="/high"} {print $0}'`,
      );
      expect(result.stdout).toBe("high-line\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read stdin with FILENAME - after all ARGV entries are deleted", async () => {
      const env = new Bash({ files: { "/one": "one-line\n" } });
      const result = await env.exec(
        `printf 'stdin\\n' | awk 'BEGIN{delete ARGV[1]} {print FILENAME,$0}' /one`,
      );
      expect(result.stdout).toBe("- stdin\n");
      expect(result.exitCode).toBe(0);
    });

    it("should read a file added mid-file when ARGC is raised too", async () => {
      // Adding ARGV[2] alone is not enough: it sits past ARGC, so
      // gawk does not read it either. Raising ARGC makes the new
      // entry visible to the loop.
      const env = new Bash({
        files: { "/one": "one-line\n", "/two": "two-line\n" },
      });
      const result = await env.exec(
        `awk 'FNR==1 {ARGV[2]="/two"; ARGC=3} {print FILENAME, $0}' /one`,
      );
      expect(result.stdout).toBe("/one one-line\n/two two-line\n");
      expect(result.exitCode).toBe(0);
    });

    it("should apply -v CONVFMT to the slot reads use", async () => {
      // -v assignments used to land in vars while CONVFMT reads went
      // to ctx.CONVFMT, so -v CONVFMT was silently ignored.
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk -v CONVFMT=%.0f 'BEGIN{print CONVFMT}'`,
      );
      expect(result.stdout).toBe("%.0f\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort with the -v CONVFMT value", async () => {
      // CONVFMT=%.0f formats the number 1.4 to "1", but the literal
      // "1.2" stays the string "1.2", so this is not a tie: "1" sorts
      // before "1.2" and 1.4 comes first, as in gawk. A genuine tie
      // (two numbers formatting to the same key) keeps input order;
      // see the round-8 pins below (review 6008939293).
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk -v CONVFMT=%.0f 'BEGIN{a[1]=1.4; a[2]="1.2"; asort(a,b,"@val_str_asc"); print b[1], b[2]}'`,
      );
      expect(result.stdout).toBe("1.4 1.2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should apply -v OFMT to the slot reads use", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk -v OFMT=%.0f 'BEGIN{print OFMT}'`,
      );
      expect(result.stdout).toBe("%.0f\n");
      expect(result.exitCode).toBe(0);
    });

    it("should apply -v NR and ignore -v FNR, as in gawk", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk -v NR=5 -v FNR=2 'BEGIN{print NR, FNR}'`,
      );
      expect(result.stdout).toBe("5 0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should apply -v NF, padding $0 as in gawk", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk -v NF=3 'BEGIN{print "[" $0 "]", NF, "[" $1 "]"}'`,
      );
      expect(result.stdout).toBe("[  ] 3 []\n");
      expect(result.exitCode).toBe(0);
    });

    it("should ignore -v ARGC: the argument count wins, as in gawk", async () => {
      const env = new Bash({ files: { "/f": "file-line\n" } });
      const result = await env.exec(
        `echo "" | awk -v ARGC=1 'BEGIN{print ARGC} {print $0}' /f`,
      );
      expect(result.stdout).toBe("2\nfile-line\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort 1e21 by its full decimal form in @val_str_asc", async () => {
      // gawk prints the same order as "1000000000000000000000 11":
      // the number's string key is its full decimal form, not
      // "1e+21". The equality check asserts the order without
      // depending on print's %g display, which still differs.
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{a[1]=1e21; a[2]="11"; asort(a,b,"@val_str_asc"); print (b[1]==1e21)}'`,
      );
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should sort a large integer by its exact double value in @val_str_asc", async () => {
      // 1234567890123456800000 is the double 1234567890123456774144,
      // whose key starts "12", so the string "11" sorts first.
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{a[1]=1234567890123456800000; a[2]="11"; asort(a,b,"@val_str_asc"); print (b[1]=="11")}'`,
      );
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should pad uppercase E exponents in CONVFMT keys", async () => {
      // CONVFMT="%.1E" formats 0.0001 as "1.0E-04", which sorts
      // before the literal "1.0E-1", as in gawk.
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{CONVFMT="%.1E"; a[1]=0.0001; a[2]="1.0E-1"; asort(a,b,"@val_str_asc"); print b[1], b[2]}'`,
      );
      expect(result.stdout).toBe("0.0001 1.0E-1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should reject asort of the uninitialized IGNORECASE scalar", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{print asort(IGNORECASE)}'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: first argument is not an array\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should keep a strnum when sub makes no replacement", async () => {
      // "9" as a strnum sorts in the numeric group before the string
      // "10"; as a plain string it would sort after it lexically.
      const env = new Bash();
      const result = await env.exec(
        `printf '9\\n' | awk '{x=$1; sub(/z/, "q", x); a[1]=x; a[2]="10"; asort(a); print a[1], a[2]}'`,
      );
      expect(result.stdout).toBe("9 10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep a strnum when gsub makes no replacement", async () => {
      const env = new Bash();
      const result = await env.exec(
        `printf '9\\n' | awk '{x=$1; gsub(/z/, "q", x); a[1]=x; a[2]="10"; asort(a); print a[1], a[2]}'`,
      );
      expect(result.stdout).toBe("9 10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should drop the strnum when sub replaces", async () => {
      const env = new Bash();
      const result = await env.exec(
        `printf '9\\n' | awk '{x=$1; sub(/9/, "8", x); a[1]=x; a[2]="10"; asort(a); print a[1], a[2]}'`,
      );
      expect(result.stdout).toBe("10 8\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not mark a literal string argument as a strnum", async () => {
      // A literal "10" passed to a function is a plain string, so it
      // sorts after "!" lexically; only values with provenance (a
      // field, a strnum variable, a strnum element) count as strnums.
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function f(v){a[1]=v;a[2]="!";asort(a);print a[1],a[2]} BEGIN{f("10")}'`,
      );
      expect(result.stdout).toBe("! 10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep strnum provenance through an array-element copy", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{split("10 9",x); a[1]=x[1]; a[2]=x[2]; asort(a); print a[1], a[2]}'`,
      );
      expect(result.stdout).toBe("9 10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not let an omitted parameter sort the caller's array", async () => {
      // g() inside f(a) has a local, empty a: asort prints 0 and the
      // caller's array stays unsorted.
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function g(a){print asort(a)} function f(a){g();print a[1],a[2]} BEGIN{x[1]=2;x[2]=1;f(x)}'`,
      );
      expect(result.stdout).toBe("0\n2 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should reject a scalar argument where an array is expected", async () => {
      // g(1) inside f(a) must not sort the caller's array through the
      // shadowed parameter name; it is a fatal error, as in gawk.
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'function g(a){print asort(a)} function f(a){g(1);print a[1],a[2]} BEGIN{x[1]=2;x[2]=1;f(x)}'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "awk: asort: first argument is not an array\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should order É before z with IGNORECASE, as in gawk", async () => {
      // gawk folds each byte with tolower() on the signed char, so
      // bytes >= 0x80 sort before ASCII instead of after it.
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{IGNORECASE=1;a[1]="É";a[2]="z";asort(a);print a[1],a[2]}'`,
      );
      expect(result.stdout).toBe("É z\n");
      expect(result.exitCode).toBe(0);
    });

    it("should order non-ASCII before ASCII with IGNORECASE", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN{IGNORECASE=1; a[1]="Ä"; a[2]="É"; a[3]="z"; a[4]="e"; asort(a); print a[1],a[2],a[3],a[4]}'`,
      );
      expect(result.stdout).toBe("Ä É e z\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep FILENAME a plain string even when it looks numeric", async () => {
      // gawk does not treat FILENAME as a strnum: a file named "10"
      // sorts lexically before "9".
      const env = new Bash();
      const result = await env.exec(
        `echo x > 10; awk '{a[1]=FILENAME; a[2]="9"; asort(a); print a[1],a[2]}' 10`,
      );
      expect(result.stdout).toBe("10 9\n");
      expect(result.exitCode).toBe(0);
    });

    it("should trip the work budget early on a hostile CONVFMT", async () => {
      // A 1 MiB CONVFMT over 1,024 equal values: the old code
      // formatted every key before the first work/abort check. The
      // string keys are now formatted lazily and charged before they
      // run, so a 3,000-unit budget trips after a couple of values
      // instead of after ~1 GiB of keys.
      const bash = new Bash({ executionLimits: { maxWorkUnits: 3000 } });
      const result = await bash.exec(
        `echo "" | awk 'BEGIN{s="x"; for(i=1;i<=20;i++) s=s s; CONVFMT=s; for(i=1;i<=1024;i++) a[i]=0.1; n=asort(a); print n}'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "bash: asort comparison: work work limit exceeded (3000)\n",
      );
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });

    describe("round-8 pins for automated review 6008939293", () => {
      // Each test pins one claim from automated review 6008939293 on
      // PR #764, verified against gawk 5.2.1. C15 (hex literal 0x10)
      // is deliberately NOT pinned here: it is a pre-existing parser
      // gap, out of scope for this PR. The NaN @val_str_asc
      // destination-type divergence (gawk stores the strnum "-nan",
      // just-bash keeps number NaN) is likewise out of scope and not
      // pinned. C5b is not repeated: the field-strnum sub/gsub
      // no-replacement cases are already covered above.

      // C2: argument expressions are evaluated in the caller's frame,
      // so a[1]/a[2] read the caller's array even when the callee's
      // parameters share the name a.
      it("should evaluate call arguments in the caller's frame when the callee reuses the parameter name", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'function h(a, b) { print "[" a "][" b "]" } function f(a) { h(a[1], a[2]) } BEGIN { g[1]="X"; g[2]="Y"; f(g) }'`,
        );
        expect(result.stdout).toBe("[X][Y]\n");
      });

      // C6: assigning a scalar to an omitted parameter must make
      // asort reject it instead of erasing the destination.
      it("should reject asort of an omitted parameter assigned a scalar, without erasing the destination", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'function f(p) { p = 42; return asort(p, dest) } BEGIN { dest[1]="keep"; dest[2]="keep2"; n = f(); print "n=" n " dest1=[" dest[1] "]" }'`,
        );
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain(
          "asort: first argument is not an array",
        );
      });

      // C7: a how function assigning a scalar to an omitted local
      // parameter (via the alias) must be caught by the recheck.
      it("should reject asort when the how function assigns a scalar to an omitted local parameter", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'function setit(x) { x = 42; return "" } function f(p) { return asort(p, d, setit(p)) } BEGIN { d[1]="keep"; n = f(); print "n=" n " d1=[" d[1] "]" }'`,
        );
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain(
          "asort: first argument is not an array",
        );
      });

      // C7b: the same, but the aliased array is non-empty, so gawk
      // fatals on the scalar assignment itself.
      it("should fatal when the how function assigns a scalar to a non-empty aliased array", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'function setit(x) { x = 42; return "" } function f(p) { p[1]=7; return asort(p, d, setit(p)) } BEGIN { d[1]="keep"; n = f(); print "n=" n }'`,
        );
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("attempt to use array");
      });

      // C5a: a no-match sub must leave a numeric scalar a number, so
      // it still sorts in the numeric group.
      it("should keep a numeric scalar numeric when sub makes no replacement", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN { x=42; sub(/z/, "y", x); a[1]=x; a[2]="100"; n=asort(a,b); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("42 100\n");
      });

      // C9a: a plain string "0" is truthy in gawk, so IGNORECASE="0"
      // still folds case.
      it("should treat IGNORECASE set to the string 0 as truthy", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN { IGNORECASE="0"; a[1]="B"; a[2]="a"; n=asort(a, b, "@val_str_asc"); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("a B\n");
      });

      // C9b: the number 0 is falsy, so IGNORECASE=0 does not fold.
      it("should treat IGNORECASE set to the number 0 as falsy", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN { IGNORECASE=0; a[1]="B"; a[2]="a"; n=asort(a, b, "@val_str_asc"); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("B a\n");
      });

      // C9e: a strnum 0 from a field is falsy, like the number 0.
      it("should treat IGNORECASE set from a field holding 0 as falsy", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "0" | awk '{ IGNORECASE=$1; a[1]="B"; a[2]="a"; n=asort(a, b, "@val_str_asc"); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("B a\n");
      });

      // C9f: the string "00" is truthy (only the exact string "0"
      // is falsy among numeric-looking strings).
      it("should treat IGNORECASE set to the string 00 as truthy", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN { IGNORECASE="00"; a[1]="B"; a[2]="a"; n=asort(a, b, "@val_str_asc"); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("a B\n");
      });

      // C11a: a BEGIN block may rewrite an ARGV entry into a
      // var=value operand, which assigns the variable.
      it("should assign a variable when BEGIN rewrites an ARGV entry to a var=value operand", async () => {
        const env = new Bash({ files: { "/f": "hello\n" } });
        const result = await env.exec(
          `awk 'BEGIN { ARGV[1]="v=42"; ARGV[2]="/f"; ARGC=3 } { print "line:" $0 } END { print "v=" v }'`,
        );
        expect(result.stdout).toBe("line:hello\nv=42\n");
        expect(result.exitCode).toBe(0);
      });

      // C11b: a var=value operand on the command line assigns.
      it("should assign a variable from a var=value command-line operand", async () => {
        const env = new Bash({ files: { "/f": "hello\n" } });
        const result = await env.exec(
          `awk '{ print "line:" $0 } END { print "v=" v }' 'v=42' /f`,
        );
        expect(result.stdout).toBe("line:hello\nv=42\n");
        expect(result.exitCode).toBe(0);
      });

      // C11g: an assignment operand after a file applies only after
      // that file has been read.
      it("should apply a var=value operand after the preceding file, in order", async () => {
        const env = new Bash({ files: { "/f": "hello\n" } });
        const result = await env.exec(
          `awk '{ print "line:" $0 " v=[" v "]" } END { print "v=[" v "]" }' /f 'v=42'`,
        );
        expect(result.stdout).toBe("line:hello v=[]\nv=[42]\n");
        expect(result.exitCode).toBe(0);
      });

      // C11d: an invalid assignment operand (bad variable name) is
      // treated as a filename, as in gawk.
      it("should treat an invalid var=value operand as a filename", async () => {
        const env = new Bash({ files: { "/f": "hello\n" } });
        const result = await env.exec(
          `awk 'BEGIN{print "start"} {print $0}' '1x=42' /f`,
        );
        expect(result.stderr).toContain("1x=42");
        expect(result.exitCode).toBe(1);
      });

      // C11e: assignment operands do not process backslash escapes.
      it("should not process escapes in a var=value operand", async () => {
        const env = new Bash({ files: { "/f": "hello\n" } });
        const result = await env.exec(
          `awk 'END { print "v=[" v "]" }' 'v=a\\tb' /f`,
        );
        expect(result.stdout).toBe("v=[a\\tb]\n");
        expect(result.exitCode).toBe(0);
      });

      // C11f: an FS=, operand assigns FS (but only for later files,
      // as in gawk).
      it("should assign FS from an FS=, command-line operand", async () => {
        const env = new Bash({ files: { "/f": "hello\n" } });
        const result = await env.exec(
          `awk '{ print "NF=" NF " f1=[" $1 "]" } END { print "FS=[" FS "]" }' 'FS=,' /f`,
        );
        expect(result.stdout).toBe("NF=1 f1=[hello]\nFS=[,]\n");
        expect(result.exitCode).toBe(0);
      });

      // C11c: a value assigned through an ARGV var=value operand is
      // a strnum, so it sorts numerically.
      it("should keep a value assigned through an ARGV operand as a strnum", async () => {
        const env = new Bash({ files: { "/f": "hello\n" } });
        const result = await env.exec(
          `awk 'BEGIN { ARGV[1]="v=42"; ARGV[2]="/f"; ARGC=3 } END { a[1]=v; a[2]="100"; n=asort(a,b); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("42 100\n");
        expect(result.exitCode).toBe(0);
      });

      // C1b: NaN sorts after every number in the default mode.
      it("should sort NaN last in the default mode", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN { x=sqrt(-1); a[1]=x; a[2]=5; a[3]=2; n=asort(a,b); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("2 5\n");
      });

      // C1b2: the same for @val_num_asc.
      it("should sort NaN last in @val_num_asc", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN { x=sqrt(-1); a[1]=x; a[2]=5; a[3]=2; n=asort(a,b,"@val_num_asc"); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("2 5\n");
      });

      // NaN probe: in @val_num_asc and the default mode the NaN value
      // stays a number NaN and lands last.
      it("should keep NaN as a number NaN sorted last in @val_num_asc", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN{a[1]=sqrt(-1); a[2]=5; a[3]=2; asort(a,b,"@val_num_asc"); print (b[3]!=b[3]), b[1], b[2]}'`,
        );
        expect(result.stdout).toBe("1 2 5\n");
      });

      it("should keep NaN as a number NaN sorted last in the default mode", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN{a[1]=sqrt(-1); a[2]=5; a[3]=2; asort(a,b); print (b[3]!=b[3]), b[1], b[2]}'`,
        );
        expect(result.stdout).toBe("1 2 5\n");
      });

      // C4a: a field returned from a function keeps its strnum type.
      it("should keep a field's strnum type through a function return", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "42" | awk 'function getf() { return $1 } { x=getf(); a[1]=x; a[2]="100"; n=asort(a,b); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("42 100\n");
      });

      // C4b: a -v value keeps its strnum type.
      it("should keep a -v value as a strnum", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk -v v=42 'BEGIN { a[1]=v; a[2]="100"; n=asort(a,b); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("42 100\n");
      });

      // C4c: an array element copied through a computed key keeps its
      // strnum type.
      it("should keep a strnum through a computed-key array copy", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN { split("42 100", s); k=1; a[1]=s[k]; a[2]="100"; n=asort(a,b); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("42 100\n");
      });

      // C4d: a value read by getline keeps its strnum type.
      it("should keep a getline value as a strnum", async () => {
        const env = new Bash({ files: { "/f": "42\n" } });
        const result = await env.exec(
          `awk 'BEGIN{ while((getline x < "/f")>0){ a[1]=x; a[2]="100"; n=asort(a,b); print b[1], b[2] } }'`,
        );
        expect(result.stdout).toBe("42 100\n");
      });

      // C4e: assigning a plain string to a field makes it a plain
      // string, not a strnum.
      it("should not treat a field assigned a plain string as a strnum", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "x" | awk '{ $1="42"; x=$1; a[1]=x; a[2]="100"; n=asort(a,b); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("100 42\n");
      });

      // C14: a genuine tie — two numbers formatting to the same
      // CONVFMT key — keeps input order in both directions (the
      // default stable sort), as in gawk.
      it("should keep input order for a genuine CONVFMT tie in both directions", async () => {
        const env = new Bash();
        const result1 = await env.exec(
          `echo "" | awk -v CONVFMT=%.0f 'BEGIN{a[1]=1.4; a[2]=1.2; asort(a,b,"@val_str_asc"); print b[1], b[2]}'`,
        );
        expect(result1.stdout).toBe("1.4 1.2\n");
        const result2 = await env.exec(
          `echo "" | awk -v CONVFMT=%.0f 'BEGIN{a[1]=1.2; a[2]=1.4; asort(a,b,"@val_str_asc"); print b[1], b[2]}'`,
        );
        expect(result2.stdout).toBe("1.2 1.4\n");
      });

      // C14-rev: the literal "1.2" is NOT formatted by CONVFMT, so
      // "1" (from 1.4) sorts before "1.2" and the number comes first
      // even when the literal was first in the input.
      it("should sort a CONVFMT-formatted number before a literal string with the same digits", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk -v CONVFMT=%.0f 'BEGIN{a[1]="1.2"; a[2]=1.4; asort(a,b,"@val_str_asc"); print b[1], b[2]}'`,
        );
        expect(result.stdout).toBe("1.4 1.2\n");
      });

      // C14-120: the literal "1.20" keeps its trailing zero, so the
      // number 1.2 (formatted to "1") sorts before it.
      it("should not let a literal keep a CONVFMT tie with its numeric form", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk -v CONVFMT=%.0f 'BEGIN{a[1]="1.20"; a[2]=1.2; asort(a,b,"@val_str_asc"); print b[1], b[2]}'`,
        );
        expect(result.stdout).toBe("1.2 1.20\n");
      });

      // C8c: gawk's %g conversion does not add a sign for %+g on a
      // plain print (the flag is accepted and ignored for the value).
      it("should not add a sign for CONVFMT %+g on a plain print", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN { CONVFMT="%+g"; x=42; print "[" x "" "]" }'`,
        );
        expect(result.stdout).toBe("[42]\n");
      });

      // C8disc: the %+g sign flag is likewise ignored in string sort
      // keys, so -5 still sorts before 42.
      it("should ignore the %+g sign flag in @val_str_asc sort keys", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN { CONVFMT="%+g"; a[1]=42; a[2]="-5"; n=asort(a,b,"@val_str_asc"); print b[1], b[2] }'`,
        );
        expect(result.stdout).toBe("-5 42\n");
      });

      // P1: assigning a scalar to an omitted parameter succeeds; the
      // parameter is untyped until it is used, not an eager array.
      it("should let an omitted parameter take a scalar assignment", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'function f(a){ a=42; print "a=" a } BEGIN { f() }'`,
        );
        expect(result.stdout).toBe("a=42\n");
        expect(result.exitCode).toBe(0);
      });

      // P4: once an omitted parameter has been used as an array,
      // assigning it a scalar is a fatal error in gawk.
      it("should fatal when a scalar is assigned to an omitted parameter already used as an array", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'function f(a){ a[1]=9; a=42; print "a=" a } BEGIN { f() }'`,
        );
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("attempt to use array");
      });

      // P2: the same fatal applies to an array created by split.
      it("should fatal when a scalar is assigned to an array created by split", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN{split("", e); e=42; print "e=" e}'`,
        );
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("attempt to use array");
      });

      // ARGV probe: assigning a scalar to ARGV fatals, as in gawk.
      it("should fatal when a scalar is assigned to ARGV", async () => {
        const env = new Bash({ files: { "/one": "one-line\n" } });
        const result = await env.exec(`awk 'END{print "end"}' 'ARGV=1' /one`);
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain("attempt to use array");
      });

      // C12 pin: "01" alone does not name input index 1 — only the
      // canonical key is consulted — so with ARGV[1] deleted the
      // file is not read and stdin is used instead.
      it("should read stdin when only the noncanonical ARGV key 01 names a file", async () => {
        const env = new Bash({ files: { "/one": "one-line\n" } });
        const result = await env.exec(
          `printf 'stdin-line\\n' | awk 'BEGIN{ARGC=2; ARGV["01"]="/one"; delete ARGV[1]} {print FILENAME, $0}'`,
        );
        expect(result.stdout).toBe("- stdin-line\n");
      });

      // Re-sort probe: values produced by asort keep their strnum
      // provenance, so a second asort still sorts numerically.
      it("should keep strnum provenance through an asort destination on re-sort", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN{a[1]=5; a[2]="10"; asort(a,b,"@val_str_asc"); n=asort(b,c); print c[1], c[2]}'`,
        );
        expect(result.stdout).toBe("5 10\n");
      });

      // Large-integer probe: exact integer forms survive the string
      // sort key, so both equality checks hold.
      it("should keep exact large-integer forms in @val_str_asc", async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo "" | awk 'BEGIN{a[1]=1234567890123456789; a[2]="1234567890123456770"; n=asort(a,b,"@val_str_asc"); print (b[1]==1234567890123456789), (b[2]=="1234567890123456770")}'`,
        );
        expect(result.stdout).toBe("1 1\n");
      });
    });
  });
});

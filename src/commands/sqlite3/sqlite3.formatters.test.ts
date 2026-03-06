import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 formatters", () => {
  describe("list mode (default)", () => {
    it("should output pipe-separated by default", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 :memory: "SELECT 1, 2, 3"');
      expect(result.stdout).toBe("1|2|3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should output list mode explicitly with -list", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 -list :memory: "SELECT 1, 2, 3"');
      expect(result.stdout).toBe("1|2|3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle list mode with header", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -list -header :memory: "SELECT 1 as a, 2 as b"',
      );
      expect(result.stdout).toBe("a|b\n1|2\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("CSV edge cases", () => {
    it("should escape embedded quotes", async () => {
      const env = new Bash();
      // Use SQLite's quote escaping (double single quotes)
      const result = await env.exec(
        "sqlite3 -csv :memory: \"SELECT 'he said ''hello'''\"",
      );
      // Real sqlite3 wraps strings containing quotes in double quotes
      expect(result.stdout).toBe("\"he said 'hello'\"\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle CSV with header", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -csv -header :memory: "SELECT 1 as col1, 2 as col2"',
      );
      expect(result.stdout).toBe("col1,col2\n1,2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle empty values in CSV", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -csv :memory: \"SELECT '', 'x', ''\"",
      );
      expect(result.stdout).toBe(",x,\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("JSON edge cases", () => {
    it("should handle empty result as empty output", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -json :memory: "CREATE TABLE t(x INT); SELECT * FROM t"',
      );
      // Real sqlite3 outputs nothing for empty results in JSON mode
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should handle special characters in JSON", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -json :memory: \"SELECT 'line1\nline2' as x\"",
      );
      const parsed = JSON.parse(result.stdout);
      expect(parsed[0].x).toBe("line1\nline2");
      expect(result.exitCode).toBe(0);
    });

    it("should handle boolean-like values", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -json :memory: "SELECT 1 as t, 0 as f"',
      );
      const parsed = JSON.parse(result.stdout);
      expect(parsed[0]).toEqual({ t: 1, f: 0 });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("HTML edge cases", () => {
    it("should escape ampersand", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -html :memory: \"SELECT 'a & b'\"",
      );
      expect(result.stdout).toContain("a &amp; b");
      expect(result.exitCode).toBe(0);
    });

    it("should escape all HTML entities", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -html :memory: \"SELECT '<div>&</div>'\"",
      );
      expect(result.stdout).toContain("&lt;div");
      expect(result.stdout).toContain("&amp;");
      expect(result.stdout).toContain("&gt;");
      expect(result.exitCode).toBe(0);
    });

    it("should output header row with TH tags", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -html -header :memory: "SELECT 1 as col1, 2 as col2"',
      );
      expect(result.stdout).toContain("<TH>col1</TH>");
      expect(result.stdout).toContain("<TH>col2</TH>");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("line mode edge cases", () => {
    it("should align column names", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -line :memory: "SELECT 1 as aa, 2 as bbbb"',
      );
      // With min width 5, aa becomes "   aa" and bbbb becomes " bbbb"
      expect(result.stdout).toContain("aa = 1");
      expect(result.stdout).toContain("bbbb = 2");
      // Verify alignment - both should have = at same position
      // Don't use trim() as it removes leading spaces from first line
      const lines = result.stdout.split("\n").filter((l) => l.length > 0);
      const line1 = lines[0];
      const line2 = lines[1];
      expect(line1.indexOf("=")).toBe(line2.indexOf("="));
      expect(result.exitCode).toBe(0);
    });

    it("should handle multiple rows in line mode", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -line :memory: "SELECT 1 as x UNION SELECT 2"',
      );
      expect(result.stdout).toContain("x = 1");
      expect(result.stdout).toContain("x = 2");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("column mode edge cases", () => {
    it("should handle wide values", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -column -header :memory: \"SELECT 'short' as a, 'this is a very long value' as b\"",
      );
      expect(result.stdout).toContain("short");
      expect(result.stdout).toContain("this is a very long value");
      expect(result.exitCode).toBe(0);
    });

    it("should show separator line with header", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -column -header :memory: "SELECT 1 as aa, 2 as bbbb"',
      );
      expect(result.stdout).toContain("--");
      expect(result.stdout).toContain("----");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("table mode edge cases", () => {
    it("should handle empty result in table mode", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -table -header :memory: "CREATE TABLE t(x); SELECT * FROM t"',
      );
      // Should still show table structure with header
      expect(result.stdout).toContain("+");
      expect(result.stdout).toContain("x");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("box mode edge cases", () => {
    it("should handle single column in box mode", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -box :memory: "SELECT 42 as value"',
      );
      expect(result.stdout).toContain("┌");
      expect(result.stdout).toContain("└");
      expect(result.stdout).toContain("value");
      expect(result.stdout).toContain("42");
      expect(result.exitCode).toBe(0);
    });

    it("should handle wide content in box mode", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -box :memory: \"SELECT 'this is a long string' as col\"",
      );
      expect(result.stdout).toContain("this is a long string");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("quote mode edge cases", () => {
    it("should show integers without quotes", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 -quote :memory: "SELECT 42"');
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });

    it("should show floats without quotes", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 -quote :memory: "SELECT 3.14"');
      // Full IEEE 754 precision like real sqlite3
      expect(result.stdout).toBe("3.1400000000000001\n");
      expect(result.exitCode).toBe(0);
    });

    it("should quote strings", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 -quote :memory: \"SELECT 'hello'\"",
      );
      expect(result.stdout).toBe("'hello'\n");
      expect(result.exitCode).toBe(0);
    });

    it("should show NULL as NULL keyword", async () => {
      const env = new Bash();
      const result = await env.exec('sqlite3 -quote :memory: "SELECT NULL"');
      expect(result.stdout).toBe("NULL\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("nullvalue with different modes", () => {
    it("should apply nullvalue in list mode", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -nullvalue "N/A" :memory: "SELECT NULL, 1"',
      );
      expect(result.stdout).toBe("N/A|1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should apply nullvalue in CSV mode", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -csv -nullvalue "N/A" :memory: "SELECT NULL, 1"',
      );
      expect(result.stdout).toBe("N/A,1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should apply nullvalue in column mode", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -column -nullvalue "NULL" :memory: "SELECT NULL as x"',
      );
      expect(result.stdout).toContain("NULL");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("BLOB handling", () => {
    it("should output BLOB as decoded text", async () => {
      const env = new Bash();
      const result = await env.exec(
        "sqlite3 :memory: \"SELECT X'48454C4C4F'\"",
      );
      // Real sqlite3 outputs BLOB as decoded text
      expect(result.stdout).toBe("HELLO\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("combined options", () => {
    it("should combine -csv -header -nullvalue", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -csv -header -nullvalue "N/A" :memory: "SELECT 1 as a, NULL as b"',
      );
      expect(result.stdout).toBe("a,b\n1,N/A\n");
      expect(result.exitCode).toBe(0);
    });

    it("should combine -json with -cmd", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -json -cmd "CREATE TABLE t(x); INSERT INTO t VALUES(42)" :memory: "SELECT * FROM t"',
      );
      expect(result.stdout).toBe('[{"x":42}]\n');
      expect(result.exitCode).toBe(0);
    });

    it("should combine -echo with -header", async () => {
      const env = new Bash();
      const result = await env.exec(
        'sqlite3 -echo -header :memory: "SELECT 1 as x"',
      );
      expect(result.stdout).toContain("SELECT 1 as x");
      expect(result.stdout).toContain("x");
      expect(result.stdout).toContain("1");
      expect(result.exitCode).toBe(0);
    });
  });
});

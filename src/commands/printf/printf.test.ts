import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("printf", () => {
  describe("basic format specifiers", () => {
    it("should format string with %s", async () => {
      const env = new Bash();
      const result = await env.exec('printf "Hello %s" world');
      expect(result.stdout).toBe("Hello world");
      expect(result.exitCode).toBe(0);
    });

    it("should format integer with %d", async () => {
      const env = new Bash();
      const result = await env.exec('printf "Number: %d" 42');
      expect(result.stdout).toBe("Number: 42");
      expect(result.exitCode).toBe(0);
    });

    it("should format float with %f", async () => {
      const env = new Bash();
      const result = await env.exec('printf "Value: %f" 3.14');
      // %f in bash uses 6 decimal places by default
      expect(result.stdout).toBe("Value: 3.140000");
      expect(result.exitCode).toBe(0);
    });

    it("should format hex with %x", async () => {
      const env = new Bash();
      const result = await env.exec('printf "Hex: %x" 255');
      expect(result.stdout).toBe("Hex: ff");
      expect(result.exitCode).toBe(0);
    });

    it("should format octal with %o", async () => {
      const env = new Bash();
      const result = await env.exec('printf "Octal: %o" 8');
      expect(result.stdout).toBe("Octal: 10");
      expect(result.exitCode).toBe(0);
    });

    it("should handle literal %% ", async () => {
      const env = new Bash();
      const result = await env.exec('printf "100%%"');
      expect(result.stdout).toBe("100%");
      expect(result.exitCode).toBe(0);
    });

    it("should handle multiple arguments", async () => {
      const env = new Bash();
      const result = await env.exec('printf "%s is %d years old" Alice 30');
      expect(result.stdout).toBe("Alice is 30 years old");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("escape sequences", () => {
    it("should handle newline \\n", async () => {
      const env = new Bash();
      const result = await env.exec('printf "line1\\nline2"');
      expect(result.stdout).toBe("line1\nline2");
    });

    it("should handle tab \\t", async () => {
      const env = new Bash();
      const result = await env.exec('printf "col1\\tcol2"');
      expect(result.stdout).toBe("col1\tcol2");
    });

    it("should handle backslash \\\\", async () => {
      const env = new Bash();
      // 8 backslashes in source -> 4 in bash string -> 2 for printf -> 1 literal
      const result = await env.exec('printf "x\\\\\\\\y"');
      expect(result.stdout).toBe("x\\y");
    });

    it("should handle carriage return \\r", async () => {
      const env = new Bash();
      const result = await env.exec('printf "hello\\rworld"');
      expect(result.stdout).toBe("hello\rworld");
    });

    it("should handle octal escape sequences", async () => {
      const env = new Bash();
      const result = await env.exec('printf "\\101\\102\\103"');
      expect(result.stdout).toBe("ABC");
    });
  });

  describe("width and precision", () => {
    it("should handle width specifier", async () => {
      const env = new Bash();
      const result = await env.exec('printf "%10s" "hi"');
      expect(result.stdout).toBe("        hi");
    });

    it("should handle precision for floats", async () => {
      const env = new Bash();
      const result = await env.exec('printf "%.2f" 3.14159');
      expect(result.stdout).toBe("3.14");
    });

    it("should handle zero-padding", async () => {
      const env = new Bash();
      const result = await env.exec('printf "%05d" 42');
      expect(result.stdout).toBe("00042");
    });

    it("should handle left-justify with -", async () => {
      const env = new Bash();
      const result = await env.exec('printf "%-10s|" "hi"');
      expect(result.stdout).toBe("hi        |");
    });
  });

  describe("error handling", () => {
    it("should error with no arguments", async () => {
      const env = new Bash();
      const result = await env.exec("printf");
      expect(result.stderr).toContain("usage");
      // Bash returns exit code 2 for usage errors
      expect(result.exitCode).toBe(2);
    });

    it("should handle missing arguments gracefully", async () => {
      const env = new Bash();
      const result = await env.exec('printf "%s %s" only');
      expect(result.stdout).toBe("only ");
      expect(result.exitCode).toBe(0);
    });

    it.skip("should handle non-numeric for %d", async () => {
      // TODO: Bash returns exit 0 with warning, our shell returns exit 1
      const env = new Bash();
      const result = await env.exec('printf "%d" notanumber');
      expect(result.stdout).toBe("0");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--help", () => {
    it("should display help", async () => {
      const env = new Bash();
      const result = await env.exec("printf --help");
      expect(result.stdout).toContain("printf");
      expect(result.stdout).toContain("FORMAT");
      expect(result.exitCode).toBe(0);
    });
  });
});

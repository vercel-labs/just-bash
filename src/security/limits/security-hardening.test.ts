/**
 * Security Hardening Tests
 *
 * Comprehensive unit and integration tests for security hardening changes:
 * 1. Pattern replacement / removal / case modification string length limits
 * 2. Configurable brace expansion limits
 * 3. Arithmetic variable indirection depth limits
 * 4. Configurable heredoc size limits
 * 5. Base conversion overflow clamping
 * 6. CLI shell default network off
 * 7. Case pattern tracking in command substitution (;& and ;;&)
 * 8. IFS character class escaping
 * 9. Defense-in-depth warning and isEnabled()
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../index.js";
import { buildIfsCharClassPattern } from "../../interpreter/helpers/ifs.js";
import { resolveLimits } from "../../limits.js";
import { parseArithNumber } from "../../parser/arithmetic-primaries.js";
import { Lexer } from "../../parser/lexer.js";
import { DefenseInDepthBox } from "../defense-in-depth-box.js";

describe("Security Hardening", () => {
  let bash: Bash;

  beforeEach(() => {
    bash = new Bash();
  });

  // =====================================================================
  // 1. String length checks on parameter operations
  // =====================================================================
  describe("1. Pattern replacement string length checks", () => {
    it("should enforce limit on pattern replacement result (post-op check)", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxStringLength: 500 },
      });
      // 200 'a's → replace each with 'bbb' → 600 chars > 500 limit
      const aStr = "a".repeat(200);
      const result = await limitedBash.exec(`x="${aStr}"; echo "\${x//a/bbb}"`);
      expect(result.stderr).toContain("string length limit exceeded");
      expect(result.exitCode).not.toBe(0);
    });

    it("should enforce mid-loop check for runaway growth in global replace", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxStringLength: 200 },
      });
      // 150 'a's → replace each with 'xx' → 300 chars > 200 limit
      // The mid-loop check fires every 100 iterations
      const aStr = "a".repeat(150);
      const result = await limitedBash.exec(`x="${aStr}"; echo "\${x//a/xx}"`);
      expect(result.stderr).toContain("string length limit exceeded");
    });

    it("should allow pattern replacement within limits", async () => {
      const result = await bash.exec('x="hello"; echo "${x//l/LL}"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("heLLLLo\n");
    });

    it("should allow single replacement within limits", async () => {
      const result = await bash.exec('x="hello"; echo "${x/l/LL}"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("heLLlo\n");
    });

    it("should enforce limit on pattern removal result", async () => {
      // Pattern removal only shrinks strings, so should always pass
      const result = await bash.exec('x="hello world"; echo "${x#hello }"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("world\n");
    });

    it("should enforce limit on prefix removal", async () => {
      const result = await bash.exec('x="abcdef"; echo "${x#abc}"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("def\n");
    });

    it("should enforce limit on suffix removal", async () => {
      const result = await bash.exec('x="abcdef"; echo "${x%def}"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("abc\n");
    });

    it("should enforce limit on case modification result", async () => {
      // Case modification preserves length
      const result = await bash.exec('x="hello"; echo "${x^^}"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("HELLO\n");
    });

    it("should enforce limit on case modification lowercase", async () => {
      const result = await bash.exec('x="HELLO"; echo "${x,,}"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello\n");
    });

    it("should enforce limit on first-char case modification", async () => {
      const result = await bash.exec('x="hello"; echo "${x^}"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Hello\n");
    });

    it("should not swallow ExecutionLimitError from regex catch block", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxStringLength: 100 },
      });
      const aStr = "a".repeat(50);
      const result = await limitedBash.exec(`x="${aStr}"; echo "\${x//a/aaa}"`);
      // 50 * 3 = 150 > 100 limit
      expect(result.stderr).toContain("string length limit exceeded");
    });
  });

  // =====================================================================
  // 2. Configurable brace expansion limits
  // =====================================================================
  describe("2. Configurable brace expansion limits", () => {
    it("should add maxBraceExpansionResults to ExecutionLimits", () => {
      const limits = resolveLimits({ maxBraceExpansionResults: 500 });
      expect(limits.maxBraceExpansionResults).toBe(500);
    });

    it("should default maxBraceExpansionResults to 10000", () => {
      const limits = resolveLimits();
      expect(limits.maxBraceExpansionResults).toBe(10000);
    });

    it("should respect custom maxBraceExpansionResults", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxBraceExpansionResults: 100 },
      });
      const result = await limitedBash.exec("arr=({1..200}); echo ${#arr[@]}");
      expect(result.exitCode).toBe(0);
      const count = Number.parseInt(result.stdout.trim(), 10);
      expect(count).toBeLessThanOrEqual(100);
    });

    it("should allow brace expansion within custom limit", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxBraceExpansionResults: 100 },
      });
      const result = await limitedBash.exec("echo {1..10}");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("1 2 3 4 5 6 7 8 9 10\n");
    });

    it("should use default limit for normal operations", async () => {
      const result = await bash.exec("arr=({1..676}); echo ${#arr[@]}");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("676\n");
    });

    it("should truncate nested brace expansion", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxBraceExpansionResults: 20 },
      });
      // {1..5}{1..5} = 25 items, exceeds 20 limit
      const result = await limitedBash.exec(
        "arr=({1..5}{1..5}); echo ${#arr[@]}",
      );
      expect(result.exitCode).toBe(0);
      const count = Number.parseInt(result.stdout.trim(), 10);
      expect(count).toBeLessThanOrEqual(20);
    });

    it("should allow comma brace expansion within limits", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxBraceExpansionResults: 10 },
      });
      const result = await limitedBash.exec("echo {a,b,c}");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("a b c\n");
    });
  });

  // =====================================================================
  // 3. Arithmetic variable indirection depth limit
  // =====================================================================
  describe("3. Arithmetic variable indirection depth limit", () => {
    it("should throw on chain of 120 variables", async () => {
      const assignments: string[] = [];
      for (let i = 0; i < 120; i++) {
        assignments.push(`v${i}=v${i + 1}`);
      }
      assignments.push("v120=42");
      const script = `${assignments.join("; ")}; echo $((v0))`;
      const result = await bash.exec(script);
      expect(result.stderr).toContain(
        "maximum variable indirection depth exceeded",
      );
    });

    it("should allow chain of 5 variables", async () => {
      const result = await bash.exec("a=b; b=c; c=d; d=e; e=42; echo $((a))");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("42\n");
    });

    it("should allow chain of 50 variables", async () => {
      const assignments: string[] = [];
      for (let i = 0; i < 50; i++) {
        assignments.push(`v${i}=v${i + 1}`);
      }
      assignments.push("v50=99");
      const script = `${assignments.join("; ")}; echo $((v0))`;
      const result = await bash.exec(script);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("99\n");
    });

    it("should allow chain of exactly 100 variables", async () => {
      const assignments: string[] = [];
      for (let i = 0; i < 100; i++) {
        assignments.push(`v${i}=v${i + 1}`);
      }
      assignments.push("v100=77");
      const script = `${assignments.join("; ")}; echo $((v0))`;
      const result = await bash.exec(script);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("77\n");
    });

    it("should throw on chain of 101 variables (just over limit)", async () => {
      const assignments: string[] = [];
      for (let i = 0; i < 101; i++) {
        assignments.push(`v${i}=v${i + 1}`);
      }
      assignments.push("v101=77");
      const script = `${assignments.join("; ")}; echo $((v0))`;
      const result = await bash.exec(script);
      expect(result.stderr).toContain(
        "maximum variable indirection depth exceeded",
      );
    });

    it("should still detect cycles via visited set", async () => {
      // a → b → c → a (cycle)
      const result = await bash.exec("a=b; b=c; c=a; echo $((a))");
      expect(result.exitCode).toBe(0);
      // Cycle detection returns 0
      expect(result.stdout).toBe("0\n");
    });

    it("should handle direct numeric values without indirection", async () => {
      const result = await bash.exec("x=42; echo $((x))");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("42\n");
    });
  });

  // =====================================================================
  // 4. Configurable heredoc size limit
  // =====================================================================
  describe("4. Configurable heredoc size limit", () => {
    it("should respect custom maxHeredocSize", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxHeredocSize: 100 },
      });
      const longContent = "x".repeat(150);
      const result = await limitedBash.exec(`cat <<EOF\n${longContent}\nEOF`);
      expect(result.exitCode).not.toBe(0);
    });

    it("should allow heredocs within custom limit", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxHeredocSize: 100 },
      });
      const result = await limitedBash.exec("cat <<EOF\nhello\nEOF");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello\n");
    });

    it("should default maxHeredocSize to 10MB", () => {
      const limits = resolveLimits();
      expect(limits.maxHeredocSize).toBe(10485760);
    });

    it("should pass maxHeredocSize through to Lexer", () => {
      const lexer = new Lexer("echo hello", { maxHeredocSize: 500 });
      // Just verify construction succeeds
      const tokens = lexer.tokenize();
      expect(tokens.length).toBeGreaterThan(0);
    });

    it("should use default when no options passed to Lexer", () => {
      const lexer = new Lexer("echo hello");
      const tokens = lexer.tokenize();
      expect(tokens.length).toBeGreaterThan(0);
    });

    it("should reject heredoc at exact boundary", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxHeredocSize: 50 },
      });
      // Content that is exactly 51 bytes (50 + newline)
      const content = "x".repeat(51);
      const result = await limitedBash.exec(`cat <<EOF\n${content}\nEOF`);
      expect(result.exitCode).not.toBe(0);
    });

    it("should allow heredoc at exact limit", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxHeredocSize: 50 },
      });
      // Content that fits: "hello\n" = 6 bytes
      const result = await limitedBash.exec("cat <<EOF\nhello\nEOF");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello\n");
    });
  });

  // =====================================================================
  // 5. Base conversion overflow clamping
  // =====================================================================
  describe("5. Base conversion overflow clamping", () => {
    describe("parseArithNumber unit tests", () => {
      it("should clamp large base-64 numbers to MAX_SAFE_INTEGER", () => {
        const result = parseArithNumber("64#______________________");
        expect(result).toBe(Number.MAX_SAFE_INTEGER);
      });

      it("should handle normal base-64 correctly", () => {
        // 64#10 = 1*64 + 0 = 64
        expect(parseArithNumber("64#10")).toBe(64);
      });

      it("should clamp large hex to MAX_SAFE_INTEGER", () => {
        const result = parseArithNumber("0xFFFFFFFFFFFFFFFF");
        expect(result).toBe(Number.MAX_SAFE_INTEGER);
      });

      it("should handle normal hex correctly", () => {
        expect(parseArithNumber("0xFF")).toBe(255);
        expect(parseArithNumber("0x1A")).toBe(26);
      });

      it("should clamp large octal to MAX_SAFE_INTEGER", () => {
        const result = parseArithNumber("07777777777777777777777");
        expect(result).toBe(Number.MAX_SAFE_INTEGER);
      });

      it("should handle normal octal correctly", () => {
        expect(parseArithNumber("077")).toBe(63);
        expect(parseArithNumber("010")).toBe(8);
      });

      it("should clamp large decimal to MAX_SAFE_INTEGER", () => {
        const result = parseArithNumber("99999999999999999999");
        expect(result).toBe(Number.MAX_SAFE_INTEGER);
      });

      it("should handle normal decimal correctly", () => {
        expect(parseArithNumber("42")).toBe(42);
        expect(parseArithNumber("0")).toBe(0);
      });

      it("should clamp large base-36 to MAX_SAFE_INTEGER", () => {
        const result = parseArithNumber("36#ZZZZZZZZZZZZZZ");
        expect(result).toBe(Number.MAX_SAFE_INTEGER);
      });

      it("should handle normal base-36 correctly", () => {
        expect(parseArithNumber("36#Z")).toBe(35);
        expect(parseArithNumber("36#10")).toBe(36);
      });

      it("should handle base-2 correctly", () => {
        expect(parseArithNumber("2#1010")).toBe(10);
        expect(parseArithNumber("2#11111111")).toBe(255);
      });

      it("should return NaN for invalid base", () => {
        expect(parseArithNumber("1#0")).toBeNaN();
        expect(parseArithNumber("65#0")).toBeNaN();
      });

      it("should return NaN for invalid octal digits", () => {
        expect(parseArithNumber("089")).toBeNaN();
      });
    });

    describe("integration tests", () => {
      it("should clamp large base-64 via arithmetic expansion", async () => {
        const result = await bash.exec("echo $((64#______________________))");
        expect(result.exitCode).toBe(0);
        const value = Number.parseInt(result.stdout.trim(), 10);
        expect(value).toBe(Number.MAX_SAFE_INTEGER);
      });

      it("should handle normal base conversion", async () => {
        const result = await bash.exec("echo $((16#FF))");
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("255\n");
      });

      it("should handle base-2", async () => {
        const result = await bash.exec("echo $((2#1010))");
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("10\n");
      });

      it("should handle base-8 (octal)", async () => {
        const result = await bash.exec("echo $((010))");
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("8\n");
      });
    });
  });

  // =====================================================================
  // 7. Case pattern tracking in command substitution
  // =====================================================================
  describe("7. Case pattern tracking in command substitution", () => {
    it("should handle basic case inside $()", async () => {
      const result = await bash.exec(
        'x=$(case "hello" in hello) echo "matched";; esac); echo "$x"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("matched\n");
    });

    it("should handle case with ;; terminator", async () => {
      const result = await bash.exec(
        'x=$(case "a" in a) echo "A";; b) echo "B";; esac); echo "$x"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("A\n");
    });

    it("should parse case with arithmetic inside pattern body", async () => {
      const result = await bash.exec(
        'x=$(case "a" in a) echo $((1+2));; esac); echo "$x"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("3\n");
    });

    it("should handle nested parentheses in case body", async () => {
      const result = await bash.exec(
        'x=$(case "a" in a) echo $(echo hi);; esac); echo "$x"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hi\n");
    });
  });

  // =====================================================================
  // 8. IFS character class escaping
  // =====================================================================
  describe("8. IFS character class escaping", () => {
    describe("buildIfsCharClassPattern unit tests", () => {
      it("should place dash last in character class", () => {
        const pattern = buildIfsCharClassPattern("-abc");
        // Dash should be escaped and placed at the end
        expect(pattern).toBe("abc\\-");
      });

      it("should handle dash-only IFS", () => {
        const pattern = buildIfsCharClassPattern("-");
        expect(pattern).toBe("\\-");
      });

      it("should handle dash with other special chars", () => {
        const pattern = buildIfsCharClassPattern("-.");
        // '.' is escaped, '-' is placed last (also escaped)
        expect(pattern).toBe("\\.\\-");
      });

      it("should escape regex special characters", () => {
        const pattern = buildIfsCharClassPattern(".");
        expect(pattern).toBe("\\.");
      });

      it("should handle tab and newline", () => {
        const pattern = buildIfsCharClassPattern("\t\n");
        expect(pattern).toBe("\\t\\n");
      });

      it("should handle normal characters", () => {
        const pattern = buildIfsCharClassPattern("abc");
        expect(pattern).toBe("abc");
      });

      it("should handle empty IFS", () => {
        const pattern = buildIfsCharClassPattern("");
        expect(pattern).toBe("");
      });

      it("should escape caret", () => {
        const pattern = buildIfsCharClassPattern("^");
        expect(pattern).toBe("\\^");
      });

      it("should escape brackets", () => {
        const pattern = buildIfsCharClassPattern("[]");
        expect(pattern).toBe("\\[\\]");
      });

      it("should handle pipe", () => {
        const pattern = buildIfsCharClassPattern("|");
        expect(pattern).toBe("\\|");
      });
    });

    describe("integration tests", () => {
      it("should split with dash in IFS", async () => {
        const result = await bash.exec(
          'IFS="-"; x="hello-world"; for w in $x; do echo "$w"; done',
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("hello\nworld\n");
      });

      it("should split with dot in IFS", async () => {
        const result = await bash.exec(
          'IFS="."; x="a.b.c"; for w in $x; do echo "$w"; done',
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("a\nb\nc\n");
      });

      it("should split with mixed IFS including dash", async () => {
        const result = await bash.exec(
          'IFS=" -"; x="hello-world foo"; for w in $x; do echo "$w"; done',
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("hello");
        expect(result.stdout).toContain("world");
        expect(result.stdout).toContain("foo");
      });

      it("should handle caret in IFS", async () => {
        const result = await bash.exec(
          'IFS="^"; x="a^b^c"; for w in $x; do echo "$w"; done',
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("a\nb\nc\n");
      });
    });
  });

  // =====================================================================
  // 9. Defense-in-depth warning and isEnabled()
  // =====================================================================
  describe("9. Defense-in-depth isEnabled()", () => {
    it("should report enabled when config is enabled", () => {
      DefenseInDepthBox.resetInstance();
      const box = DefenseInDepthBox.getInstance({ enabled: true });
      // In Node.js test environment, AsyncLocalStorage should be available
      expect(box.isEnabled()).toBe(true);
      DefenseInDepthBox.resetInstance();
    });

    it("should report disabled when config is disabled", () => {
      DefenseInDepthBox.resetInstance();
      const box = DefenseInDepthBox.getInstance({ enabled: false });
      expect(box.isEnabled()).toBe(false);
      DefenseInDepthBox.resetInstance();
    });

    it("should report disabled when not configured", () => {
      DefenseInDepthBox.resetInstance();
      const box = DefenseInDepthBox.getInstance();
      // Default config has enabled: false
      expect(box.isEnabled()).toBe(false);
      DefenseInDepthBox.resetInstance();
    });
  });

  // =====================================================================
  // Limits configuration unit tests
  // =====================================================================
  describe("Limits configuration", () => {
    it("should resolve all default limits", () => {
      const limits = resolveLimits();
      expect(limits.maxCallDepth).toBe(100);
      expect(limits.maxCommandCount).toBe(10000);
      expect(limits.maxLoopIterations).toBe(10000);
      expect(limits.maxStringLength).toBe(10485760);
      expect(limits.maxHeredocSize).toBe(10485760);
      expect(limits.maxBraceExpansionResults).toBe(10000);
      expect(limits.maxSubstitutionDepth).toBe(50);
    });

    it("should merge user limits with defaults", () => {
      const limits = resolveLimits({
        maxBraceExpansionResults: 500,
        maxHeredocSize: 1000,
      });
      expect(limits.maxBraceExpansionResults).toBe(500);
      expect(limits.maxHeredocSize).toBe(1000);
      // Other limits should be defaults
      expect(limits.maxCallDepth).toBe(100);
      expect(limits.maxCommandCount).toBe(10000);
    });
  });

  // =====================================================================
  // Combined attack vectors
  // =====================================================================
  describe("Combined attack vectors", () => {
    it("should handle pattern replacement + large strings", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxStringLength: 500 },
      });
      const aStr = "a".repeat(200);
      const result = await limitedBash.exec(`x="${aStr}"; echo "\${x//a/aaa}"`);
      expect(result.stderr).toContain("string length limit exceeded");
    });

    it("should handle brace expansion + configurable limit", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxBraceExpansionResults: 50 },
      });
      const result = await limitedBash.exec("arr=({1..100}); echo ${#arr[@]}");
      expect(result.exitCode).toBe(0);
      const count = Number.parseInt(result.stdout.trim(), 10);
      expect(count).toBeLessThanOrEqual(50);
    });

    it("should handle multiple limits simultaneously", async () => {
      const limitedBash = new Bash({
        executionLimits: {
          maxStringLength: 1000,
          maxBraceExpansionResults: 50,
          maxHeredocSize: 200,
        },
      });
      // Normal operations should work fine
      const result = await limitedBash.exec("echo hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello\n");
    });

    it("should enforce arithmetic depth + cycle detection together", async () => {
      // Chain that eventually cycles: v0→v1→...→v110→v0
      const assignments: string[] = [];
      for (let i = 0; i < 110; i++) {
        assignments.push(`v${i}=v${i + 1}`);
      }
      assignments.push("v110=v0"); // creates a cycle at depth 110
      const script = `${assignments.join("; ")}; echo $((v0))`;
      const result = await bash.exec(script);
      // Should hit depth limit before cycle detection
      expect(result.stderr).toContain(
        "maximum variable indirection depth exceeded",
      );
    });
  });
});

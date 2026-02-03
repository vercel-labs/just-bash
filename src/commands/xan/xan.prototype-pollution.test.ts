import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * Tests for xan (CSV processing) prototype pollution defense.
 *
 * xan has attack vectors through CSV headers which become object keys.
 * All CsvRow objects now use null-prototype (Object.create(null)) to prevent
 * prototype pollution when user-controlled CSV column names match
 * JavaScript prototype keywords.
 */

// Keywords to test - excludes __proto__ as it causes issues with shell escaping
const DANGEROUS_KEYWORDS = [
  // Core prototype keywords
  "constructor",
  "prototype",
  // Object.prototype methods
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toString",
  "valueOf",
  "toLocaleString",
];

describe("xan prototype pollution defense", () => {
  describe("CSV headers with dangerous keywords - select", () => {
    for (const keyword of DANGEROUS_KEYWORDS) {
      it(`should handle CSV header '${keyword}' in select`, async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo '${keyword},value\ntest,data' | xan select ${keyword}`,
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(keyword);
        expect(result.stdout).toContain("test");
      });
    }
  });

  describe("CSV headers with dangerous keywords - drop", () => {
    for (const keyword of DANGEROUS_KEYWORDS.slice(0, 4)) {
      it(`should handle CSV header '${keyword}' in drop`, async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo '${keyword},value,normal\ntest,data,keep' | xan drop ${keyword}`,
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("value");
        expect(result.stdout).toContain("normal");
      });
    }
  });

  describe("xan sort with dangerous keyword columns", () => {
    for (const keyword of DANGEROUS_KEYWORDS.slice(0, 4)) {
      it(`should sort by column named '${keyword}'`, async () => {
        const env = new Bash();
        const result = await env.exec(`
          echo '${keyword},data
z,1
a,2' | xan sort -s ${keyword}
        `);
        expect(result.exitCode).toBe(0);
        const lines = result.stdout.trim().split("\n");
        expect(lines[1]).toContain("a");
        expect(lines[2]).toContain("z");
      });
    }
  });

  describe("xan headers with dangerous keywords", () => {
    it("should show headers including all dangerous keywords", async () => {
      const env = new Bash();
      const testHeaders = DANGEROUS_KEYWORDS.slice(0, 5).join(",");
      const result = await env.exec(`
        echo '${testHeaders}' | xan headers
      `);
      expect(result.exitCode).toBe(0);
      for (const keyword of DANGEROUS_KEYWORDS.slice(0, 5)) {
        expect(result.stdout).toContain(keyword);
      }
    });
  });

  describe("xan explode with dangerous keyword columns", () => {
    it("should explode column named constructor", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo 'constructor,value
a|b,1' | xan explode constructor
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("constructor");
      const lines = result.stdout.trim().split("\n");
      expect(lines.length).toBe(3); // header + 2 data rows
    });
  });

  describe("xan transpose with dangerous keyword columns", () => {
    it("should transpose with dangerous keyword headers", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo 'constructor,a,b
prototype,1,2' | xan transpose
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("constructor");
      expect(result.stdout).toContain("prototype");
    });
  });

  describe("xan enum with dangerous keyword column name", () => {
    it("should add index column named constructor", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo 'value
a
b' | xan enum -c constructor
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("constructor");
      expect(result.stdout).toContain("0");
      expect(result.stdout).toContain("1");
    });
  });

  describe("xan does not pollute JavaScript prototype", () => {
    it("should not pollute Object.prototype via CSV headers", async () => {
      const env = new Bash();

      // Process CSV with all dangerous keywords as column names
      for (const keyword of DANGEROUS_KEYWORDS) {
        await env.exec(`
          echo '${keyword},other
polluted_${keyword},value' | xan select ${keyword}
        `);
      }

      // Verify JavaScript Object.prototype is not affected
      const testObj: Record<string, unknown> = {};
      expect(Object.hasOwn(Object.prototype, "polluted_constructor")).toBe(
        false,
      );
      expect(Object.hasOwn(Object.prototype, "polluted___proto__")).toBe(false);
      expect(Object.hasOwn(Object.prototype, "polluted_prototype")).toBe(false);
      expect(testObj.__proto__).toBe(Object.prototype);
      expect(typeof testObj.constructor).toBe("function");
      expect(typeof testObj.toString).toBe("function");
      expect(typeof testObj.hasOwnProperty).toBe("function");
    });

    it("should not pollute Object.prototype via xan transpose", async () => {
      const env = new Bash();

      await env.exec(`
        echo 'constructor,a,b
prototype,polluted,hacked' | xan transpose
      `);

      // Verify JavaScript Object.prototype is not affected
      const testObj: Record<string, unknown> = {};
      expect(testObj.__proto__).toBe(Object.prototype);
      expect(typeof testObj.constructor).toBe("function");
    });

    it("should not pollute Object.prototype via xan explode", async () => {
      const env = new Bash();

      await env.exec(`
        echo 'constructor,value
polluted|hacked,data' | xan explode constructor
      `);

      // Verify JavaScript Object.prototype is not affected
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
      expect(Object.hasOwn(Object.prototype, "hacked")).toBe(false);
    });
  });
});

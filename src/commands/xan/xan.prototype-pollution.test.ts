import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * Tests for xan (CSV processing) prototype pollution defense.
 *
 * xan has attack vectors through CSV headers which become object keys.
 */

const DANGEROUS_KEYWORDS = [
  "constructor",
  "prototype",
  "hasOwnProperty",
  "toString",
];

describe("xan prototype pollution defense", () => {
  describe("CSV headers with dangerous keywords", () => {
    for (const keyword of DANGEROUS_KEYWORDS) {
      it(`should handle CSV header '${keyword}'`, async () => {
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

  describe("xan sort with dangerous keyword columns", () => {
    it("should sort by column named constructor", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo 'constructor,data
z,1
a,2' | xan sort -s constructor
      `);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.trim().split("\n");
      expect(lines[1]).toContain("a");
      expect(lines[2]).toContain("z");
    });
  });

  describe("xan headers with dangerous keywords", () => {
    it("should show headers including dangerous keywords", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo 'constructor,prototype,normal' | xan headers
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("constructor");
      expect(result.stdout).toContain("prototype");
    });
  });

  describe("xan does not pollute JavaScript prototype", () => {
    it("should not pollute Object.prototype via CSV headers", async () => {
      const env = new Bash();
      await env.exec(`
        echo 'constructor,prototype
polluted,hacked' | xan select constructor
      `);

      // Verify JavaScript Object.prototype is not affected
      const testObj: Record<string, unknown> = {};
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
      expect(testObj.__proto__).toBe(Object.prototype);
      expect(typeof testObj.constructor).toBe("function");
    });
  });
});

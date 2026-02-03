import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * Tests for yq prototype pollution defense.
 *
 * yq uses the same query engine as jq, so it has similar attack vectors.
 */

const DANGEROUS_KEYWORDS = [
  "constructor",
  "__proto__",
  "prototype",
  "hasOwnProperty",
  "toString",
];

describe("yq prototype pollution defense", () => {
  describe("YAML input with dangerous keys", () => {
    for (const keyword of DANGEROUS_KEYWORDS.slice(0, 3)) {
      it(`should handle YAML key '${keyword}'`, async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo '${keyword}: value' | yq '.${keyword}'`,
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("value");
      });
    }
  });

  describe("JSON input with dangerous keys", () => {
    for (const keyword of DANGEROUS_KEYWORDS.slice(0, 3)) {
      it(`should handle JSON key '${keyword}'`, async () => {
        const env = new Bash();
        const result = await env.exec(
          `echo '{"${keyword}": "value"}' | yq -p json '.${keyword}'`,
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("value");
      });
    }
  });

  describe("yq key operations with dangerous keys", () => {
    it("should list keys including __proto__", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo '__proto__: a
constructor: b
normal: c' | yq 'keys'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("__proto__");
      expect(result.stdout).toContain("constructor");
    });

    it("should handle to_entries with dangerous keys", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo 'constructor: val' | yq 'to_entries | .[0].key'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("constructor");
    });

    it("should handle has() with dangerous key", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo 'constructor: value' | yq 'has("constructor")'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("true");
    });

    it("should return false for has() on missing dangerous key", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo 'other: value' | yq 'has("__proto__")'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("false");
    });
  });

  describe("yq $ENV with dangerous keywords", () => {
    it("should access $ENV.constructor safely", async () => {
      const env = new Bash();
      const result = await env.exec(`
        export constructor=ctor_value
        echo 'null' | yq '$ENV.constructor'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("ctor_value");
    });

    it("should access $ENV.prototype safely", async () => {
      const env = new Bash();
      const result = await env.exec(`
        export prototype=proto_value
        echo 'null' | yq '$ENV.prototype'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("proto_value");
    });
  });

  describe("yq add with dangerous keys", () => {
    it("should add objects with constructor key", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo '[{"constructor": "a"}, {"normal": "b"}]' | yq -p json 'add | .constructor'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("a");
    });
  });

  describe("yq getpath with dangerous keys", () => {
    it("should getpath with constructor", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo 'constructor: value' | yq 'getpath(["constructor"])'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("value");
    });
  });

  describe("yq does not pollute JavaScript prototype", () => {
    it("should not pollute Object.prototype via YAML", async () => {
      const env = new Bash();
      await env.exec(`
        echo '__proto__: polluted
constructor: hacked' | yq '.'
      `);

      // Verify JavaScript Object.prototype is not affected
      const testObj: Record<string, unknown> = {};
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
      expect(testObj.__proto__).toBe(Object.prototype);
      expect(typeof testObj.constructor).toBe("function");
    });

    it("should not pollute Object.prototype via JSON", async () => {
      const env = new Bash();
      await env.exec(`
        echo '{"__proto__": "polluted"}' | yq -p json '.'
      `);

      // Verify JavaScript Object.prototype is not affected
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    });
  });
});

import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Tests for bash-level prototype pollution defense.
 *
 * These tests ensure that JavaScript prototype-related keywords
 * and constructs are handled safely as regular strings in bash,
 * without triggering JavaScript prototype chain access.
 */
describe("bash prototype pollution defense", () => {
  describe("echo with prototype keywords", () => {
    it("should echo 'constructor' as a literal string", async () => {
      const env = new Bash();
      const result = await env.exec("echo constructor");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("constructor\n");
    });

    it("should echo '__proto__' as a literal string", async () => {
      const env = new Bash();
      const result = await env.exec("echo __proto__");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("__proto__\n");
    });

    it("should echo 'prototype' as a literal string", async () => {
      const env = new Bash();
      const result = await env.exec("echo prototype");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("prototype\n");
    });

    it("should echo 'hasOwnProperty' as a literal string", async () => {
      const env = new Bash();
      const result = await env.exec("echo hasOwnProperty");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hasOwnProperty\n");
    });

    it("should echo 'toString' as a literal string", async () => {
      const env = new Bash();
      const result = await env.exec("echo toString");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("toString\n");
    });

    it("should echo 'valueOf' as a literal string", async () => {
      const env = new Bash();
      const result = await env.exec("echo valueOf");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("valueOf\n");
    });
  });

  describe("variable assignment with prototype keywords", () => {
    it("should allow variable named 'constructor'", async () => {
      const env = new Bash();
      const result = await env.exec("constructor=test; echo $constructor");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should allow variable named '__proto__'", async () => {
      const env = new Bash();
      const result = await env.exec("__proto__=test; echo $__proto__");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should allow variable named 'prototype'", async () => {
      const env = new Bash();
      const result = await env.exec("prototype=test; echo $prototype");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should allow variable named 'hasOwnProperty'", async () => {
      const env = new Bash();
      const result = await env.exec(
        "hasOwnProperty=test; echo $hasOwnProperty",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });
  });

  describe("unset prototype keyword variables", () => {
    it("should return empty for unset $constructor", async () => {
      const env = new Bash();
      const result = await env.exec("echo $constructor");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("\n");
    });

    it("should return empty for unset $__proto__", async () => {
      const env = new Bash();
      const result = await env.exec("echo $__proto__");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("\n");
    });

    it("should return empty for unset $prototype", async () => {
      const env = new Bash();
      const result = await env.exec("echo $prototype");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("\n");
    });
  });

  describe("array with prototype keywords as indices", () => {
    it("should handle array with prototype keyword values", async () => {
      const env = new Bash();
      const result = await env.exec(
        "arr=(constructor __proto__ prototype); echo ${arr[@]}",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("constructor __proto__ prototype\n");
    });

    it("should handle associative array with prototype keyword keys", async () => {
      const env = new Bash();
      const result = await env.exec(
        "declare -A arr; arr[constructor]=a; arr[__proto__]=b; arr[prototype]=c; echo ${arr[constructor]} ${arr[__proto__]} ${arr[prototype]}",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("a b c\n");
    });
  });

  describe("string operations with prototype keywords", () => {
    it("should handle string containing constructor", async () => {
      const env = new Bash();
      const result = await env.exec('x="test constructor test"; echo $x');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test constructor test\n");
    });

    it("should handle string containing __proto__", async () => {
      const env = new Bash();
      const result = await env.exec('x="test __proto__ test"; echo $x');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test __proto__ test\n");
    });

    it("should handle parameter expansion with prototype keywords", async () => {
      const env = new Bash();
      const result = await env.exec("constructor=hello; echo ${constructor^^}");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("HELLO\n");
    });
  });

  describe("function names with prototype keywords", () => {
    it("should allow function named constructor", async () => {
      const env = new Bash();
      const result = await env.exec(
        "constructor() { echo 'func'; }; constructor",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("func\n");
    });

    it("should allow function named __proto__", async () => {
      const env = new Bash();
      const result = await env.exec("__proto__() { echo 'func'; }; __proto__");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("func\n");
    });
  });

  describe("command substitution with prototype keywords", () => {
    it("should handle command substitution returning constructor", async () => {
      const env = new Bash();
      const result = await env.exec("echo $(echo constructor)");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("constructor\n");
    });

    it("should handle command substitution returning __proto__", async () => {
      const env = new Bash();
      const result = await env.exec("echo $(echo __proto__)");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("__proto__\n");
    });
  });

  describe("arithmetic with prototype keyword variables", () => {
    it("should handle arithmetic with variable named constructor", async () => {
      const env = new Bash();
      const result = await env.exec("constructor=5; echo $((constructor + 3))");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("8\n");
    });

    it("should handle arithmetic with variable named __proto__", async () => {
      const env = new Bash();
      const result = await env.exec("__proto__=5; echo $((__proto__ + 3))");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("8\n");
    });
  });

  describe("conditionals with prototype keywords", () => {
    it("should compare strings containing prototype keywords", async () => {
      const env = new Bash();
      const result = await env.exec(
        'if [[ "constructor" == "constructor" ]]; then echo yes; else echo no; fi',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("yes\n");
    });

    it("should handle -v test for prototype keyword variables", async () => {
      const env = new Bash();
      const result = await env.exec(
        "constructor=x; if [[ -v constructor ]]; then echo set; else echo unset; fi",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("set\n");
    });
  });

  describe("export with prototype keywords", () => {
    it("should export variable named constructor", async () => {
      const env = new Bash();
      const result = await env.exec(
        "export constructor=test; printenv constructor",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should export variable named __proto__", async () => {
      const env = new Bash();
      const result = await env.exec(
        "export __proto__=test; printenv __proto__",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });
  });

  describe("read with prototype keywords", () => {
    it("should read into variable named constructor", async () => {
      const env = new Bash();
      const result = await env.exec(
        "echo hello | read constructor; echo $constructor",
      );
      // Note: read in a pipeline runs in a subshell, so this tests the variable access pattern
      expect(result.exitCode).toBe(0);
    });
  });

  describe("for loop with prototype keywords", () => {
    it("should iterate with variable named constructor", async () => {
      const env = new Bash();
      const result = await env.exec(
        "for constructor in a b c; do echo $constructor; done",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("a\nb\nc\n");
    });

    it("should iterate over prototype keyword values", async () => {
      const env = new Bash();
      const result = await env.exec(
        "for x in constructor __proto__ prototype; do echo $x; done",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("constructor\n__proto__\nprototype\n");
    });
  });

  describe("case statement with prototype keywords", () => {
    it("should match prototype keyword in case", async () => {
      const env = new Bash();
      const result = await env.exec(`
        x=constructor
        case $x in
          constructor) echo matched;;
          *) echo nomatch;;
        esac
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("matched\n");
    });
  });

  describe("special patterns that might cause issues", () => {
    it("should handle .constructor as literal", async () => {
      const env = new Bash();
      const result = await env.exec("echo .constructor");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(".constructor\n");
    });

    it("should handle [constructor] as literal", async () => {
      const env = new Bash();
      const result = await env.exec("echo '[constructor]'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("[constructor]\n");
    });

    it("should handle {constructor} as literal", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{constructor}'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("{constructor}\n");
    });

    it("should handle __proto__.test as literal", async () => {
      const env = new Bash();
      const result = await env.exec("echo __proto__.test");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("__proto__.test\n");
    });
  });
});

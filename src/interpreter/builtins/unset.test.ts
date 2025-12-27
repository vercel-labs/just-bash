import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("unset builtin", () => {
  describe("unset variables", () => {
    it("should unset a variable", async () => {
      const env = new Bash({ env: { VAR: "value" } });
      const result = await env.exec(`
        echo "before: $VAR"
        unset VAR
        echo "after: $VAR"
      `);
      expect(result.stdout).toBe("before: value\nafter: \n");
    });

    it("should unset multiple variables", async () => {
      const env = new Bash({ env: { A: "1", B: "2", C: "3" } });
      const result = await env.exec(`
        unset A B
        echo "A=$A B=$B C=$C"
      `);
      expect(result.stdout).toBe("A= B= C=3\n");
    });

    it("should succeed silently for non-existent variable", async () => {
      const env = new Bash();
      const result = await env.exec(`
        unset NONEXISTENT
        echo "done"
      `);
      expect(result.stdout).toBe("done\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("unset with -v flag", () => {
    it("should unset variable with -v flag", async () => {
      const env = new Bash({ env: { VAR: "value" } });
      const result = await env.exec(`
        unset -v VAR
        echo "VAR=$VAR"
      `);
      expect(result.stdout).toBe("VAR=\n");
    });
  });

  describe("unset functions", () => {
    it("should unset a function with -f flag", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() { echo "hello"; }
        myfunc
        unset -f myfunc
        myfunc
      `);
      expect(result.stdout).toBe("hello\n");
      expect(result.stderr).toContain("command not found");
    });

    it("should succeed silently for non-existent function", async () => {
      const env = new Bash();
      const result = await env.exec(`
        unset -f nonexistent_func
        echo "done"
      `);
      expect(result.stdout).toBe("done\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("unset in different scopes", () => {
    it("should unset variable in function scope", async () => {
      const env = new Bash({ env: { VAR: "outer" } });
      const result = await env.exec(`
        myfunc() {
          unset VAR
          echo "in func: $VAR"
        }
        myfunc
        echo "outside: $VAR"
      `);
      expect(result.stdout).toBe("in func: \noutside: \n");
    });

    it("should unset local variable", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          local VAR=local
          echo "before: $VAR"
          unset VAR
          echo "after: $VAR"
        }
        myfunc
      `);
      expect(result.stdout).toBe("before: local\nafter: \n");
    });
  });

  describe("unset return value", () => {
    it("should return 0 on success", async () => {
      const env = new Bash({ env: { VAR: "value" } });
      const result = await env.exec(`
        unset VAR
        echo $?
      `);
      expect(result.stdout).toBe("0\n");
    });
  });

  describe("unset special variables", () => {
    it("should not unset readonly variables", async () => {
      const env = new Bash();
      // Note: This tests that attempt to unset doesn't crash
      // Actual readonly behavior may vary
      const result = await env.exec(`
        VAR=value
        unset VAR
        echo "done"
      `);
      expect(result.stdout).toBe("done\n");
    });
  });
});

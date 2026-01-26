import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Note: These tests use Pyodide which downloads ~30MB on first run.
// The first test will be slow, subsequent tests reuse the cached instance.

describe("python3", () => {
  describe("basic execution", () => {
    it("should execute simple print statement", async () => {
      const env = new Bash();
      const result = await env.exec('python3 -c "print(1 + 2)"');
      expect(result.stdout).toBe("3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should execute arithmetic", async () => {
      const env = new Bash();
      const result = await env.exec('python3 -c "print(10 * 5 + 2)"');
      expect(result.stdout).toBe("52\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle string operations", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "print('hello' + ' ' + 'world')"`,
      );
      expect(result.stdout).toBe("hello world\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("help and version", () => {
    it("should show help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("python3 --help");
      expect(result.stdout).toContain("python3");
      expect(result.stdout).toContain("Execute Python code");
      expect(result.exitCode).toBe(0);
    });

    it("should show version with --version", async () => {
      const env = new Bash();
      const result = await env.exec("python3 --version");
      expect(result.stdout).toContain("Python 3.");
      expect(result.exitCode).toBe(0);
    });

    it("should show version with -V", async () => {
      const env = new Bash();
      const result = await env.exec("python3 -V");
      expect(result.stdout).toContain("Python 3.");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("python alias", () => {
    it("should work as python (alias)", async () => {
      const env = new Bash();
      const result = await env.exec('python -c "print(42)"');
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("stdin input", () => {
    it("should read Python code from stdin", async () => {
      const env = new Bash();
      const result = await env.exec('echo "print(123)" | python3');
      expect(result.stdout).toBe("123\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should report syntax errors", async () => {
      const env = new Bash();
      const result = await env.exec('python3 -c "print(1 +"');
      expect(result.stderr).toContain("SyntaxError");
      expect(result.exitCode).toBe(1);
    });

    it("should report runtime errors", async () => {
      const env = new Bash();
      const result = await env.exec('python3 -c "1 / 0"');
      expect(result.stderr).toContain("ZeroDivisionError");
      expect(result.exitCode).toBe(1);
    });

    it("should report name errors", async () => {
      const env = new Bash();
      const result = await env.exec('python3 -c "print(undefined_var)"');
      expect(result.stderr).toContain("NameError");
      expect(result.exitCode).toBe(1);
    });

    it("should error on missing -c argument", async () => {
      const env = new Bash();
      const result = await env.exec("python3 -c");
      expect(result.stderr).toContain("requires an argument");
      expect(result.exitCode).toBe(2);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      const result = await env.exec('python3 --unknown "print(1)"');
      expect(result.stderr).toContain("unrecognized option");
      expect(result.exitCode).toBe(2);
    });

    it("should error on missing script file", async () => {
      const env = new Bash();
      const result = await env.exec("python3 /nonexistent.py");
      expect(result.stderr).toContain("can't open file");
      expect(result.stderr).toContain("No such file");
      expect(result.exitCode).toBe(2);
    });
  });

  describe("Python features", () => {
    it("should support list comprehensions", async () => {
      const env = new Bash();
      const result = await env.exec(
        'python3 -c "print([x*2 for x in range(5)])"',
      );
      expect(result.stdout).toBe("[0, 2, 4, 6, 8]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support dictionaries", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "d = {'a': 1, 'b': 2}; print(d['a'])"`,
      );
      expect(result.stdout).toBe("1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support lambdas", async () => {
      const env = new Bash();
      const result = await env.exec(
        'python3 -c "add = lambda a, b: a + b; print(add(3, 4))"',
      );
      expect(result.stdout).toBe("7\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support imports (standard library)", async () => {
      const env = new Bash();
      const result = await env.exec(
        "python3 -c \"import json; print(json.dumps({'a': 1}))\"",
      );
      expect(result.stdout).toBe('{"a": 1}\n');
      expect(result.exitCode).toBe(0);
    });

    it("should support math module", async () => {
      const env = new Bash();
      const result = await env.exec(
        'python3 -c "import math; print(int(math.sqrt(16)))"',
      );
      expect(result.stdout).toBe("4\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("environment", () => {
    it("should access environment variables", async () => {
      const env = new Bash();
      const result = await env.exec(`
export MY_VAR=hello
python3 -c "import os; print(os.environ.get('MY_VAR', 'not found'))"
`);
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should have correct sys.argv[0] for -c", async () => {
      const env = new Bash();
      const result = await env.exec(
        'python3 -c "import sys; print(sys.argv[0])"',
      );
      expect(result.stdout).toBe("-c\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("stderr", () => {
    it("should write to stderr", async () => {
      const env = new Bash();
      const result = await env.exec(
        "python3 -c \"import sys; print('error', file=sys.stderr)\"",
      );
      expect(result.stderr).toContain("error");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("concurrent executions", () => {
    it("should handle multiple concurrent executions correctly", async () => {
      // Run multiple Python commands in parallel and verify each gets correct result
      const env1 = new Bash();
      const env2 = new Bash();
      const env3 = new Bash();

      const [result1, result2, result3] = await Promise.all([
        env1.exec('python3 -c "print(111)"'),
        env2.exec('python3 -c "print(222)"'),
        env3.exec('python3 -c "print(333)"'),
      ]);

      // Each result should have the correct output (no mixing)
      expect(result1.stdout).toBe("111\n");
      expect(result1.exitCode).toBe(0);

      expect(result2.stdout).toBe("222\n");
      expect(result2.exitCode).toBe(0);

      expect(result3.stdout).toBe("333\n");
      expect(result3.exitCode).toBe(0);
    });

    it("should queue concurrent executions and complete all", async () => {
      const env = new Bash();

      // Launch 5 concurrent executions
      const results = await Promise.all([
        env.exec('python3 -c "print(1)"'),
        env.exec('python3 -c "print(2)"'),
        env.exec('python3 -c "print(3)"'),
        env.exec('python3 -c "print(4)"'),
        env.exec('python3 -c "print(5)"'),
      ]);

      // All should complete successfully
      for (let i = 0; i < 5; i++) {
        expect(results[i].stdout).toBe(`${i + 1}\n`);
        expect(results[i].exitCode).toBe(0);
      }
    });
  });
});

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("python3 environment", () => {
  describe("environment variables", () => {
    it("should access exported env vars", async () => {
      const env = new Bash();
      const result = await env.exec(`
export MY_VAR=hello
python3 -c "import os; print(os.environ.get('MY_VAR', 'not found'))"
`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access multiple env vars", async () => {
      const env = new Bash();
      const result = await env.exec(`
export VAR1=one
export VAR2=two
export VAR3=three
python3 -c "import os; print(os.environ['VAR1'], os.environ['VAR2'], os.environ['VAR3'])"
`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("one two three\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle env vars with spaces", async () => {
      const env = new Bash();
      const result = await env.exec(`
export MY_VAR="hello world"
python3 -c "import os; print(os.environ['MY_VAR'])"
`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("hello world\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle env vars with special characters", async () => {
      const env = new Bash();
      const result = await env.exec(`
export SPECIAL='foo=bar&baz=qux'
python3 -c "import os; print(os.environ['SPECIAL'])"
`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("foo=bar&baz=qux\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access HOME env var", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import os; print(os.environ.get('HOME', 'not set'))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("/home");
      expect(result.exitCode).toBe(0);
    });

    it("should access PATH env var", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import os; print('PATH' in os.environ)"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("True\n");
      expect(result.exitCode).toBe(0);
    });

    it("should access PWD env var", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import os; print(os.environ.get('PWD', 'not set'))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("/");
      expect(result.exitCode).toBe(0);
    });

    it("should return None for undefined env var with get()", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import os; print(os.environ.get('UNDEFINED_VAR_12345'))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("None\n");
      expect(result.exitCode).toBe(0);
    });

    it("should raise KeyError for undefined env var with []", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import os; print(os.environ['UNDEFINED_VAR_12345'])"`,
      );
      expect(result.stderr).toContain("KeyError");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("working directory", () => {
    it("should have correct cwd", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import os; print(os.getcwd())"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("/");
      expect(result.exitCode).toBe(0);
    });

    it("should match bash pwd", async () => {
      const env = new Bash();
      const bashPwd = await env.exec("pwd");
      const pythonCwd = await env.exec(
        `python3 -c "import os; print(os.getcwd())"`,
      );
      expect(pythonCwd.stderr).toBe("");
      // Python paths should match bash paths (no /host prefix)
      expect(pythonCwd.stdout.trim()).toBe(bashPwd.stdout.trim());
    });

    it("should work with cd", async () => {
      const env = new Bash();
      const result = await env.exec(`
cd /tmp
python3 -c "import os; print(os.getcwd())"
`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("/tmp\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("exit codes", () => {
    it("should return exit code 0 on success", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "print('ok')"`);
      expect(result.exitCode).toBe(0);
    });

    it("should return exit code from sys.exit()", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "import sys; sys.exit(42)"`);
      expect(result.exitCode).toBe(42);
    });

    it("should return exit code 0 from sys.exit(0)", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "import sys; sys.exit(0)"`);
      expect(result.exitCode).toBe(0);
    });

    it("should return exit code 1 on exception", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "raise ValueError('test error')"`,
      );
      expect(result.stderr).toContain("ValueError");
      expect(result.exitCode).toBe(1);
    });

    it("should return exit code 1 from sys.exit(string)", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import sys; sys.exit('error message')"`,
      );
      // sys.exit with string message prints to stderr and exits with 1
      expect(result.exitCode).toBe(1);
    });

    it("should return exit code 1 from sys.exit(None)", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "import sys; sys.exit(None)"`);
      // sys.exit(None) is equivalent to sys.exit(0)
      expect(result.exitCode).toBe(0);
    });
  });

  describe("crash handling", () => {
    it("should handle NameError", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "print(undefined_variable)"`);
      expect(result.stderr).toContain("NameError");
      expect(result.exitCode).toBe(1);
    });

    it("should handle TypeError", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "'string' + 5"`);
      expect(result.stderr).toContain("TypeError");
      expect(result.exitCode).toBe(1);
    });

    it("should handle IndexError", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "[][0]"`);
      expect(result.stderr).toContain("IndexError");
      expect(result.exitCode).toBe(1);
    });

    it("should handle KeyError", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "{}['missing']"`);
      expect(result.stderr).toContain("KeyError");
      expect(result.exitCode).toBe(1);
    });

    it("should handle AttributeError", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "'string'.nonexistent()"`);
      expect(result.stderr).toContain("AttributeError");
      expect(result.exitCode).toBe(1);
    });

    it("should handle import errors", async () => {
      const env = new Bash();
      const result = await env.exec(
        `python3 -c "import nonexistent_module_xyz"`,
      );
      expect(result.stderr).toContain("ModuleNotFoundError");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("unicode handling", () => {
    it("should handle unicode in output", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "print('hello 世界')"`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("hello 世界\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle emoji", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "print('🎉 party')"`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("🎉 party\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle unicode env vars", async () => {
      const env = new Bash();
      const result = await env.exec(`
export UNICODE_VAR="привет мир"
python3 -c "import os; print(os.environ['UNICODE_VAR'])"
`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("привет мир\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("binary file I/O", () => {
    it("should write and read binary data", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_binary.py << 'EOF'
with open('/tmp/binary.bin', 'wb') as f:
    f.write(bytes([0, 1, 2, 255, 254, 253]))
with open('/tmp/binary.bin', 'rb') as f:
    data = f.read()
print(list(data))
EOF`);
      const result = await env.exec(`python3 /tmp/test_binary.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[0, 1, 2, 255, 254, 253]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle binary data with null bytes", async () => {
      const env = new Bash();
      // Use bytes() constructor to create null bytes - avoid literal null in heredoc
      await env.exec(`cat > /tmp/test_nullbytes.py << 'EOF'
with open('/tmp/nullbytes.bin', 'wb') as f:
    f.write(b'hello' + bytes([0]) + b'world')
with open('/tmp/nullbytes.bin', 'rb') as f:
    data = f.read()
print(len(data), data[5])
EOF`);
      const result = await env.exec(`python3 /tmp/test_nullbytes.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("11 0\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("multiline output", () => {
    it("should handle multiple print statements", async () => {
      const env = new Bash();
      const result = await env.exec(`python3 -c "
print('line1')
print('line2')
print('line3')
"`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("line1\nline2\nline3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle for loop output", async () => {
      const env = new Bash();
      // Use heredoc to preserve indentation
      await env.exec(`cat > /tmp/test_forloop.py << 'EOF'
for i in range(3):
    print(i)
EOF`);
      const result = await env.exec(`python3 /tmp/test_forloop.py`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("0\n1\n2\n");
      expect(result.exitCode).toBe(0);
    });
  });
});

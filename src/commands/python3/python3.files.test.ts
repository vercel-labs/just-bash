import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Note: These tests use Pyodide which downloads ~30MB on first run.
// The first test will be slow, subsequent tests reuse the cached instance.

describe("python3 script files", () => {
  describe("script file execution", () => {
    it("should execute a Python script file", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/script.py << 'EOF'
print("Hello from script")
EOF`);
      const result = await env.exec("python3 /tmp/script.py");
      expect(result.stdout).toBe("Hello from script\n");
      expect(result.exitCode).toBe(0);
    });

    it("should pass arguments to script", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/args.py << 'EOF'
import sys
print(f"Args: {sys.argv[1:]}")
EOF`);
      const result = await env.exec("python3 /tmp/args.py foo bar baz");
      expect(result.stdout).toBe("Args: ['foo', 'bar', 'baz']\n");
      expect(result.exitCode).toBe(0);
    });

    it("should have correct sys.argv[0] for script file", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/argv0.py << 'EOF'
import sys
print(sys.argv[0])
EOF`);
      const result = await env.exec("python3 /tmp/argv0.py");
      expect(result.stdout).toBe("/tmp/argv0.py\n");
      expect(result.exitCode).toBe(0);
    });

    it("should error on missing script file", async () => {
      const env = new Bash();
      const result = await env.exec("python3 /tmp/nonexistent.py");
      expect(result.stderr).toContain("can't open file");
      expect(result.exitCode).toBe(2);
    });

    it("should handle script with multiline code", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/multiline.py << 'EOF'
def greet(name):
    return f"Hello, {name}!"

result = greet("World")
print(result)
EOF`);
      const result = await env.exec("python3 /tmp/multiline.py");
      expect(result.stdout).toBe("Hello, World!\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle script with imports", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/imports.py << 'EOF'
import json
import math

data = {"pi": math.pi}
print(json.dumps(data))
EOF`);
      const result = await env.exec("python3 /tmp/imports.py");
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.pi).toBeCloseTo(Math.PI, 5);
      expect(result.exitCode).toBe(0);
    });

    it("should handle script with syntax error", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/syntax_error.py << 'EOF'
print("hello"
EOF`);
      const result = await env.exec("python3 /tmp/syntax_error.py");
      expect(result.stderr).toContain("SyntaxError");
      expect(result.exitCode).toBe(1);
    });

    it("should handle script with runtime error", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/runtime_error.py << 'EOF'
x = 1 / 0
EOF`);
      const result = await env.exec("python3 /tmp/runtime_error.py");
      expect(result.stderr).toContain("ZeroDivisionError");
      expect(result.exitCode).toBe(1);
    });
  });
});

describe("python3 file I/O", () => {
  describe("file read/write", () => {
    it("should read files created by bash", async () => {
      const env = new Bash();
      await env.exec('echo "content from bash" > /tmp/bashfile.txt');
      const result = await env.exec(
        `python3 -c "with open('/tmp/bashfile.txt') as f: print(f.read().strip())"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("content from bash\n");
      expect(result.exitCode).toBe(0);
    });

    it("should write files readable by bash", async () => {
      const env = new Bash();
      const pyResult = await env.exec(
        `python3 -c "with open('/tmp/pyfile.txt', 'w') as f: f.write('content from python')"`,
      );
      expect(pyResult.stderr).toBe("");
      expect(pyResult.exitCode).toBe(0);
      const result = await env.exec("cat /tmp/pyfile.txt");
      expect(result.stdout).toBe("content from python");
      expect(result.exitCode).toBe(0);
    });

    it("should append to files", async () => {
      const env = new Bash();
      await env.exec('echo "line1" > /tmp/append.txt');
      const pyResult = await env.exec(
        `python3 -c "with open('/tmp/append.txt', 'a') as f: f.write('line2\\n')"`,
      );
      expect(pyResult.stderr).toBe("");
      expect(pyResult.exitCode).toBe(0);
      const result = await env.exec("cat /tmp/append.txt");
      expect(result.stdout).toBe("line1\nline2\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("directory operations", () => {
    it("should list directory contents", async () => {
      const env = new Bash();
      await env.exec("mkdir -p /tmp/testdir");
      await env.exec("touch /tmp/testdir/a.txt /tmp/testdir/b.txt");
      const result = await env.exec(`python3 -c "
import os
files = sorted(os.listdir('/tmp/testdir'))
print(files)
"`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("['a.txt', 'b.txt']\n");
      expect(result.exitCode).toBe(0);
    });

    it("should create directories", async () => {
      const env = new Bash();
      const pyResult = await env.exec(
        "python3 -c \"import os; os.makedirs('/tmp/newdir/subdir', exist_ok=True)\"",
      );
      expect(pyResult.stderr).toBe("");
      expect(pyResult.exitCode).toBe(0);
      const result = await env.exec("ls -d /tmp/newdir/subdir");
      expect(result.stdout).toBe("/tmp/newdir/subdir\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("module imports from files", () => {
    // Note: sys.path requires /host prefix because Python's import machinery
    // uses internal C-level operations that bypass our Python-level path patches.
    // Regular file operations (open, os.listdir, etc.) work with normal paths.
    it("should import local module with sys.path", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/mymodule.py << 'EOF'
def greet(name):
    return f"Hello, {name}!"
EOF`);
      await env.exec(`cat > /tmp/main.py << 'EOF'
import sys
sys.path.insert(0, '/host/tmp')
import mymodule
print(mymodule.greet("World"))
EOF`);
      const result = await env.exec("python3 /tmp/main.py");
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Hello, World!\n");
      expect(result.exitCode).toBe(0);
    });
  });
});

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Note: These tests use CPython Emscripten which loads ~9MB WASM on first run.
// The first test will be slow, subsequent tests reuse the worker.

describe("python3 script files", () => {
  describe("script file execution", () => {
    it("should execute a Python script file", { timeout: 60000 }, async () => {
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/script.py << 'EOF'
print("Hello from script")
EOF`);
      const result = await env.exec("python3 /tmp/script.py");
      expect(result.stdout).toBe("Hello from script\n");
      expect(result.exitCode).toBe(0);
    });

    it("should pass arguments to script", async () => {
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/args.py << 'EOF'
import sys
print(f"Args: {sys.argv[1:]}")
EOF`);
      const result = await env.exec("python3 /tmp/args.py foo bar baz");
      expect(result.stdout).toBe("Args: ['foo', 'bar', 'baz']\n");
      expect(result.exitCode).toBe(0);
    });

    it("should have correct sys.argv[0] for script file", async () => {
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/argv0.py << 'EOF'
import sys
print(sys.argv[0])
EOF`);
      const result = await env.exec("python3 /tmp/argv0.py");
      expect(result.stdout).toBe("/tmp/argv0.py\n");
      expect(result.exitCode).toBe(0);
    });

    it("should error on missing script file", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec("python3 /tmp/nonexistent.py");
      expect(result.stderr).toContain("can't open file");
      expect(result.exitCode).toBe(2);
    });

    it("should handle script with multiline code", async () => {
      const env = new Bash({ python: true });
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
      const env = new Bash({ python: true });
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
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/syntax_error.py << 'EOF'
print("hello"
EOF`);
      const result = await env.exec("python3 /tmp/syntax_error.py");
      expect(result.stderr).toContain("SyntaxError");
      expect(result.exitCode).toBe(1);
    });

    it("should handle script with runtime error", async () => {
      const env = new Bash({ python: true });
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
      const env = new Bash({ python: true });
      await env.exec('echo "content from bash" > /tmp/bashfile.txt');
      const result = await env.exec(
        `python3 -c "with open('/tmp/bashfile.txt') as f: print(f.read().strip())"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("content from bash\n");
      expect(result.exitCode).toBe(0);
    });

    it("should write files readable by bash", async () => {
      const env = new Bash({ python: true });
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
      const env = new Bash({ python: true });
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

    it("should execute a file with runpy.run_path", async () => {
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/runpy_target.py << 'EOF'
print(f"executed: {__file__}")
value = 42
EOF`);
      const result = await env.exec(
        `python3 -c "import runpy; result = runpy.run_path('/tmp/runpy_target.py'); print(result['value'])"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("executed: /tmp/runpy_target.py\n42\n");
      expect(result.exitCode).toBe(0);
    });

    it("should accept a Path in runpy.run_path", async () => {
      const env = new Bash({ python: true });
      await env.exec("echo 'value = 42' > /tmp/runpy_path.py");
      const result = await env.exec(
        `python3 -c "import runpy; from pathlib import Path; print(runpy.run_path(Path('/tmp/runpy_path.py'))['value'])"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("tracebacks and the program's namespace", () => {
    it("names <string> and the program's own line for -c code", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(`python3 -c "import json
x = 1
raise KeyError(2)"`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        'Traceback (most recent call last):\n  File "<string>", line 3, in <module>\nKeyError: 2\n',
      );
      expect(result.exitCode).toBe(1);
    });

    it("names a script file by its path and its own lines", async () => {
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/report.py << 'EOF'
def fail():
    raise ValueError("boom")

fail()
EOF`);
      const result = await env.exec("cd /tmp && python3 report.py");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        [
          "Traceback (most recent call last):",
          '  File "report.py", line 4, in <module>',
          "    fail()",
          "    ~~~~^^",
          '  File "report.py", line 2, in fail',
          '    raise ValueError("boom")',
          "ValueError: boom",
          "",
        ].join("\n"),
      );
      expect(result.exitCode).toBe(1);
    });

    it("sets __file__ and puts the script's directory on sys.path", async () => {
      const env = new Bash({ python: true });
      await env.exec(
        "mkdir -p /tmp/app && echo 'ANSWER = 42' > /tmp/app/helper.py",
      );
      await env.exec(`cat > /tmp/app/main.py << 'EOF'
import helper
print(__file__, __name__, helper.ANSWER)
EOF`);
      const result = await env.exec("python3 /tmp/app/main.py");
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("/tmp/app/main.py __main__ 42\n");
      expect(result.exitCode).toBe(0);
    });

    it("prints a syntax error the way CPython does, naming no wrapper", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(`python3 -c "x = = 1"`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        '  File "<string>", line 1\n    x = = 1\n        ^\nSyntaxError: invalid syntax\n',
      );
      expect(result.exitCode).toBe(1);
    });

    it("is the __main__ module, so a class it defines pickles", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(`python3 -c "
import pickle, sys, __main__
class Point:
    def __init__(self, x):
        self.x = x
print(__main__ is sys.modules['__main__'], hasattr(__main__, 'Point'))
print(pickle.loads(pickle.dumps(Point(7))).x)
"`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("True True\n7\n");
      expect(result.exitCode).toBe(0);
    });

    it("accepts a coding cookie on the first line", async () => {
      // The source is compiled as a str the filesystem already decoded, and
      // CPython accepts a cookie in a str; a latin-1 cookie on UTF-8 text
      // would re-decode the literals if the source were compiled as bytes.
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/cookie.py << 'EOF'
# -*- coding: latin-1 -*-
print("caf\u00e9")
EOF`);
      const result = await env.exec("python3 /tmp/cookie.py");
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("caf\u00e9\n");
      expect(result.exitCode).toBe(0);
    });

    it("keeps the wrapper's own imports out of the program's globals", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(
        `python3 -c "print(sorted(k for k in globals() if not k.startswith('__')))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("[]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("directory operations", () => {
    it("should list directory contents", async () => {
      const env = new Bash({ python: true });
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
      const env = new Bash({ python: true });
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
      const env = new Bash({ python: true });
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

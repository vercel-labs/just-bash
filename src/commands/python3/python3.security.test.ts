import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Note: These tests use Pyodide which downloads ~30MB on first run.
// The first test will be slow, subsequent tests reuse the cached instance.

/**
 * Security tests for the Python/Pyodide sandbox.
 * These tests verify that the sandbox properly restricts dangerous operations.
 */
describe("python3 security", () => {
  describe("blocked module imports", () => {
    it(
      "should block import js (sandbox escape vector)",
      { timeout: 60000 },
      async () => {
        const env = new Bash();
        const result = await env.exec('python3 -c "import js"');
        expect(result.stderr).toContain("ImportError");
        expect(result.stderr).toContain("blocked");
        expect(result.exitCode).toBe(1);
      },
    );

    it("should block import js.globalThis", async () => {
      const env = new Bash();
      const result = await env.exec('python3 -c "from js import globalThis"');
      expect(result.stderr).toContain("ImportError");
      expect(result.stderr).toContain("blocked");
      expect(result.exitCode).toBe(1);
    });

    it("should block import pyodide.ffi", async () => {
      const env = new Bash();
      const result = await env.exec('python3 -c "import pyodide.ffi"');
      expect(result.stderr).toContain("ImportError");
      expect(result.stderr).toContain("blocked");
      expect(result.exitCode).toBe(1);
    });

    it("should block from pyodide.ffi import create_proxy", async () => {
      const env = new Bash();
      const result = await env.exec(
        'python3 -c "from pyodide.ffi import create_proxy"',
      );
      expect(result.stderr).toContain("ImportError");
      expect(result.stderr).toContain("blocked");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("hidden original function references", () => {
    it("should not expose _jb_original_open on builtins", async () => {
      const env = new Bash();
      const result = await env.exec(
        "python3 -c \"import builtins; print(hasattr(builtins, '_jb_original_open'))\"",
      );
      expect(result.stdout).toBe("False\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not expose _jb_original_listdir on os", async () => {
      const env = new Bash();
      const result = await env.exec(
        "python3 -c \"import os; print(hasattr(os, '_jb_original_listdir'))\"",
      );
      expect(result.stdout).toBe("False\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not expose _jb_original_exists on os.path", async () => {
      const env = new Bash();
      const result = await env.exec(
        "python3 -c \"import os; print(hasattr(os.path, '_jb_original_exists'))\"",
      );
      expect(result.stdout).toBe("False\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not expose _jb_original_stat on os", async () => {
      const env = new Bash();
      const result = await env.exec(
        "python3 -c \"import os; print(hasattr(os, '_jb_original_stat'))\"",
      );
      expect(result.stdout).toBe("False\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not expose _jb_original_chdir on os", async () => {
      const env = new Bash();
      const result = await env.exec(
        "python3 -c \"import os; print(hasattr(os, '_jb_original_chdir'))\"",
      );
      expect(result.stdout).toBe("False\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("file operation redirects", () => {
    it("should redirect glob.glob to /host", async () => {
      const env = new Bash();
      await env.exec('echo "test content" > /tmp/test_glob.txt');
      const result = await env.exec(`python3 -c "
import glob
files = glob.glob('/tmp/test_glob.txt')
print(files)
"`);
      // The glob should find the file via /host redirection
      expect(result.stdout).toContain("test_glob.txt");
      expect(result.exitCode).toBe(0);
    });

    it("should redirect os.walk to /host", async () => {
      const env = new Bash();
      await env.exec("mkdir -p /tmp/test_walk_dir");
      await env.exec('echo "content1" > /tmp/test_walk_dir/file1.txt');
      await env.exec(`cat > /tmp/test_walk.py << 'EOF'
import os
for root, dirs, files in os.walk('/tmp/test_walk_dir'):
    print(f'root={root}, files={files}')
EOF`);
      const result = await env.exec("python3 /tmp/test_walk.py");
      expect(result.stdout).toContain("root=/tmp/test_walk_dir");
      expect(result.stdout).toContain("file1.txt");
      expect(result.exitCode).toBe(0);
    });

    it("should redirect os.scandir to /host", async () => {
      const env = new Bash();
      await env.exec("mkdir -p /tmp/test_scandir");
      await env.exec('echo "content" > /tmp/test_scandir/scanfile.txt');
      const result = await env.exec(`python3 -c "
import os
entries = list(os.scandir('/tmp/test_scandir'))
print([e.name for e in entries])
"`);
      expect(result.stdout).toContain("scanfile.txt");
      expect(result.exitCode).toBe(0);
    });

    it("should redirect io.open to /host", async () => {
      const env = new Bash();
      await env.exec('echo "io.open test content" > /tmp/test_io_open.txt');
      await env.exec(`cat > /tmp/test_io.py << 'EOF'
import io
with io.open('/tmp/test_io_open.txt', 'r') as f:
    print(f.read())
EOF`);
      const result = await env.exec("python3 /tmp/test_io.py");
      expect(result.stdout).toContain("io.open test content");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("legitimate operations still work", () => {
    it("should allow normal file operations", async () => {
      const env = new Bash();
      await env.exec('echo "allowed content" > /tmp/allowed_file.txt');
      await env.exec(`cat > /tmp/test_read.py << 'EOF'
with open('/tmp/allowed_file.txt', 'r') as f:
    print(f.read())
EOF`);
      const result = await env.exec("python3 /tmp/test_read.py");
      expect(result.stdout).toContain("allowed content");
      expect(result.exitCode).toBe(0);
    });

    it("should allow normal imports", async () => {
      const env = new Bash();
      const result = await env.exec(
        "python3 -c \"import json; print(json.dumps({'a': 1}))\"",
      );
      expect(result.stdout).toBe('{"a": 1}\n');
      expect(result.exitCode).toBe(0);
    });

    it("should allow list comprehensions and lambdas", async () => {
      const env = new Bash();
      const result = await env.exec(
        'python3 -c "print(list(map(lambda x: x*2, [1,2,3])))"',
      );
      expect(result.stdout).toBe("[2, 4, 6]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should allow os.getcwd and os.chdir", async () => {
      const env = new Bash();
      await env.exec("mkdir -p /tmp/test_chdir_dir");
      const result = await env.exec(`python3 -c "
import os
os.chdir('/tmp/test_chdir_dir')
print(os.getcwd())
"`);
      expect(result.stdout).toBe("/tmp/test_chdir_dir\n");
      expect(result.exitCode).toBe(0);
    });
  });
});

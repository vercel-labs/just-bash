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

    it("should block import pyodide (sandbox escape via ffi)", async () => {
      const env = new Bash();
      const result = await env.exec('python3 -c "import pyodide"');
      expect(result.stderr).toContain("ImportError");
      expect(result.stderr).toContain("blocked");
      expect(result.exitCode).toBe(1);
    });

    it("should block import pyodide_js (exposes _original_* via globals)", async () => {
      const env = new Bash();
      const result = await env.exec('python3 -c "import pyodide_js"');
      expect(result.stderr).toContain("ImportError");
      expect(result.stderr).toContain("blocked");
      expect(result.exitCode).toBe(1);
    });

    it("should block pyodide_js.globals access to _original_import", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_pyodide_js.py << 'EOF'
try:
    import pyodide_js
    orig = pyodide_js.globals.get('_original_import')
    if orig:
        js = orig('js')
        print('VULNERABLE: accessed _original_import via pyodide_js.globals')
    else:
        print('VULNERABLE: pyodide_js imported')
except ImportError as e:
    if 'blocked' in str(e):
        print('SECURE: pyodide_js blocked')
    else:
        print(f'ERROR: {e}')
EOF`);
      const result = await env.exec("python3 /tmp/test_pyodide_js.py");
      expect(result.stdout).toContain("SECURE");
      expect(result.stdout).not.toContain("VULNERABLE");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("hidden original function references", () => {
    it("should not expose _original_import (critical sandbox escape)", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_import.py << 'EOF'
try:
    # If _original_import is accessible, attacker can bypass import blocking
    js = _original_import('js')
    print('VULNERABLE: _original_import accessible')
except NameError:
    print('SECURE: _original_import not accessible')
EOF`);
      const result = await env.exec("python3 /tmp/test_import.py");
      expect(result.stdout).toContain("SECURE");
      expect(result.stdout).not.toContain("VULNERABLE");
      expect(result.exitCode).toBe(0);
    });

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

  describe("introspection bypass attempts", () => {
    it("should block __kwdefaults__ access on __import__ (critical bypass)", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_kwdefaults.py << 'EOF'
import builtins
try:
    # Old vulnerability: __kwdefaults__ exposed the original __import__
    kwdefaults = builtins.__import__.__kwdefaults__
    if kwdefaults and '_orig' in kwdefaults:
        # Could bypass import blocking via kwdefaults['_orig']('js')
        print(f'VULNERABLE: __kwdefaults__ exposed: {list(kwdefaults.keys())}')
    else:
        print('SECURE: __kwdefaults__ not exploitable')
except AttributeError as e:
    print(f'SECURE: __kwdefaults__ access blocked')
EOF`);
      const result = await env.exec("python3 /tmp/test_kwdefaults.py");
      expect(result.stdout).toContain("SECURE");
      expect(result.stdout).not.toContain("VULNERABLE");
      expect(result.exitCode).toBe(0);
    });

    it("should block __closure__ access on __import__", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_closure.py << 'EOF'
import builtins
try:
    closure = builtins.__import__.__closure__
    print(f'VULNERABLE: __closure__ accessible: {closure}')
except AttributeError as e:
    print(f'SECURE: __closure__ access blocked')
EOF`);
      const result = await env.exec("python3 /tmp/test_closure.py");
      expect(result.stdout).toContain("SECURE");
      expect(result.stdout).not.toContain("VULNERABLE");
      expect(result.exitCode).toBe(0);
    });

    it("should block __globals__ access on __import__", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_globals.py << 'EOF'
import builtins
try:
    g = builtins.__import__.__globals__
    print('VULNERABLE')
except AttributeError:
    print('SECURE')
EOF`);
      const result = await env.exec("python3 /tmp/test_globals.py");
      expect(result.stdout).toContain("SECURE");
      expect(result.exitCode).toBe(0);
    });

    it("should block __closure__ access on builtins.open", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_open_closure.py << 'EOF'
import builtins
try:
    closure = builtins.open.__closure__
    print(f'VULNERABLE: closure={closure}')
except AttributeError:
    print('SECURE: __closure__ blocked')
EOF`);
      const result = await env.exec("python3 /tmp/test_open_closure.py");
      expect(result.stdout).toContain("SECURE");
      expect(result.exitCode).toBe(0);
    });

    it("should block __closure__ access on os.listdir", async () => {
      const env = new Bash();
      await env.exec(`cat > /tmp/test_listdir_closure.py << 'EOF'
import os
try:
    closure = os.listdir.__closure__
    print(f'VULNERABLE: closure={closure}')
except AttributeError:
    print('SECURE: __closure__ blocked')
EOF`);
      const result = await env.exec("python3 /tmp/test_listdir_closure.py");
      expect(result.stdout).toContain("SECURE");
      expect(result.exitCode).toBe(0);
    });

    it("should redirect shutil.copy to /host and block introspection", async () => {
      const env = new Bash();
      await env.exec('echo "shutil test" > /tmp/shutil_src.txt');
      await env.exec(`cat > /tmp/test_shutil.py << 'EOF'
import shutil
# Test that shutil.copy works with redirect
shutil.copy('/tmp/shutil_src.txt', '/tmp/shutil_dst.txt')
with open('/tmp/shutil_dst.txt') as f:
    print(f'COPY_OK: {f.read().strip()}')
# Test that introspection is blocked
try:
    closure = shutil.copy.__closure__
    print(f'VULNERABLE: closure={closure}')
except AttributeError:
    print('SECURE: __closure__ blocked')
EOF`);
      const result = await env.exec("python3 /tmp/test_shutil.py");
      expect(result.stdout).toContain("COPY_OK: shutil test");
      expect(result.stdout).toContain("SECURE");
      expect(result.exitCode).toBe(0);
    });

    it("should redirect pathlib.Path operations to /host", async () => {
      const env = new Bash();
      await env.exec('echo "pathlib test content" > /tmp/pathlib_test.txt');
      await env.exec(`cat > /tmp/test_pathlib.py << 'EOF'
from pathlib import Path

# Test Path.read_text()
p = Path('/tmp/pathlib_test.txt')
content = p.read_text().strip()
print(f'READ_OK: {content}')

# Test Path.exists()
if p.exists():
    print('EXISTS_OK')

# Test Path.is_file()
if p.is_file():
    print('IS_FILE_OK')

# Test Path.write_text()
p2 = Path('/tmp/pathlib_write.txt')
p2.write_text('written by pathlib')
print(f'WRITE_OK: {p2.read_text().strip()}')

# Test Path.iterdir() - paths should not have /host prefix
tmp = Path('/tmp')
files = [f.name for f in tmp.iterdir() if f.name.startswith('pathlib')]
print(f'ITERDIR_OK: {sorted(files)}')
EOF`);
      const result = await env.exec("python3 /tmp/test_pathlib.py");
      expect(result.stdout).toContain("READ_OK: pathlib test content");
      expect(result.stdout).toContain("EXISTS_OK");
      expect(result.stdout).toContain("IS_FILE_OK");
      expect(result.stdout).toContain("WRITE_OK: written by pathlib");
      expect(result.stdout).toContain("ITERDIR_OK:");
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

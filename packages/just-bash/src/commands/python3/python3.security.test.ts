import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * Security tests for CPython Emscripten sandbox.
 *
 * Security model: isolation by construction — CPython Emscripten has zero
 * JS bridge code, no NODEFS/NODERAWFS, no ctypes, no process spawn.
 * These tests verify those invariants hold.
 */
describe("python3 security", () => {
  describe("module isolation (no JS bridge)", () => {
    it("should block import js", { timeout: 60000 }, async () => {
      const env = new Bash({ python: true });
      const result = await env.exec('python3 -c "import js"');
      expect(result.stderr).toContain("ModuleNotFoundError");
      expect(result.exitCode).toBe(1);
    });

    it("should block import pyodide", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec('python3 -c "import pyodide"');
      expect(result.stderr).toContain("ModuleNotFoundError");
      expect(result.exitCode).toBe(1);
    });

    it("should block ctypes (no _ctypes C extension)", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec('python3 -c "import ctypes"');
      // ctypes pure-Python loads but _ctypes C extension is missing
      expect(result.stderr).toMatch(/ImportError|ModuleNotFoundError/);
      expect(result.exitCode).toBe(1);
    });

    it("should block _ctypes (not compiled)", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec('python3 -c "import _ctypes"');
      expect(result.stderr).toMatch(/ImportError|ModuleNotFoundError/);
      expect(result.exitCode).toBe(1);
    });
  });

  describe("process spawn blocking", () => {
    it("should return -1 from os.system (no-op at Emscripten level)", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(
        "python3 -c \"import os; print(os.system('echo pwned'))\"",
      );
      // os.system returns -1: patched at Emscripten level, never calls child_process
      expect(result.stdout).toBe("-1\n");
      expect(result.stdout).not.toContain("pwned");
      expect(result.exitCode).toBe(0);
    });

    it("should block subprocess.run", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(
        "python3 -c \"import subprocess; subprocess.run(['echo', 'pwned'])\"",
      );
      expect(result.stderr).toContain("OSError");
      expect(result.stdout).not.toContain("pwned");
      expect(result.exitCode).toBe(1);
    });

    it("should block os.popen", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(
        "python3 -c \"import os; os.popen('echo pwned')\"",
      );
      expect(result.stderr).toContain("OSError");
      expect(result.stdout).not.toContain("pwned");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("dlopen blocking", () => {
    it("should block loading crafted WASM side modules", async () => {
      const env = new Bash({ python: true });
      // First, write the WASM bytes to a file using python
      await env.exec(
        "python3 -c \"open('/tmp/evil.cpython-313-wasm32-emscripten.so','wb').write(bytes([0,97,115,109,1,0,0,0,0,14,8,100,121,108,105,110,107,46,48,0,0,0,0,0,1,4,1,96,0,1,127,3,2,1,0,7,15,1,11,80,121,73,110,105,116,95,101,118,105,108,0,0,10,6,1,4,0,65,0,11]))\"",
      );
      // Then try to import it — should fail with "dynamic linking not enabled"
      const result = await env.exec(
        "python3 -c \"import sys; sys.path.insert(0,'/tmp'); exec('try:\\n import evil\\n print(chr(86)+chr(85)+chr(76)+chr(78))\\nexcept SystemError:\\n print(chr(86)+chr(85)+chr(76)+chr(78))\\nexcept ImportError as e:\\n print(chr(83)+chr(65)+chr(70)+chr(69),e)\\nexcept Exception as e:\\n print(chr(83)+chr(65)+chr(70)+chr(69),e)')\"",
      );
      expect(result.stdout).toContain("SAFE");
      expect(result.stdout).not.toContain("VULN");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("filesystem isolation", () => {
    it("should not have /etc/passwd (no host FS)", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(
        "python3 -c \"import os; print(os.path.exists('/etc/passwd'))\"",
      );
      expect(result.stdout).toBe("False\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not access host filesystem via _io.open (C-level)", async () => {
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/test_io.py << 'EOF'
import _io
try:
    f = _io.open("/etc/passwd", "r")
    print("VULNERABLE:", f.read()[:50])
except FileNotFoundError:
    print("SAFE: no /etc/passwd in VFS")
EOF`);
      const result = await env.exec("python3 /tmp/test_io.py");
      expect(result.stdout).toContain("SAFE");
      expect(result.stdout).not.toContain("VULNERABLE");
      expect(result.exitCode).toBe(0);
    });

    it("should not access real /etc/passwd via C-level listdir", async () => {
      const env = new Bash({ python: true });
      // Even with _os module (C-level), /etc doesn't exist in Emscripten VFS
      // (path redirection sends os.listdir('/') to /host/ which is the just-bash VFS)
      await env.exec(`cat > /tmp/test_root.py << 'EOF'
import _io
try:
    f = _io.open("/etc/shadow", "r")
    print("VULNERABLE:", f.read()[:50])
except FileNotFoundError:
    print("SAFE: /etc/shadow not accessible")
EOF`);
      const result = await env.exec("python3 /tmp/test_root.py");
      expect(result.stdout).toContain("SAFE");
      expect(result.stdout).not.toContain("VULNERABLE");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("network isolation", () => {
    it("should block raw TCP sockets", async () => {
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/test_socket.py << 'EOF'
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect(("example.com", 80))
    print("VULNERABLE: TCP connected")
except OSError as e:
    print("SAFE:", e)
EOF`);
      const result = await env.exec("python3 /tmp/test_socket.py");
      expect(result.stdout).toContain("SAFE");
      expect(result.stdout).not.toContain("VULNERABLE");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("environment isolation", () => {
    it("should not leak host environment variables", async () => {
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/test_env.py << 'EOF'
import os
env = dict(os.environ)
leaked = []
# Should not see host-specific vars
for key in ['NODE_PATH', 'SHELL', 'TERM', 'SSH_AUTH_SOCK', 'npm_config_prefix']:
    if key in env:
        leaked.append(f"{key}={env[key]}")
# HOME should be Emscripten default, not real home
home = env.get('HOME', '')
if '/Users/' in home:
    leaked.append(f"HOME={home}")
if leaked:
    print("LEAKED:", leaked)
else:
    print("SAFE: no host env vars leaked")
EOF`);
      const result = await env.exec("python3 /tmp/test_env.py");
      expect(result.stdout).toContain("SAFE");
      expect(result.stdout).not.toContain("LEAKED");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("file operation redirects", () => {
    it("should redirect open() to /host", async () => {
      const env = new Bash({ python: true });
      await env.exec('echo "test content" > /tmp/redirect_test.txt');
      const result = await env.exec(
        "python3 -c \"print(open('/tmp/redirect_test.txt').read().strip())\"",
      );
      expect(result.stdout).toBe("test content\n");
      expect(result.exitCode).toBe(0);
    });

    it("should redirect glob.glob to /host", async () => {
      const env = new Bash({ python: true });
      await env.exec('echo "x" > /tmp/glob_test_file.txt');
      const result = await env.exec(`python3 -c "
import glob
files = glob.glob('/tmp/glob_test_file.txt')
print(files)
"`);
      expect(result.stdout).toContain("glob_test_file.txt");
      expect(result.exitCode).toBe(0);
    });

    it("should redirect os.walk to /host", async () => {
      const env = new Bash({ python: true });
      await env.exec("mkdir -p /tmp/walk_dir");
      await env.exec('echo "a" > /tmp/walk_dir/file.txt');
      await env.exec(`cat > /tmp/test_walk.py << 'EOF'
import os
for root, dirs, files in os.walk('/tmp/walk_dir'):
    print(f'root={root}, files={files}')
EOF`);
      const result = await env.exec("python3 /tmp/test_walk.py");
      expect(result.stdout).toContain("root=/tmp/walk_dir");
      expect(result.stdout).toContain("file.txt");
      expect(result.exitCode).toBe(0);
    });

    it("should redirect pathlib.Path operations to /host", async () => {
      const env = new Bash({ python: true });
      await env.exec('echo "pathlib content" > /tmp/pathlib_test.txt');
      await env.exec(`cat > /tmp/test_pathlib.py << 'EOF'
from pathlib import Path
p = Path('/tmp/pathlib_test.txt')
print('exists:', p.exists())
print('content:', p.read_text().strip())
EOF`);
      const result = await env.exec("python3 /tmp/test_pathlib.py");
      expect(result.stdout).toContain("exists: True");
      expect(result.stdout).toContain("content: pathlib content");
      expect(result.exitCode).toBe(0);
    });

    it("should strip /host prefix from os.getcwd", async () => {
      const env = new Bash({ python: true });
      await env.exec("mkdir -p /tmp/cwd_test");
      const result = await env.exec(`python3 -c "
import os
os.chdir('/tmp/cwd_test')
print(os.getcwd())
"`);
      expect(result.stdout).toBe("/tmp/cwd_test\n");
      expect(result.stdout).not.toContain("/host");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("legitimate operations", () => {
    it("should allow standard library imports", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(
        "python3 -c \"import json, math, re, datetime, collections; print('OK')\"",
      );
      expect(result.stdout).toBe("OK\n");
      expect(result.exitCode).toBe(0);
    });

    it("should allow jb_http module", async () => {
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/test_jb_http.py << 'EOF'
import jb_http
try:
    resp = jb_http.get('http://example.com')
    print('HTTP_OK:', resp.status_code)
except Exception as e:
    msg = str(e)
    if 'Network' in msg or 'not configured' in msg:
        print('OK: bridge works, network not configured')
    else:
        print('OK: bridge works, got error:', msg[:80])
EOF`);
      const result = await env.exec("python3 /tmp/test_jb_http.py");
      expect(result.stdout).toContain("OK");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("module name validation", () => {
    it("should reject module names with quotes", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(
        'python3 -m "os\'; import sys; sys.exit(42); #"',
      );
      expect(result.exitCode).not.toBe(42);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No module named");
    });

    it("should reject module names with newlines", async () => {
      const env = new Bash({ python: true });
      // Newlines would break out of the string if not validated
      const result = await env.exec('python3 -m "os\nimport os"');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No module named");
    });

    it("should reject module names with special characters", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec('python3 -m "os; import sys"');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No module named");
    });

    it(
      "should allow valid dotted module names",
      { timeout: 60000 },
      async () => {
        const env = new Bash({ python: true });
        // platform is a stdlib module that prints platform info
        const result = await env.exec("python3 -m platform");
        expect(result.stdout).toContain("Emscripten");
        expect(result.exitCode).toBe(0);
      },
    );
  });

  describe("timeout worker termination (Fix 2)", () => {
    it("should terminate worker on timeout", { timeout: 60000 }, async () => {
      const env = new Bash({
        python: true,
        executionLimits: { maxPythonTimeoutMs: 2000 },
      });
      const result = await env.exec('python3 -c "import time; time.sleep(30)"');
      expect(result.stderr).toContain("timeout");
      expect(result.exitCode).not.toBe(0);
    });
  });
});

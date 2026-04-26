import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec Node.js compatibility", () => {
  describe("node: prefix imports", () => {
    it("should support import from 'node:fs'", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/test.txt": "node-fs-works" },
      });
      const result = await env.exec(
        `js-exec -m -c "import fs from 'node:fs'; console.log(fs.readFileSync('/home/user/test.txt'))"`,
      );
      expect(result.stdout).toBe("node-fs-works\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support import from 'node:path'", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import path from 'node:path'; console.log(path.join('/a', 'b', 'c'))"`,
      );
      expect(result.stdout).toBe("/a/b/c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support import from 'node:process'", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import process from 'node:process'; console.log(process.platform)"`,
      );
      expect(result.stdout).toBe("linux\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("fs sync aliases", () => {
    it("should support readFileSync", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/data.txt": "sync-read" },
      });
      const result = await env.exec(
        `js-exec -c "console.log(fs.readFileSync('/home/user/data.txt'))"`,
      );
      expect(result.stdout).toBe("sync-read\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support writeFileSync", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.writeFileSync('/tmp/sync.txt', 'written'); console.log(fs.readFileSync('/tmp/sync.txt'))"`,
      );
      expect(result.stdout).toBe("written\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support existsSync", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/file.txt": "x" },
      });
      const result = await env.exec(
        `js-exec -c "console.log(fs.existsSync('/home/user/file.txt'), fs.existsSync('/nope'))"`,
      );
      expect(result.stdout).toBe("true false\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support mkdirSync, readdirSync, rmSync", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.mkdirSync('/tmp/sdir'); fs.writeFileSync('/tmp/sdir/a.txt', 'a'); console.log(JSON.stringify(fs.readdirSync('/tmp/sdir'))); fs.rmSync('/tmp/sdir', {recursive: true}); console.log(fs.existsSync('/tmp/sdir'))"`,
      );
      expect(result.stdout).toBe('["a.txt"]\nfalse\n');
      expect(result.exitCode).toBe(0);
    });

    it("should support unlinkSync as alias for rm", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.writeFileSync('/tmp/del.txt', 'x'); fs.unlinkSync('/tmp/del.txt'); console.log(fs.existsSync('/tmp/del.txt'))"`,
      );
      expect(result.stdout).toBe("false\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("fs.promises", () => {
    it("should support fs.promises.readFile", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/p.txt": "promise-read" },
      });
      const result = await env.exec(
        `js-exec -m -c "const data = await fs.promises.readFile('/home/user/p.txt'); console.log(data)"`,
      );
      expect(result.stdout).toBe("promise-read\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support fs.promises.writeFile + readFile", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "await fs.promises.writeFile('/tmp/pw.txt', 'pdata'); const d = await fs.promises.readFile('/tmp/pw.txt'); console.log(d)"`,
      );
      expect(result.stdout).toBe("pdata\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support fs.promises.stat", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/s.txt": "12345" },
      });
      const result = await env.exec(
        `js-exec -m -c "const s = await fs.promises.stat('/home/user/s.txt'); console.log(s.isFile, s.size)"`,
      );
      expect(result.stdout).toBe("true 5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support fs.promises.access", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/ok.txt": "x" },
      });
      const result = await env.exec(
        `js-exec -m -c "
          let ok = false;
          try { await fs.promises.access('/home/user/ok.txt'); ok = true; } catch {}
          let fail = false;
          try { await fs.promises.access('/nope'); } catch { fail = true; }
          console.log(ok, fail);
        "`,
      );
      expect(result.stdout).toBe("true true\n");
      expect(result.exitCode).toBe(0);
    });

    it("should reject on error", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "
          let caught = false;
          try { await fs.promises.readFile('/nonexistent'); }
          catch(e) { caught = true; }
          console.log(caught);
        "`,
      );
      expect(result.stdout).toBe("true\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("callback error detection", () => {
    it("should throw on callback-style fs.readFile", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/f.txt": "x" },
      });
      const result = await env.exec(
        `js-exec -c "try { fs.readFile('/home/user/f.txt', function(err, data) {}); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toContain("callbacks is not supported");
      expect(result.exitCode).toBe(0);
    });

    it("should not affect sync aliases", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/f.txt": "sync-ok" },
      });
      const result = await env.exec(
        `js-exec -c "console.log(fs.readFileSync('/home/user/f.txt'))"`,
      );
      expect(result.stdout).toBe("sync-ok\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("new fs operations", () => {
    it("should support lstat", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/f.txt": "hello" },
      });
      const result = await env.exec(
        `js-exec -c "const s = fs.lstatSync('/home/user/f.txt'); console.log(s.isFile, s.size)"`,
      );
      expect(result.stdout).toBe("true 5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support symlink + readlink", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/target.txt": "linked" },
      });
      const result = await env.exec(
        `js-exec -c "fs.symlinkSync('/home/user/target.txt', '/home/user/link.txt'); console.log(fs.readlinkSync('/home/user/link.txt'))"`,
      );
      expect(result.stdout).toBe("/home/user/target.txt\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support chmod", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.writeFileSync('/tmp/ch.txt', 'x'); fs.chmodSync('/tmp/ch.txt', 0o755); const s = fs.statSync('/tmp/ch.txt'); console.log(s.mode)"`,
      );
      // mode should have changed
      expect(result.stdout.trim()).toBeTruthy();
      expect(result.exitCode).toBe(0);
    });

    it("should support realpath", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/real.txt": "real" },
      });
      const result = await env.exec(
        `js-exec -c "console.log(fs.realpathSync('/home/user/real.txt'))"`,
      );
      expect(result.stdout).toBe("/home/user/real.txt\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support rename", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.writeFileSync('/tmp/old.txt', 'moved'); fs.renameSync('/tmp/old.txt', '/tmp/new.txt'); console.log(fs.readFileSync('/tmp/new.txt')); console.log(fs.existsSync('/tmp/old.txt'))"`,
      );
      expect(result.stdout).toBe("moved\nfalse\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support copyFile", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.writeFileSync('/tmp/src.txt', 'copied'); fs.copyFileSync('/tmp/src.txt', '/tmp/dst.txt'); console.log(fs.readFileSync('/tmp/dst.txt')); console.log(fs.existsSync('/tmp/src.txt'))"`,
      );
      expect(result.stdout).toBe("copied\ntrue\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("process enhancements", () => {
    it("should expose process.env matching env global", async () => {
      const env = new Bash({
        javascript: true,
        env: { MY_VAR: "hello123" },
      });
      const result = await env.exec(
        `js-exec -c "console.log(process.env.MY_VAR)"`,
      );
      expect(result.stdout).toBe("hello123\n");
      expect(result.exitCode).toBe(0);
    });

    it("should expose process.platform", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(process.platform)"`,
      );
      expect(result.stdout).toBe("linux\n");
      expect(result.exitCode).toBe(0);
    });

    it("should expose process.arch", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "console.log(process.arch)"`);
      expect(result.stdout).toBe("x64\n");
      expect(result.exitCode).toBe(0);
    });

    it("should expose process.versions", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(process.versions.node)"`,
      );
      expect(result.stdout).toBe("22.0.0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should expose process.version", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(process.version)"`,
      );
      expect(result.stdout).toBe("v22.0.0\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("path module", () => {
    it("should support path.join", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import path from 'path'; console.log(path.join('/a', 'b', 'c'))"`,
      );
      expect(result.stdout).toBe("/a/b/c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support path.dirname", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { dirname } from 'path'; console.log(dirname('/a/b/c.txt'))"`,
      );
      expect(result.stdout).toBe("/a/b\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support path.basename with optional ext", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { basename } from 'path'; console.log(basename('/a/b/c.txt')); console.log(basename('/a/b/c.txt', '.txt'))"`,
      );
      expect(result.stdout).toBe("c.txt\nc\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support path.extname", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { extname } from 'path'; console.log(extname('file.js')); console.log(extname('file')); console.log(extname('.hidden'))"`,
      );
      expect(result.stdout).toBe(".js\n\n\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support path.resolve", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { resolve } from 'path'; console.log(resolve('/a/b', '../c'))"`,
      );
      expect(result.stdout).toBe("/a/c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support path.normalize", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { normalize } from 'path'; console.log(normalize('/a/b/../c/./d'))"`,
      );
      expect(result.stdout).toBe("/a/c/d\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support path.isAbsolute", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { isAbsolute } from 'path'; console.log(isAbsolute('/a')); console.log(isAbsolute('a'))"`,
      );
      expect(result.stdout).toBe("true\nfalse\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support path.relative", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { relative } from 'path'; console.log(relative('/a/b', '/a/c/d'))"`,
      );
      expect(result.stdout).toBe("../c/d\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support path.parse and path.format", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { parse, format } from 'path'; const p = parse('/home/user/file.txt'); console.log(p.dir, p.base, p.ext, p.name); console.log(format(p))"`,
      );
      expect(result.stdout).toBe(
        "/home/user file.txt .txt file\n/home/user/file.txt\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should support path.sep and path.delimiter", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { sep, delimiter } from 'path'; console.log(sep, delimiter)"`,
      );
      expect(result.stdout).toBe("/ :\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("child_process module", () => {
    it("should support execSync from node:child_process", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { execSync } from 'node:child_process'; const out = execSync('echo hello'); console.log(out.trim())"`,
      );
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should throw from execSync on failure", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { execSync } from 'node:child_process'; try { execSync('false'); } catch(e) { console.log('caught:', e.status); }"`,
      );
      expect(result.stdout).toBe("caught: 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support spawnSync from node:child_process", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { spawnSync } from 'node:child_process'; const r = spawnSync('echo', ['hi']); console.log(r.stdout.trim(), r.status)"`,
      );
      expect(result.stdout).toBe("hi 0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should prevent command injection via spawnSync args", async () => {
      const env = new Bash({ javascript: true });
      // The semicolon and extra command should NOT be interpreted as shell syntax
      const result = await env.exec(
        `js-exec -c "var r = require('child_process').spawnSync('echo', ['hello; echo INJECTED']); console.log(r.stdout.trim())"`,
      );
      expect(result.stdout).toBe("hello; echo INJECTED\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle embedded single quotes in spawnSync args", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var r = require('child_process').spawnSync('echo', [\\"it's\\"]); console.log(r.stdout.trim())"`,
      );
      expect(result.stdout).toBe("it's\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle empty args array in spawnSync", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var r = require('child_process').spawnSync('echo', []); console.log(r.stdout.trim())"`,
      );
      expect(result.stdout).toBe("\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("error messages with file names and line numbers", () => {
    it("should show file path and line for ReferenceError in script file", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/app.mjs":
            "const x = 1;\nconst y = 2;\nundefinedVar.foo;\n",
        },
      });
      const result = await env.exec("js-exec /home/user/app.mjs");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "at <anonymous> (/home/user/app.mjs:3:1): 'undefinedVar' is not defined\n",
      );
      expect(result.stdout).toBe("");
    });

    it("should show file path and line for TypeError in script file", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/app.mjs": "const x = null;\nx.foo();\n",
        },
      });
      const result = await env.exec("js-exec /home/user/app.mjs");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "at <anonymous> (/home/user/app.mjs:2:2): cannot read property 'foo' of null\n",
      );
      expect(result.stdout).toBe("");
    });

    it("should show -c and column for inline code errors", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const x = 1; undefinedVar.foo;"`,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "at <eval> (-c:1:14): 'undefinedVar' is not defined\n",
      );
      expect(result.stdout).toBe("");
    });

    it("should show originating file and function name for imported module errors", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/main.mjs":
            "import { helper } from './utils.mjs';\nhelper();\n",
          "/home/user/utils.mjs":
            "export function helper() {\n  undefinedVar.foo;\n}\n",
        },
      });
      const result = await env.exec("js-exec /home/user/main.mjs");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "at helper (/home/user/utils.mjs:2:3): 'undefinedVar' is not defined\n",
      );
      expect(result.stdout).toBe("");
    });

    it("should show deepest frame for deeply nested import errors", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/main.mjs": "import './a.mjs';\n",
          "/home/user/a.mjs": "import './b.mjs';\n",
          "/home/user/b.mjs": "throw new Error('deep error');\n",
        },
      });
      const result = await env.exec("js-exec /home/user/main.mjs");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "at <anonymous> (/home/user/b.mjs:1:16): deep error\n",
      );
      expect(result.stdout).toBe("");
    });

    it("should show function name in stack trace for thrown Error", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/app.mjs": "import { run } from './lib.mjs';\nrun();\n",
          "/home/user/lib.mjs":
            "export function run() {\n  doStuff();\n}\nfunction doStuff() {\n  throw new Error('boom');\n}\n",
        },
      });
      const result = await env.exec("js-exec /home/user/app.mjs");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "at doStuff (/home/user/lib.mjs:5:18): boom\n",
      );
      expect(result.stdout).toBe("");
    });

    it("should show correct line for error late in a long file", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/long.mjs": `${Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n")}\nundefinedVar.crash;\n`,
        },
      });
      const result = await env.exec("js-exec /home/user/long.mjs");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "at <anonymous> (/home/user/long.mjs:21:1): 'undefinedVar' is not defined\n",
      );
      expect(result.stdout).toBe("");
    });

    it("should show file and line for syntax errors", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/bad.mjs": "function foo() {\n  if (true\n}\n",
        },
      });
      const result = await env.exec("js-exec /home/user/bad.mjs");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("at /home/user/bad.mjs:3:1: expecting ')'\n");
      expect(result.stdout).toBe("");
    });

    it("should output thrown string values directly", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "throw 'bare string error'"`);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("bare string error\n");
      expect(result.stdout).toBe("");
    });

    it("should output thrown number values directly", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "throw 42"`);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("42\n");
      expect(result.stdout).toBe("");
    });

    it("should show file path for CJS script errors without <eval> wrapper", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/app.js": "const x = 1;\nundefinedVar.foo;\n",
        },
      });
      const result = await env.exec("js-exec /home/user/app.js");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(
        "at /home/user/app.js:2:1: 'undefinedVar' is not defined\n",
      );
      expect(result.stdout).toBe("");
    });

    it("should show callback error message clearly", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { fs.writeFile('/tmp/x', 'data', function cb() {}); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toContain("callbacks is not supported");
      expect(result.stdout).toContain("writeFileSync");
      expect(result.stdout).toContain("fs.promises.writeFile");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("require()", () => {
    it("should support require('fs')", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/data.txt": "cjs-read" },
      });
      const result = await env.exec(
        `js-exec -c "const fs = require('fs'); console.log(fs.readFileSync('/home/user/data.txt'))"`,
      );
      expect(result.stdout).toBe("cjs-read\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support require('node:fs')", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/data.txt": "node-cjs" },
      });
      const result = await env.exec(
        `js-exec -c "const fs = require('node:fs'); console.log(fs.readFileSync('/home/user/data.txt'))"`,
      );
      expect(result.stdout).toBe("node-cjs\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support require('path')", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const path = require('path'); console.log(path.join('/a', 'b'))"`,
      );
      expect(result.stdout).toBe("/a/b\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support require('child_process')", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const cp = require('child_process'); console.log(cp.execSync('echo cjs').trim())"`,
      );
      expect(result.stdout).toBe("cjs\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support require('process')", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const p = require('process'); console.log(p.platform)"`,
      );
      expect(result.stdout).toBe("linux\n");
      expect(result.exitCode).toBe(0);
    });

    it("should throw for unknown modules", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { require('totally_unknown'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toContain("Cannot find module");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("os module", () => {
    it("should support require('os').platform()", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(require('os').platform())"`,
      );
      expect(result.stdout).toBe("linux\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support os.homedir() and os.tmpdir()", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var os = require('os'); console.log(os.homedir(), os.tmpdir())"`,
      );
      expect(result.stdout).toBe("/home/user /tmp\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support os.EOL", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(JSON.stringify(require('os').EOL))"`,
      );
      expect(result.stdout).toBe('"\\n"\n');
      expect(result.exitCode).toBe(0);
    });

    it("should support os.arch()", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(require('os').arch())"`,
      );
      expect(result.stdout).toBe("x64\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support os.type()", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(require('os').type())"`,
      );
      expect(result.stdout).toBe("Linux\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support os.hostname()", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(require('os').hostname())"`,
      );
      expect(result.stdout).toBe("sandbox\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support os.cpus()", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(JSON.stringify(require('os').cpus()))"`,
      );
      expect(result.stdout).toBe("[]\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support os.totalmem() and os.freemem()", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var os = require('os'); console.log(os.totalmem(), os.freemem())"`,
      );
      expect(result.stdout).toBe("0 0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support os.endianness()", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(require('os').endianness())"`,
      );
      expect(result.stdout).toBe("LE\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support ESM import from 'os'", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { platform } from 'os'; console.log(platform())"`,
      );
      expect(result.stdout).toBe("linux\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("url module", () => {
    it("should re-export URL from require('url')", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var u = new (require('url').URL)('https://example.com/path?q=1'); console.log(u.hostname, u.pathname)"`,
      );
      expect(result.stdout).toBe("example.com /path\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("assert module", () => {
    it("should not throw on assert.ok(true)", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "require('assert').ok(true); console.log('passed')"`,
      );
      expect(result.stdout).toBe("passed\n");
      expect(result.exitCode).toBe(0);
    });

    it("should throw on assert.strictEqual mismatch", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { require('assert').strictEqual(1, 2); } catch(e) { console.log('caught'); }"`,
      );
      expect(result.stdout).toBe("caught\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support assert.deepEqual", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var a = require('assert'); a.deepEqual({x:1}, {x:1}); console.log('ok')"`,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support assert.throws", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var a = require('assert'); a.throws(function() { throw new Error('boom'); }); console.log('ok')"`,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support assert.equal and assert.notEqual", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var a = require('assert'); a.equal(1, '1'); a.notEqual(1, 2); console.log('ok')"`,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support assert.strictEqual and assert.notStrictEqual", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var a = require('assert'); a.strictEqual(1, 1); a.notStrictEqual(1, '1'); console.log('ok')"`,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support assert.deepStrictEqual", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var a = require('assert'); a.deepStrictEqual({x:[1,2]}, {x:[1,2]}); console.log('ok')"`,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support assert.notDeepEqual", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var a = require('assert'); a.notDeepEqual({x:1}, {x:2}); console.log('ok')"`,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support assert.doesNotThrow", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var a = require('assert'); a.doesNotThrow(function() { return 1; }); console.log('ok')"`,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support assert.fail", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var a = require('assert'); try { a.fail('nope'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toBe("nope\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support ESM import from 'assert'", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import assert from 'assert'; assert(true); console.log('ok')"`,
      );
      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("util module", () => {
    it("should support util.format with %s and %d", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(require('util').format('%s=%d', 'x', 42))"`,
      );
      expect(result.stdout).toBe("x=42\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support util.format %i %j %f specifiers", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var f = require('util').format; console.log(f('%i', 3.7)); console.log(f('%j', {a:1})); console.log(f('%f', '3.14'))"`,
      );
      expect(result.stdout).toBe('3\n{"a":1}\n3.14\n');
      expect(result.exitCode).toBe(0);
    });

    it("should support util.format %o/%O object specifiers", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var f = require('util').format; console.log(f('%o', [1,2])); console.log(f('%O', {x:1}))"`,
      );
      expect(result.stdout).toBe('[1,2]\n{"x":1}\n');
      expect(result.exitCode).toBe(0);
    });

    it("should support util.format with no args", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(JSON.stringify(require('util').format()))"`,
      );
      expect(result.stdout).toBe('""\n');
      expect(result.exitCode).toBe(0);
    });

    it("should keep literal specifiers when args insufficient", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(require('util').format('%s %s %s', 'a'))"`,
      );
      expect(result.stdout).toBe("a %s %s\n");
      expect(result.exitCode).toBe(0);
    });

    it("should append extra args beyond format specifiers", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(require('util').format('%s', 'a', 'b', 'c'))"`,
      );
      expect(result.stdout).toBe("a b c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should space-separate all args when no format string", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(require('util').format(1, 2, 3))"`,
      );
      expect(result.stdout).toBe("1 2 3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support util.format %% escape", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(require('util').format('100%%'))"`,
      );
      expect(result.stdout).toBe("100%\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support util.inspect", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var u = require('util'); console.log(u.inspect({a:1})); console.log(u.inspect(null)); console.log(u.inspect(undefined))"`,
      );
      expect(result.stdout).toBe('{"a":1}\nnull\nundefined\n');
      expect(result.exitCode).toBe(0);
    });

    it("should support util.promisify", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "var u = require('util'); function cbFn(val, cb) { cb(null, val + '!'); } var p = u.promisify(cbFn); var r = await p('hi'); console.log(r)"`,
      );
      expect(result.stdout).toBe("hi!\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support util.types.isDate", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var u = require('util'); console.log(u.types.isDate(new Date()), u.types.isDate('nope'))"`,
      );
      expect(result.stdout).toBe("true false\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("events module", () => {
    it("should support EventEmitter", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var EE = require('events').EventEmitter; var e = new EE(); e.on('test', function(v) { console.log(v); }); e.emit('test', 'hello')"`,
      );
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support ESM import of EventEmitter", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "import { EventEmitter } from 'events'; var e = new EventEmitter(); var v = []; e.on('x', function(a) { v.push(a); }); e.emit('x', 1); e.emit('x', 2); console.log(v.join(','))"`,
      );
      expect(result.stdout).toBe("1,2\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("buffer module", () => {
    it("should support Buffer.from string", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var b = require('buffer').Buffer.from('hello'); console.log(b.toString(), b.length)"`,
      );
      expect(result.stdout).toBe("hello 5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Buffer.alloc and Buffer.isBuffer", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var B = require('buffer').Buffer; var b = B.alloc(4); console.log(B.isBuffer(b), b.length)"`,
      );
      expect(result.stdout).toBe("true 4\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Buffer.concat", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var B = require('buffer').Buffer; var c = B.concat([B.from('ab'), B.from('cd')]); console.log(c.toString(), c.length)"`,
      );
      expect(result.stdout).toBe("abcd 4\n");
      expect(result.exitCode).toBe(0);
    });

    it("should expose global Buffer", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(Buffer.from('test').toString())"`,
      );
      expect(result.stdout).toBe("test\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Buffer.slice", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var b = Buffer.from('hello'); console.log(b.slice(1, 3).toString())"`,
      );
      expect(result.stdout).toBe("el\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Buffer.copy", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var a = Buffer.from('hello'); var b = Buffer.alloc(3); a.copy(b, 0, 1, 4); console.log(b.toString())"`,
      );
      expect(result.stdout).toBe("ell\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Buffer.write", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var b = Buffer.alloc(5); b.write('hi'); console.log(b.slice(0, 2).toString())"`,
      );
      expect(result.stdout).toBe("hi\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Buffer.fill", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var b = Buffer.alloc(3); b.fill(65); console.log(b.toString())"`,
      );
      expect(result.stdout).toBe("AAA\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Buffer.equals", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(Buffer.from('ab').equals(Buffer.from('ab')), Buffer.from('ab').equals(Buffer.from('cd')))"`,
      );
      expect(result.stdout).toBe("true false\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Buffer readUInt8/writeUInt8", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var b = Buffer.alloc(2); b.writeUInt8(42, 0); b.writeUInt8(99, 1); console.log(b.readUInt8(0), b.readUInt8(1))"`,
      );
      expect(result.stdout).toBe("42 99\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Buffer.byteLength", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(Buffer.byteLength('hello'), Buffer.byteLength(''))"`,
      );
      expect(result.stdout).toBe("5 0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Buffer.toJSON", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var j = Buffer.from('AB').toJSON(); console.log(j.type, JSON.stringify(j.data))"`,
      );
      expect(result.stdout).toBe("Buffer [65,66]\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("stream module", () => {
    it("should expose stream classes", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var s = require('stream'); console.log(typeof s.Readable, typeof s.Writable, typeof s.Transform)"`,
      );
      expect(result.stdout).toBe("function function function\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("string_decoder module", () => {
    it("should decode buffers to strings", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var SD = require('string_decoder').StringDecoder; var d = new SD(); console.log(d.write(Buffer.from('hi')))"`,
      );
      expect(result.stdout).toBe("hi\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support end() with buffer arg", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var SD = require('string_decoder').StringDecoder; var d = new SD(); console.log(d.end(Buffer.from('bye')))"`,
      );
      expect(result.stdout).toBe("bye\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return empty string from end() without arg", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var SD = require('string_decoder').StringDecoder; var d = new SD(); console.log(JSON.stringify(d.end()))"`,
      );
      expect(result.stdout).toBe('""\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe("querystring module", () => {
    it("should parse and stringify", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var qs = require('querystring'); var o = qs.parse('a=1&b=2'); console.log(o.a, o.b); console.log(qs.stringify({x:'3',y:'4'}))"`,
      );
      expect(result.stdout).toBe("1 2\nx=3&y=4\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support escape and unescape", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var qs = require('querystring'); console.log(qs.escape('a b&c')); console.log(qs.unescape('a%20b%26c'))"`,
      );
      expect(result.stdout).toBe("a%20b%26c\na b&c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support custom separators", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var qs = require('querystring'); var o = qs.parse('a:1;b:2', ';', ':'); console.log(o.a, o.b); console.log(qs.stringify({x:'1',y:'2'}, ';', ':'))"`,
      );
      expect(result.stdout).toBe("1 2\nx:1;y:2\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("unsupported module errors", () => {
    it("should give clear error for require('http') with fetch hint and help pointer", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { require('http'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toBe(
        "Module 'http' is not available in the js-exec sandbox. Use fetch() for HTTP requests. Run 'js-exec --help' for available modules.\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should give clear error for require('node:http')", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { require('node:http'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toContain("not available in the js-exec sandbox");
      expect(result.stdout).toContain("fetch()");
      expect(result.stdout).toContain("js-exec --help");
      expect(result.exitCode).toBe(0);
    });

    it("should give clear error for require('crypto')", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { require('crypto'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toBe(
        "Module 'crypto' is not available in the js-exec sandbox. Crypto APIs are not available in this sandbox. Run 'js-exec --help' for available modules.\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should give clear error for require('net')", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { require('net'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toContain("not available in the js-exec sandbox");
      expect(result.stdout).toContain("Network socket");
      expect(result.stdout).toContain("js-exec --help");
      expect(result.exitCode).toBe(0);
    });

    it("should give clear error for ESM import of unsupported module", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -m -c "import 'http'"`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not available in the js-exec sandbox");
      expect(result.stderr).toContain("js-exec --help");
    });

    it("should point to --help for truly unknown modules", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { require('nonexistent'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toBe(
        "Cannot find module 'nonexistent'. Run 'js-exec --help' for available modules.\n",
      );
      expect(result.exitCode).toBe(0);
    });
  });
});

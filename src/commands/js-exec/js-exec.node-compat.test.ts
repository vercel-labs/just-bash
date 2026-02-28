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
  });

  describe("error messages with file names and line numbers", () => {
    it("should include file name in error from script file", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/bad.mjs": "const x = 1;\nundefinedVar.foo;\n",
        },
      });
      const result = await env.exec("js-exec /home/user/bad.mjs");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("bad.mjs");
      expect(result.stderr).toContain("undefinedVar");
    });

    it("should include line number in error from multi-line script", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/err.mjs":
            "const a = 1;\nconst b = 2;\nundefinedVar.foo;\n",
        },
      });
      const result = await env.exec("js-exec /home/user/err.mjs");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("err.mjs");
      expect(result.stderr).toContain("not defined");
    });

    it("should include file name in error from imported module", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/main.mjs":
            "import { broken } from './lib.mjs';\nconsole.log(broken);\n",
          "/home/user/lib.mjs": "export const broken = undefinedVar.foo;\n",
        },
      });
      const result = await env.exec("js-exec /home/user/main.mjs");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("lib.mjs");
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
        `js-exec -c "try { require('http'); } catch(e) { console.log(e.message); }"`,
      );
      expect(result.stdout).toContain("Cannot find module");
      expect(result.exitCode).toBe(0);
    });
  });
});

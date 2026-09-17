import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec fs operations", () => {
  describe("readFile", () => {
    it("should read a file", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/test.txt": "hello world",
        },
      });
      const result = await env.exec(
        `js-exec -c "console.log(fs.readFileSync('/home/user/test.txt'))"`,
      );
      expect(result.stdout).toBe("hello world\n");
      expect(result.exitCode).toBe(0);
    });

    it("should preserve binary bytes across bounded reads", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/binary.bin": new Uint8Array([0, 127, 128, 255]),
        },
      });
      const result = await env.exec(
        `js-exec -c "const fs = require('fs'); const raw = fs.readFileBuffer('/home/user/binary.bin'); console.log(fs.readFileSync('/home/user/binary.bin').toString('hex')); console.log(raw instanceof ArrayBuffer, raw.byteLength, Array.from(new Uint8Array(raw)).join(','))"`,
      );

      expect(result.stdout).toBe("007f80ff\ntrue 4 0,127,128,255\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should throw on non-existent file", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { fs.readFileSync('/no/such/file'); } catch(e) { console.log('error: ' + e.message); }"`,
      );
      expect(result.stdout).toContain("error:");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("writeFile", () => {
    it("should write and read back a file", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.writeFileSync('/tmp/out.txt', 'test data'); console.log(fs.readFileSync('/tmp/out.txt'))"`,
      );
      expect(result.stdout).toBe("test data\n");
      expect(result.exitCode).toBe(0);
    });

    it("should preserve binary bytes written from a Buffer", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.writeFileSync('/tmp/binary.bin', Buffer.from([0, 127, 128, 255])); console.log(fs.readFileSync('/tmp/binary.bin').toString('hex'))"`,
      );

      expect(result.stdout).toBe("007f80ff\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/file.txt": "data" },
      });
      const result = await env.exec(
        `js-exec -c "console.log(fs.existsSync('/home/user/file.txt'))"`,
      );
      expect(result.stdout).toBe("true\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return false for non-existing file", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(fs.existsSync('/no/such/file'))"`,
      );
      expect(result.stdout).toBe("false\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("stat", () => {
    it("should stat a file", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/file.txt": "12345" },
      });
      const result = await env.exec(
        `js-exec -c "const s = fs.statSync('/home/user/file.txt'); console.log(s.isFile(), s.size)"`,
      );
      expect(result.stdout).toBe("true 5\n");
      expect(result.exitCode).toBe(0);
    });

    it("should stat a directory", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const s = fs.statSync('/home'); console.log(s.isDirectory())"`,
      );
      expect(result.stdout).toBe("true\n");
      expect(result.exitCode).toBe(0);
    });

    it("should answer with an fs.Stats carrying Dates and the other type queries", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/file.txt": "12345" },
      });
      const result = await env.exec(
        `js-exec -c "const s = fs.statSync('/home/user/file.txt'); s.atime.setTime(0); console.log(s instanceof fs.Stats, s.mtime instanceof Date, s.mtime.getTime() === s.mtimeMs, s.birthtime instanceof Date, s.isSymbolicLink(), s.isFIFO(), Object.keys(s).includes('_kind'))"`,
      );
      expect(result.stdout).toBe("true true true true false false false\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("readdir", () => {
    it("should list directory entries", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/a.txt": "a",
          "/home/user/b.txt": "b",
        },
      });
      const result = await env.exec(
        `js-exec -c "const entries = fs.readdirSync('/home/user'); console.log(JSON.stringify(entries.sort()))"`,
      );
      const entries = JSON.parse(result.stdout.trim());
      expect(entries).toContain("a.txt");
      expect(entries).toContain("b.txt");
      expect(result.exitCode).toBe(0);
    });

    it("should return Dirents with withFileTypes", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/a.txt": "a",
          "/home/user/sub/b.txt": "b",
        },
      });
      const result = await env.exec(
        `js-exec -c "const d = fs.readdirSync('/home/user', { withFileTypes: true }); console.log(JSON.stringify(d.map((e) => [e.parentPath, e.name, e.isFile(), e.isDirectory(), e instanceof fs.Dirent]).sort()))"`,
      );
      expect(result.stdout).toBe(
        '[["/home/user","a.txt",true,false,true],["/home/user","sub",false,true,true]]\n',
      );
      expect(result.exitCode).toBe(0);
    });

    it("should list every entry below with recursive", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/a.txt": "a",
          "/home/user/sub/b.txt": "b",
          "/home/user/sub/deep/c.txt": "c",
        },
      });
      const names = await env.exec(
        `js-exec -c "console.log(JSON.stringify(fs.readdirSync('/home/user', { recursive: true })))"`,
      );
      expect(names.stdout).toBe(
        '["a.txt","sub","sub/b.txt","sub/deep","sub/deep/c.txt"]\n',
      );
      expect(names.exitCode).toBe(0);

      const dirents = await env.exec(
        `js-exec -c "console.log(JSON.stringify(fs.readdirSync('/home/user/sub', { recursive: true, withFileTypes: true }).map((e) => e.parentPath + '/' + e.name + (e.isDirectory() ? '/' : ''))))"`,
      );
      expect(dirents.stdout).toBe(
        '["/home/user/sub/b.txt","/home/user/sub/deep/","/home/user/sub/deep/c.txt"]\n',
      );
      expect(dirents.exitCode).toBe(0);
    });

    it("should follow a symlinked root and list, not enter, a symlink below it", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/real/a.txt": "a",
          "/home/user/real/sub/b.txt": "b",
        },
      });
      const result = await env.exec(
        `js-exec -c "fs.symlinkSync('/home/user/real', '/home/user/link'); fs.symlinkSync('/home/user/real/sub', '/home/user/real/again'); console.log(JSON.stringify(fs.readdirSync('/home/user/link', { recursive: true })), JSON.stringify(fs.readdirSync('/home/user/real', { recursive: true, withFileTypes: true }).filter((e) => e.isSymbolicLink()).map((e) => e.name)))"`,
      );
      expect(result.stdout).toBe(
        '["a.txt","again","sub","sub/b.txt"] ["again"]\n',
      );
      expect(result.exitCode).toBe(0);
    });

    it("should refuse a file with ENOTDIR, recursive or not", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/a.txt": "a" },
      });
      const result = await env.exec(
        `js-exec -c "const codes = []; for (const opts of [undefined, { recursive: true }, { withFileTypes: true }]) { try { fs.readdirSync('/home/user/a.txt', opts) } catch (e) { codes.push(e.code + ':' + e.syscall) } } console.log(codes.join(' '))"`,
      );
      expect(result.stdout).toBe(
        "ENOTDIR:scandir ENOTDIR:scandir ENOTDIR:scandir\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should keep the path as given in a Dirent's parentPath", async () => {
      const env = new Bash({
        javascript: true,
        files: { "/home/user/sub/b.txt": "b" },
      });
      const result = await env.exec(
        `cd /home/user && js-exec -c "console.log(JSON.stringify(fs.readdirSync('sub', { withFileTypes: true }).map((e) => e.parentPath + '/' + e.name)), JSON.stringify(fs.readdirSync('.', { recursive: true })))"`,
      );
      expect(result.stdout).toBe('["sub/b.txt"] ["sub","sub/b.txt"]\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe("errors", () => {
    it("should carry code, errno, syscall, and the path as given", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { fs.readFileSync('/home/user/missing.txt') } catch (e) { console.log(JSON.stringify({ code: e.code, errno: e.errno, syscall: e.syscall, path: e.path, message: e.message })) }"`,
      );
      expect(result.stdout).toBe(
        '{"code":"ENOENT","errno":-2,"syscall":"open","path":"/home/user/missing.txt","message":"ENOENT: no such file or directory, open \'/home/user/missing.txt\'"}\n',
      );
      expect(result.exitCode).toBe(0);
    });

    it("should name both paths of a two-path call", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "try { fs.renameSync('/home/user/a.txt', '/home/user/b.txt') } catch (e) { console.log(e.code, e.syscall, e.path, e.dest); console.log(e.message) }"`,
      );
      expect(result.stdout).toBe(
        "ENOENT rename /home/user/a.txt /home/user/b.txt\nENOENT: no such file or directory, rename '/home/user/a.txt' -> '/home/user/b.txt'\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should name unlink and rmdir as their own syscalls, promised too", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "const codes = []; try { fs.unlinkSync('/nope') } catch (e) { codes.push(e.syscall) } try { await fs.promises.unlink('/nope') } catch (e) { codes.push(e.syscall) } try { await fs.promises.rmdir('/nope') } catch (e) { codes.push(e.syscall) } console.log(codes.join(' '))"`,
      );
      expect(result.stdout).toBe("unlink unlink rmdir\n");
      expect(result.exitCode).toBe(0);
    });

    it("should keep an apostrophe in the path out of the reason", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/apostrophe.js":
            'try { fs.readFileSync("/home/user/don\'t.txt") } catch (e) { console.log(e.code, e.path); console.log(e.message) }\n',
        },
      });
      const result = await env.exec("js-exec /home/user/apostrophe.js");
      expect(result.stdout).toBe(
        "ENOENT /home/user/don't.txt\nENOENT: no such file or directory, open '/home/user/don't.txt'\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should still report a guest error whose code is not a string", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const e = new Error('boom'); e.code = 7; throw e"`,
      );
      expect(result.stderr).toBe("at <eval> (-c:1:20): boom\n");
      expect(result.exitCode).toBe(1);
    });

    it("should reject fs.promises.access with the same shape", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -m -c "try { await fs.promises.access('/home/user/missing.txt') } catch (e) { console.log(e.code, e.message) }"`,
      );
      expect(result.stdout).toBe(
        "ENOENT ENOENT: no such file or directory, access '/home/user/missing.txt'\n",
      );
      expect(result.exitCode).toBe(0);
    });

    it("should report an uncaught error at the script's own line", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/work/fail.js": "const x = 1;\nfs.statSync('/work/missing.txt');\n",
        },
      });
      const result = await env.exec("js-exec /work/fail.js");
      expect(result.stderr).toBe(
        "at /work/fail.js:2:9: ENOENT: no such file or directory, stat '/work/missing.txt'\n",
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("mkdir", () => {
    it("should create a directory", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.mkdirSync('/tmp/newdir'); console.log(fs.existsSync('/tmp/newdir'))"`,
      );
      expect(result.stdout).toBe("true\n");
      expect(result.exitCode).toBe(0);
    });

    it("should create directories recursively", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.mkdirSync('/tmp/a/b/c', {recursive: true}); console.log(fs.existsSync('/tmp/a/b/c'))"`,
      );
      expect(result.stdout).toBe("true\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("rm", () => {
    it("should remove a file", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.writeFileSync('/tmp/del.txt', 'x'); fs.rmSync('/tmp/del.txt'); console.log(fs.existsSync('/tmp/del.txt'))"`,
      );
      expect(result.stdout).toBe("false\n");
      expect(result.exitCode).toBe(0);
    });

    it("should remove directory recursively", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.mkdirSync('/tmp/rmdir'); fs.writeFileSync('/tmp/rmdir/f.txt', 'x'); fs.rmSync('/tmp/rmdir', {recursive: true}); console.log(fs.existsSync('/tmp/rmdir'))"`,
      );
      expect(result.stdout).toBe("false\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("appendFile", () => {
    it("should append to a file", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fs.writeFileSync('/tmp/app.txt', 'hello'); fs.appendFileSync('/tmp/app.txt', ' world'); console.log(fs.readFileSync('/tmp/app.txt'))"`,
      );
      expect(result.stdout).toBe("hello world\n");
      expect(result.exitCode).toBe(0);
    });
  });
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/in-memory-fs.js";
import { ReadWriteFs } from "../fs/read-write-fs/read-write-fs.js";

describe("permission regressions", () => {
  it("denies reads after a write-only redirection", async () => {
    const bash = new Bash({ files: { "/data.txt": "original\n" } });
    const result = await bash.exec(
      "chmod 200 /data.txt; echo x > /data.txt; cat /data.txt",
    );

    expect(result).toMatchObject({
      stdout: "",
      stderr: "cat: /data.txt: Permission denied\n",
      exitCode: 1,
    });
  });

  it("returns a shell error when a write to an open descriptor is denied", async () => {
    const bash = new Bash();
    const result = await bash.exec("exec 3>/f; chmod 444 /f; echo x >&3");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: echo: write error: Permission denied\n",
      exitCode: 1,
    });
    expect(await bash.fs.readFile("/f")).toBe("");
  });

  it("reports code-only permission errors from a command", async () => {
    class CodeOnlyDeniedFs extends InMemoryFs {
      override async readFileBuffer(path: string): Promise<Uint8Array> {
        if (path === "/data") {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
        return super.readFileBuffer(path);
      }
    }
    const bash = new Bash({ fs: new CodeOnlyDeniedFs({ "/data": "secret" }) });
    const result = await bash.exec("cat /data");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "cat: /data: Permission denied\n",
      exitCode: 1,
    });
  });

  it("replaces a symlink rather than its target with sed -i", async () => {
    const bash = new Bash({ files: { "/target": "a\n" } });
    const result = await bash.exec(
      "ln -s /target /link; sed -i 's/a/b/' /link; if test -L /link; then echo link; else echo file; fi; cat /link; cat /target",
    );

    expect(result).toMatchObject({
      stdout: "file\nb\na\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("edits an in-place file whose name is at the filesystem limit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sed-name-"));
    try {
      const file = `/${"a".repeat(255)}`;
      fs.writeFileSync(path.join(root, file), "a\n");
      const bash = new Bash({ fs: new ReadWriteFs({ root }), cwd: "/" });
      const result = await bash.exec(`sed -i 's/a/b/' ${file}`);

      expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
      expect(await bash.fs.readFile(file)).toBe("b\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports denied reads from sed", async () => {
    const bash = new Bash({
      files: { "/data.txt": { content: "a\n", mode: 0o000 } },
    });
    const result = await bash.exec("sed 's/a/b/' /data.txt");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "sed: can't read /data.txt: Permission denied\n",
      exitCode: 2,
    });
  });

  it("reports denied reads from sed -i", async () => {
    const bash = new Bash({
      files: { "/data.txt": { content: "a\n", mode: 0o000 } },
    });
    const result = await bash.exec("sed -i 's/a/b/' /data.txt");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "sed: can't read /data.txt: Permission denied\n",
      exitCode: 2,
    });
  });

  it("reports denied reads from sed script files", async () => {
    const bash = new Bash({
      files: { "/script": { content: "s/a/b/", mode: 0o000 }, "/data": "a\n" },
    });
    const result = await bash.exec("sed -f /script /data");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "sed: couldn't open file /script: Permission denied\n",
      exitCode: 1,
    });
  });

  it.each(["head", "tail"])("reports denied reads from %s", async (command) => {
    const bash = new Bash({
      files: { "/data": { content: "secret\n", mode: 0o000 } },
    });
    const result = await bash.exec(`${command} /data`);

    expect(result).toMatchObject({
      stdout: "",
      stderr: `${command}: /data: Permission denied\n`,
      exitCode: 1,
    });
  });

  it("does not infer read-write open permission from owner bits", async () => {
    const bash = new Bash({
      files: { "/data.txt": { content: "original\n", mode: 0o400 } },
    });
    const result = await bash.exec('exec 3<> /data.txt; echo "rc=$?"');

    expect(result).toMatchObject({
      stdout: "rc=0\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.fs.readFile("/data.txt")).toBe("original\n");
  });
});

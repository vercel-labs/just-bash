import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/in-memory-fs.js";
import { MountableFs } from "../fs/mountable-fs/mountable-fs.js";
import { OverlayFs } from "../fs/overlay-fs/overlay-fs.js";
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

  it.each([
    "exec 3>/f; exec 4>&3; chmod 444 /f; echo x >&4",
    "{ chmod 444 /f; echo x; } >/f",
    "f() { chmod 444 /f; echo x; }; f >/f",
    "(chmod 444 /f; echo x >&3) 3>/f",
    "exec 3<>/f; chmod 444 /f; echo x >&3",
  ])("keeps the access granted to an open descriptor in %s", async (script) => {
    const bash = new Bash({ files: { "/f": "" } });
    const result = await bash.exec(script);

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await bash.fs.readFile("/f")).toBe("x\n");
    expect((await bash.fs.stat("/f")).mode).toBe(0o444);
  });

  it.each([
    "echo too-big >/dest/f",
    "exec 3>/dest/f; echo too-big >&3",
  ])("returns a shell error when a write fails after open in %s", async (script) => {
    const destination = new InMemoryFs(undefined, { maxTotalBytes: 4 });
    const fs = new MountableFs();
    fs.mount("/dest", destination);
    const result = await new Bash({ fs }).exec(script);

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: echo: write error: No space left on device\n",
      exitCode: 1,
    });
    expect(await destination.readFile("/f")).toBe("");
  });

  it("preserves open write access when chmod copies up an overlay file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "descriptor-mode-"));
    try {
      fs.writeFileSync(path.join(root, "data"), "original", { mode: 0o600 });
      const overlay = new OverlayFs({ root, mountPoint: "/" });
      const bash = new Bash({ fs: overlay });
      const result = await bash.exec(
        "exec 3<>/data; chmod 444 /data; printf X >&3",
      );

      expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
      expect(await overlay.readFile("/data")).toBe("Xriginal");
      expect((await overlay.stat("/data")).mode).toBe(0o444);
      expect(fs.readFileSync(path.join(root, "data"), "utf8")).toBe("original");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not transfer a descriptor's write access to a replacement file", async () => {
    const bash = new Bash({
      files: { "/other": { content: "old", mode: 0o444 } },
    });
    const result = await bash.exec("exec 3>/f; mv /other /f; echo x >&3");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: echo: write error: Bad file descriptor\n",
      exitCode: 1,
    });
    expect(await bash.fs.readFile("/f")).toBe("old");
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
      exitCode: 4,
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

  it("checks lazy file permissions before invoking the provider", async () => {
    let reads = 0;
    const fs = new InMemoryFs();
    fs.writeFileLazy(
      "/source",
      () => {
        reads++;
        return "data";
      },
      { mode: 0o000 },
    );
    await fs.symlink("/source", "/link");
    const bash = new Bash({ fs, cwd: "/" });

    const result = await bash.exec("head source; tail source; cp link copy");

    expect(result).toMatchObject({
      stdout: "",
      stderr:
        "head: source: Permission denied\ntail: source: Permission denied\ncp: cannot open 'link' for reading: Permission denied\n",
      exitCode: 1,
    });
    expect(reads).toBe(0);
    expect(await fs.exists("/copy")).toBe(false);
  });

  it("identifies the unreadable child in a recursive copy", async () => {
    const bash = new Bash({
      cwd: "/",
      files: {
        "/source/child": { content: "data", mode: 0o000 },
      },
    });
    expect(await bash.exec("cp -r source copy")).toMatchObject({
      stdout: "",
      stderr: "cp: cannot open 'source/child' for reading: Permission denied\n",
      exitCode: 1,
    });
  });

  it.each([
    "cat <>",
    "exec 3<>",
  ])("requires write permission for %s", async (command) => {
    const bash = new Bash({
      files: { "/data.txt": { content: "original\n", mode: 0o400 } },
    });
    const result = await bash.exec(`${command} /data.txt`);

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: /data.txt: Permission denied\n",
      exitCode: 1,
    });
    expect(await bash.fs.readFile("/data.txt")).toBe("original\n");
  });
});

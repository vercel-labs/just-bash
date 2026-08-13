import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs host-planted hard-link containment", () => {
  let parentDir: string;
  let sandboxDir: string;
  let outsideFile: string;
  let linkedFile: string;
  let rwfs: ReadWriteFs;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-hard-link-"));
    sandboxDir = path.join(parentDir, "sandbox");
    const outsideDir = path.join(parentDir, "outside");
    fs.mkdirSync(sandboxDir);
    fs.mkdirSync(outsideDir);
    outsideFile = path.join(outsideDir, "victim.txt");
    linkedFile = path.join(sandboxDir, "linked.txt");
    fs.writeFileSync(outsideFile, "outside");
    fs.linkSync(outsideFile, linkedFile);
    rwfs = new ReadWriteFs({ root: sandboxDir });
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("contains overwrite by replacing the sandbox entry", async () => {
    await rwfs.writeFile("/linked.txt", "sandbox");

    expect(fs.readFileSync(linkedFile, "utf8")).toBe("sandbox");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
    expect(fs.statSync(linkedFile).ino).not.toBe(fs.statSync(outsideFile).ino);
    expect(fs.readdirSync(sandboxDir)).toEqual(["linked.txt"]);
  });

  it("contains shell redirection through the public Bash API", async () => {
    const bash = new Bash({ fs: rwfs });

    const result = await bash.exec("echo sandbox > /linked.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.readFileSync(linkedFile, "utf8")).toBe("sandbox\n");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
  });

  it("contains append by copying and replacing the sandbox entry", async () => {
    const oldAtime = new Date("2020-01-01T00:00:00.000Z");
    const oldMtime = new Date("2020-01-02T00:00:00.000Z");
    fs.utimesSync(outsideFile, oldAtime, oldMtime);

    await rwfs.appendFile("/linked.txt", "-sandbox");

    if (process.platform === "linux") {
      expect(fs.statSync(outsideFile).atimeMs).toBe(oldAtime.getTime());
    }
    expect(fs.readFileSync(linkedFile, "utf8")).toBe("outside-sandbox");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
    expect(fs.statSync(linkedFile).ino).not.toBe(fs.statSync(outsideFile).ino);
  });

  it("does not apply the read-size limit to copy-on-write append", async () => {
    const limited = new ReadWriteFs({
      root: sandboxDir,
      maxFileReadSize: 4,
    });

    await limited.appendFile("/linked.txt", "-sandbox");

    expect(fs.readFileSync(linkedFile, "utf8")).toBe("outside-sandbox");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
  });

  it("serializes concurrent appends without losing updates", async () => {
    const target = path.join(sandboxDir, "concurrent.txt");
    fs.writeFileSync(target, "start");
    const appends = Array.from({ length: 20 }, (_, index) => `|${index}`);

    await Promise.all(
      appends.map((content) => rwfs.appendFile("/concurrent.txt", content)),
    );

    const parts = fs.readFileSync(target, "utf8").split("|");
    expect(parts[0]).toBe("start");
    expect(parts.slice(1).sort((a, b) => Number(a) - Number(b))).toEqual(
      appends.map((content) => content.slice(1)),
    );
  });

  it("contains copy over a host-planted hard link", async () => {
    fs.writeFileSync(path.join(sandboxDir, "source.txt"), "copied");

    await rwfs.cp("/source.txt", "/linked.txt");

    expect(fs.readFileSync(linkedFile, "utf8")).toBe("copied");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
    expect(fs.statSync(linkedFile).ino).not.toBe(fs.statSync(outsideFile).ino);
  });

  it("contains recursive copy over a nested host-planted hard link", async () => {
    fs.mkdirSync(path.join(sandboxDir, "source"));
    fs.mkdirSync(path.join(sandboxDir, "dest"));
    fs.writeFileSync(path.join(sandboxDir, "source", "linked.txt"), "copied");
    fs.linkSync(outsideFile, path.join(sandboxDir, "dest", "linked.txt"));

    await rwfs.cp("/source", "/dest", { recursive: true });

    expect(
      fs.readFileSync(path.join(sandboxDir, "dest", "linked.txt"), "utf8"),
    ).toBe("copied");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
  });

  it("contains move over a host-planted hard link", async () => {
    fs.writeFileSync(path.join(sandboxDir, "source.txt"), "moved");

    await rwfs.mv("/source.txt", "/linked.txt");

    expect(fs.readFileSync(linkedFile, "utf8")).toBe("moved");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
  });

  it("removes only the sandbox name", async () => {
    await rwfs.rm("/linked.txt");

    expect(fs.existsSync(linkedFile)).toBe(false);
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
  });

  it("contains later writes through a hard link created inside the sandbox", async () => {
    await rwfs.link("/linked.txt", "/second-link.txt");
    await rwfs.writeFile("/second-link.txt", "sandbox");

    expect(
      fs.readFileSync(path.join(sandboxDir, "second-link.txt"), "utf8"),
    ).toBe("sandbox");
    expect(fs.readFileSync(linkedFile, "utf8")).toBe("outside");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
  });

  it("contains chmod on a multiply-linked file", async () => {
    const preservedAtime = new Date("2020-02-01T00:00:00.000Z");
    const preservedMtime = new Date("2020-02-02T00:00:00.000Z");
    fs.utimesSync(outsideFile, preservedAtime, preservedMtime);
    const originalStat = fs.statSync(outsideFile);
    const originalMode = originalStat.mode & 0o7777;

    await rwfs.chmod("/linked.txt", 0o4755);

    expect(fs.statSync(outsideFile).mode & 0o7777).toBe(originalMode);
    expect(fs.statSync(outsideFile).mtimeMs).toBe(originalStat.mtimeMs);
    expect(fs.statSync(linkedFile).mode & 0o7777).toBe(0o4755);
    expect(fs.statSync(linkedFile).atimeMs).toBe(preservedAtime.getTime());
    expect(fs.statSync(linkedFile).mtimeMs).toBe(preservedMtime.getTime());
    expect(fs.statSync(linkedFile).ino).not.toBe(fs.statSync(outsideFile).ino);
  });

  it("contains utimes on a multiply-linked file", async () => {
    const originalAtime = new Date("2020-03-01T00:00:00.000Z");
    const originalMtimeDate = new Date("2020-03-02T00:00:00.000Z");
    fs.utimesSync(outsideFile, originalAtime, originalMtimeDate);
    const originalMtime = fs.statSync(outsideFile).mtimeMs;
    const changed = new Date("2020-03-03T00:00:00.000Z");

    await rwfs.utimes("/linked.txt", changed, changed);

    expect(fs.statSync(outsideFile).mtimeMs).toBe(originalMtime);
    expect(fs.statSync(linkedFile).mtimeMs).toBe(changed.getTime());
    expect(fs.statSync(linkedFile).ino).not.toBe(fs.statSync(outsideFile).ino);
  });
});

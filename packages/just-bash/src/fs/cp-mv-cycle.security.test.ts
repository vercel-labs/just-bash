import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "./interface.js";
import { OverlayFs } from "./overlay-fs/overlay-fs.js";
import { ReadWriteFs } from "./read-write-fs/read-write-fs.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function realRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "just-bash-cycle-"));
  tempDirs.push(dir);
  return dir;
}

async function assertRejectsDescendantCopy(fsImpl: IFileSystem): Promise<void> {
  await fsImpl.writeFile("/src/file", "original");
  await expect(
    fsImpl.cp("/src", "/src/../src/child", { recursive: true }),
  ).rejects.toThrow("into itself");
  expect(await fsImpl.readFile("/src/file")).toBe("original");
  expect(await fsImpl.exists("/src/child")).toBe(false);
}

async function assertRejectsDescendantMove(fsImpl: IFileSystem): Promise<void> {
  await fsImpl.writeFile("/src/file", "original");
  await expect(fsImpl.mv("/src", "/src/child")).rejects.toThrow("into itself");
  expect(await fsImpl.readFile("/src/file")).toBe("original");
  expect(await fsImpl.exists("/src/child")).toBe(false);
}

describe("recursive copy and move cycle rejection", () => {
  it.each([
    ["InMemoryFs", () => new InMemoryFs()],
    ["OverlayFs", () => new OverlayFs({ root: realRoot(), mountPoint: "/" })],
    ["ReadWriteFs", () => new ReadWriteFs({ root: realRoot() })],
  ] as const)("rejects descendant copies atomically in %s", async (_name, create) => {
    await assertRejectsDescendantCopy(create());
  });

  it.each([
    ["InMemoryFs", () => new InMemoryFs()],
    ["OverlayFs", () => new OverlayFs({ root: realRoot(), mountPoint: "/" })],
    ["ReadWriteFs", () => new ReadWriteFs({ root: realRoot() })],
  ] as const)("rejects descendant moves atomically in %s", async (_name, create) => {
    await assertRejectsDescendantMove(create());
  });

  it("rejects command-level cp and mv before creating a destination", async () => {
    const bash = new Bash({ files: { "/src/file": "original" } });
    const copy = await bash.exec("cp -r /src /src/child");
    expect(copy.stdout).toBe("");
    expect(copy.stderr).toBe(
      "cp: cannot copy '/src' into itself, '/src/child'\n",
    );
    expect(copy.exitCode).toBe(1);

    const move = await bash.exec("mv /src /src/child");
    expect(move.stdout).toBe("");
    expect(move.stderr).toBe(
      "mv: cannot move '/src' into itself, '/src/child'\n",
    );
    expect(move.exitCode).toBe(1);
    expect(await bash.fs.readFile("/src/file")).toBe("original");
    expect(await bash.fs.exists("/src/child")).toBe(false);
  });
});

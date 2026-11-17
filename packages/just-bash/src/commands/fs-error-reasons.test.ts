import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";
import type {
  BufferEncoding,
  FileContent,
  WriteFileOptions,
} from "../fs/interface.js";

const refuse = (code: string, path: string): Error =>
  Object.assign(new Error(`${code}: refused, open '${path}'`), { code });

/** /ro refuses every write (and rm) with EROFS; /locked refuses every read with EACCES. */
class Mounted extends InMemoryFs {
  override async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    if (path.startsWith("/ro/")) throw refuse("EROFS", path);
    return super.writeFile(path, content, options);
  }
  override async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    if (path.startsWith("/ro/")) throw refuse("EROFS", path);
    return super.rm(path, options);
  }
  override async readFile(
    path: string,
    options?: BufferEncoding | { encoding?: BufferEncoding | null },
  ): Promise<string> {
    if (path.startsWith("/locked/")) throw refuse("EACCES", path);
    return super.readFile(path, options);
  }
  override async readFileBuffer(path: string): Promise<Uint8Array> {
    if (path.startsWith("/locked/")) throw refuse("EACCES", path);
    return super.readFileBuffer(path);
  }
}

const bash = () =>
  new Bash({ fs: new Mounted({ "/ro/f.txt": "x\n", "/locked/s.txt": "s\n" }) });

describe("a command says why, not 'No such file or directory' for everything", () => {
  it("tee into a read-only file", async () => {
    const result = await bash().exec("tee /ro/f.txt <<< hi");
    expect(result.stdout).toBe("hi\n");
    expect(result.stderr).toBe("tee: /ro/f.txt: Read-only file system\n");
    expect(result.exitCode).toBe(1);
  });

  it("sed -i on a read-only file", async () => {
    const result = await bash().exec("sed -i 's/x/y/' /ro/f.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("sed: /ro/f.txt: Read-only file system\n");
    expect(result.exitCode).toBe(1);
  });

  it("sed on a file it may not read", async () => {
    const result = await bash().exec("sed p /locked/s.txt");
    expect(result.stderr).toBe("sed: /locked/s.txt: Permission denied\n");
    expect(result.exitCode).toBe(1);
  });

  it.each([
    "cat",
    "head",
    "tail",
    "wc",
    "nl",
    "sort",
  ])("%s on a file it may not read", async (command) => {
    const result = await bash().exec(`${command} /locked/s.txt`);
    expect(result.stderr).toBe(
      `${command}: /locked/s.txt: Permission denied\n`,
    );
    expect(result.exitCode).toBe(1);
  });

  it.each([
    "cat",
    "head",
    "nl",
    "sort",
  ])("%s on a missing file still says so", async (command) => {
    const result = await bash().exec(`${command} /nope.txt`);
    expect(result.stderr).toBe(
      `${command}: /nope.txt: No such file or directory\n`,
    );
    expect(result.exitCode).toBe(1);
  });

  it("cat on a directory says it is one", async () => {
    const result = await bash().exec("cat /ro");
    expect(result.stderr).toBe("cat: /ro: Is a directory\n");
  });

  it("rm -f ignores a missing file", async () => {
    const result = await bash().exec("rm -f /nope.txt; echo rc=$?");
    expect(result.stdout).toBe("rc=0\n");
    expect(result.stderr).toBe("");
  });

  it("rm -f does not ignore a refusal", async () => {
    const result = await bash().exec("rm -f /ro/f.txt; echo rc=$?");
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe(
      "rm: cannot remove '/ro/f.txt': Read-only file system\n",
    );
  });

  it("rm without -f says the same", async () => {
    const result = await bash().exec("rm /ro/f.txt");
    expect(result.stderr).toBe(
      "rm: cannot remove '/ro/f.txt': Read-only file system\n",
    );
    expect(result.exitCode).toBe(1);
  });
});

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";
import type {
  BufferEncoding,
  FileContent,
  WriteFileOptions,
} from "../fs/interface.js";
import { ReadWriteFs } from "../fs/read-write-fs/index.js";
import { SandboxBoundaryError } from "../fs/sandbox-boundary-error.js";
import { errnoReason } from "../interpreter/helpers/errors.js";

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

describe("rm -f, nl and the sandbox's own refusals", () => {
  const failing = (code: string, command: string) => {
    class F extends InMemoryFs {
      override async stat(path: string): ReturnType<InMemoryFs["stat"]> {
        if (path === "/x") {
          throw Object.assign(new Error(`${code}: boom`), { code });
        }
        return super.stat(path);
      }
    }
    return new Bash({ fs: new F({ "/f.txt": "a\n" }) }).exec(command);
  };

  it("rm -f ignores ENOTDIR like a missing file", async () => {
    const result = await failing("ENOTDIR", "rm -f /x; echo rc=$?");
    expect(result.stdout).toBe("rc=0\n");
    expect(result.stderr).toBe("");
  });

  it("rm -f reports an errno that is not 'missing'", async () => {
    const result = await failing("EACCES", "rm -f /x; echo rc=$?");
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe("rm: cannot remove '/x': Permission denied\n");
  });

  it("rm -f rethrows an error that is not in the errno map", async () => {
    // Rethrown out of the command, so rm reports it and fails: never rc=0.
    const result = await failing("EMFILE", "rm -f /x");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("EMFILE");
  });

  it("nl goes on to the later files after an input error, keeping the status", async () => {
    const result = await bash().exec("nl /locked/s.txt /ro/f.txt; echo rc=$?");
    expect(result.stdout).toBe("     1\tx\nrc=1\n");
    expect(result.stderr).toBe("nl: /locked/s.txt: Permission denied\n");
  });

  it("nl reports EFBIG", async () => {
    class Big extends InMemoryFs {
      override async readFile(): Promise<string> {
        throw Object.assign(new Error("EFBIG: file too large"), {
          code: "EFBIG",
        });
      }
    }
    const result = await new Bash({ fs: new Big({ "/f": "x" }) }).exec("nl /f");
    expect(result.stderr).toBe("nl: /f: File too large\n");
    expect(result.exitCode).toBe(1);
  });

  it("a sandbox boundary refusal has no errno and stays a hard failure", () => {
    const error = new SandboxBoundaryError(
      "EACCES: permission denied, '/x' resolves outside sandbox",
    );
    expect(errnoReason(error)).toBeUndefined();
    expect(errnoReason(new Error("EACCES: denied"))).toBe("Permission denied");
  });

  describe("on a ReadWriteFs whose root holds a symlink out of it", () => {
    const setup = () => {
      const base = mkdtempSync(join(tmpdir(), "jb-boundary-"));
      const root = join(base, "root");
      mkdirSync(root);
      writeFileSync(join(base, "secret.txt"), "secret\n");
      symlinkSync(join(base, "secret.txt"), join(root, "link"));
      return {
        base,
        bash: new Bash({ fs: new ReadWriteFs({ root }), cwd: "/" }),
      };
    };

    it("a redirect through it still rejects exec()", async () => {
      const { base, bash } = setup();
      try {
        await expect(bash.exec("echo x > /link")).rejects.toThrow("EACCES");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    });

    it("rm -f of it is reported, not silently ignored", async () => {
      const { base, bash } = setup();
      try {
        const result = await bash.exec("rm -f /link; echo rc=$?");
        expect(result.stdout).toBe("rc=1\n");
        expect(result.stderr).toContain("outside sandbox");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    });
  });
});

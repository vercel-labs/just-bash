import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";
import type {
  BufferEncoding,
  FileContent,
  WriteFileOptions,
} from "../fs/interface.js";

/** A filesystem whose /ro refuses with the given errno, on open or on content. */
function refusing(code: string, when: "open" | "content" = "open") {
  const fail = (path: string): Error =>
    Object.assign(new Error(`${code}: refused, open '${path}'`), { code });
  class Refusing extends InMemoryFs {
    override async writeFile(
      path: string,
      content: FileContent,
      options?: WriteFileOptions | BufferEncoding,
    ): Promise<void> {
      const empty =
        typeof content === "string" ? content === "" : content.length === 0;
      if (path.startsWith("/ro/") && (when === "open" || !empty)) {
        throw fail(path);
      }
      return super.writeFile(path, content, options);
    }
  }
  return new Bash({ fs: new Refusing({ "/ro/f.txt": "x\n" }) });
}

describe("a refused redirect fails the command, not exec()", () => {
  it("EROFS: the script goes on and $? is 1", async () => {
    const result = await refusing("EROFS").exec(
      'echo before; echo x > /ro/f.txt; echo "after rc=$?"',
    );
    expect(result.stdout).toBe("before\nafter rc=1\n");
    expect(result.stderr).toBe("bash: /ro/f.txt: Read-only file system\n");
    expect(result.exitCode).toBe(0);
  });

  it("is a failed command to ||", async () => {
    const result = await refusing("EROFS").exec(
      "echo x > /ro/f.txt || echo handled",
    );
    expect(result.stdout).toBe("handled\n");
    expect(result.stderr).toBe("bash: /ro/f.txt: Read-only file system\n");
    expect(result.exitCode).toBe(0);
  });

  it("runs every loop iteration, with one diagnostic each", async () => {
    const result = await refusing("EROFS").exec(
      'for i in 1 2; do echo $i > /ro/f.txt; echo "loop $i"; done; echo end',
    );
    expect(result.stdout).toBe("loop 1\nloop 2\nend\n");
    expect(result.stderr).toBe(
      "bash: /ro/f.txt: Read-only file system\n".repeat(2),
    );
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["EACCES", "Permission denied"],
    ["EPERM", "Operation not permitted"],
    ["EISDIR", "Is a directory"],
    ["ENAMETOOLONG", "File name too long"],
    ["EINVAL", "Invalid argument"],
    ["ENOSPC", "No space left on device"],
  ])("%s says %s", async (code, phrase) => {
    const result = await refusing(code).exec("echo x > /ro/f.txt; echo rc=$?");
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe(`bash: /ro/f.txt: ${phrase}\n`);
    expect(result.exitCode).toBe(0);
  });

  it.each([
    "echo x >| /ro/f.txt",
    "echo x 2> /ro/f.txt",
    "echo x &> /ro/f.txt",
    "echo x >& /ro/f.txt",
    "echo x 3> /ro/f.txt",
    "{ echo x; } > /ro/f.txt",
  ])("%s", async (command) => {
    const result = await refusing("EROFS").exec(`${command}; echo after rc=$?`);
    expect(result.stdout).toBe("after rc=1\n");
    expect(result.stderr).toBe("bash: /ro/f.txt: Read-only file system\n");
    expect(result.exitCode).toBe(0);
  });

  it("a file that takes the open and refuses the content fails the command", async () => {
    const result = await refusing("EROFS", "content").exec(
      'echo x > /ro/f.txt; echo "after rc=$?"',
    );
    expect(result.stdout).toBe("after rc=1\n");
    expect(result.stderr).toBe("bash: /ro/f.txt: Read-only file system\n");
    expect(result.exitCode).toBe(0);
  });

  it("an error that is not an errno still propagates", async () => {
    class Broken extends InMemoryFs {
      override async writeFile(): Promise<void> {
        throw new Error("the disk caught fire");
      }
    }
    await expect(
      new Bash({ fs: new Broken() }).exec("echo x > /f.txt"),
    ).rejects.toThrow("the disk caught fire");
  });

  it("reading a refused input names the reason", async () => {
    class NoRead extends InMemoryFs {
      override async readFileBuffer(): Promise<Uint8Array> {
        throw Object.assign(new Error("EACCES: denied"), { code: "EACCES" });
      }
    }
    const result = await new Bash({ fs: new NoRead({ "/f": "x" }) }).exec(
      "cat < /f; echo rc=$?",
    );
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe("bash: /f: Permission denied\n");
  });

  it("a content refusal follows fd 2: 2>/dev/null drops it", async () => {
    const result = await refusing("EROFS", "content").exec(
      'echo x > /ro/f.txt 2>/dev/null; echo "after rc=$?"',
    );
    expect(result.stdout).toBe("after rc=1\n");
    expect(result.stderr).toBe("");
  });

  it("a content refusal follows fd 2: 2> errors receives it", async () => {
    const bash = refusing("EROFS", "content");
    const result = await bash.exec(
      "echo x > /ro/f.txt 2> /errors; echo rc=$?; cat /errors",
    );
    expect(result.stdout).toBe(
      "rc=1\nbash: /ro/f.txt: Read-only file system\n",
    );
    expect(result.stderr).toBe("");
  });

  it("a content refusal is added to the command's own stderr in fd 2's file", async () => {
    const bash = refusing("EROFS", "content");
    const result = await bash.exec(
      "{ echo x; echo oops >&2; } > /ro/f.txt 2> /errors; cat /errors",
    );
    expect(result.stdout).toBe(
      "oops\nbash: /ro/f.txt: Read-only file system\n",
    );
    expect(result.stderr).toBe("");
  });

  it("with fd 2 on the refusing file the diagnostic reaches the caller's stderr", async () => {
    const result = await refusing("EROFS", "content").exec(
      "echo x > /ro/f.txt 2>&1",
    );
    expect(result.stderr).toBe("bash: /ro/f.txt: Read-only file system\n");
  });

  it("a late refusal names the path the script typed", async () => {
    const result = await refusing("EROFS", "content").exec(
      "cd /ro; echo x > f.txt; echo rc=$?",
    );
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe("bash: f.txt: Read-only file system\n");
  });

  it("EFBIG says File too large", async () => {
    const result = await refusing("EFBIG").exec("echo x > /ro/f.txt");
    expect(result.stderr).toBe("bash: /ro/f.txt: File too large\n");
  });

  it("an errno from exists()/stat() on the target reaches the mapping", async () => {
    class NoStat extends InMemoryFs {
      override async stat(path: string): ReturnType<InMemoryFs["stat"]> {
        if (path === "/ro/f.txt") {
          throw Object.assign(new Error("EACCES: denied"), { code: "EACCES" });
        }
        return super.stat(path);
      }
    }
    const result = await new Bash({
      fs: new NoStat({ "/ro/f.txt": "x\n" }),
    }).exec("echo y > /ro/f.txt; echo rc=$?");
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe("bash: /ro/f.txt: Permission denied\n");
  });
});

describe("<> opens for reading and writing without losing the file", () => {
  it("creates a file that is not there", async () => {
    const bash = new Bash({ fs: new InMemoryFs() });
    const result = await bash.exec("cat <> /new.txt; echo rc=$?; ls /new.txt");
    expect(result.stdout).toBe("rc=0\n/new.txt\n");
  });

  it("leaves an existing file's content alone", async () => {
    const bash = new Bash({ fs: new InMemoryFs({ "/f.txt": "keep\n" }) });
    const result = await bash.exec("cat <> /f.txt");
    expect(result.stdout).toBe("keep\n");
  });

  it("refuses an existing file that cannot be written", async () => {
    class ReadOnly extends InMemoryFs {
      override async appendFile(path: string): Promise<void> {
        throw Object.assign(new Error(`EROFS: read-only, '${path}'`), {
          code: "EROFS",
        });
      }
    }
    const result = await new Bash({
      fs: new ReadOnly({ "/ro/f.txt": "x\n" }),
    }).exec("cat <> /ro/f.txt; echo rc=$?");
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe("bash: /ro/f.txt: Read-only file system\n");
  });

  it("a read that fails with EACCES never truncates the file", async () => {
    const writes: string[] = [];
    class Spy extends InMemoryFs {
      override async readFile(): Promise<string> {
        throw Object.assign(new Error("EACCES: denied"), { code: "EACCES" });
      }
      override async writeFile(
        path: string,
        content: FileContent,
        options?: WriteFileOptions | BufferEncoding,
      ): Promise<void> {
        writes.push(path);
        return super.writeFile(path, content, options);
      }
    }
    const fs = new Spy({ "/f.txt": "keep\n" });
    writes.length = 0;
    const result = await new Bash({ fs }).exec("cat <> /f.txt; echo rc=$?");
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe("bash: /f.txt: Permission denied\n");
    expect(writes).toEqual([]);
    expect(await fs.readFileBuffer("/f.txt")).toEqual(
      new TextEncoder().encode("keep\n"),
    );
  });
});

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
});

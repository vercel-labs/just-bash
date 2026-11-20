import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";
import type {
  BufferEncoding,
  FileContent,
  WriteFileOptions,
} from "../fs/interface.js";

class NoParentCreationFs extends InMemoryFs {
  override async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    await this.requireParentDirectory(path);
    return super.writeFile(path, content, options);
  }

  override async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    await this.requireParentDirectory(path);
    return super.appendFile(path, content, options);
  }

  private async requireParentDirectory(path: string): Promise<void> {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    if (!(await this.exists(parent))) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    if (!(await this.stat(parent)).isDirectory) {
      throw new Error(`ENOTDIR: not a directory, open '${path}'`);
    }
  }
}

class CodeOnlyErrorFs extends InMemoryFs {
  constructor(private readonly code = "ENOENT") {
    super();
  }

  override async writeFile(): Promise<void> {
    throw Object.assign(new Error("no such file or directory"), {
      code: this.code,
    });
  }
}

const bashWithoutParentCreation = () =>
  new Bash({ fs: new NoParentCreationFs({ "/file": "" }) });

describe("redirection open errors", () => {
  it("keeps running when the content write exceeds filesystem capacity", async () => {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 1_024 });
    const bash = new Bash({ fs });
    for (const redirect of [">", ">>"]) {
      expect(
        await bash.exec(`printf '%2000s' x ${redirect} /out || echo handled`),
      ).toMatchObject({
        stdout: "handled\n",
        stderr: "bash: /out: No space left on device\n",
        exitCode: 0,
      });
      expect(await fs.readFile("/out")).toBe("");
    }
  });

  it.each([
    ["EROFS", "Read-only file system"],
    ["EACCES", "Permission denied"],
    ["EFBIG", "File too large"],
  ])("fails only the command for %s", async (code, reason) => {
    const bash = new Bash({ fs: new CodeOnlyErrorFs(code) });
    const result = await bash.exec(
      'echo before; echo x > /ro/f; echo "after rc=$?"; ' +
        "echo x > /ro/f || echo handled; " +
        'for i in 1 2; do echo $i > /ro/f; echo "loop $i"; done; echo end',
    );
    expect(result.stdout).toBe(
      "before\nafter rc=1\nhandled\nloop 1\nloop 2\nend\n",
    );
    expect(result.stderr).toBe(`bash: /ro/f: ${reason}\n`.repeat(4));
    expect(result.exitCode).toBe(0);
  });

  it.each([
    "echo x > /missing/f",
    "echo x >| /missing/f",
    "echo x >> /missing/f",
    "echo x 2> /missing/f",
    "echo x &> /missing/f",
    "echo x &>> /missing/f",
    "echo x >& /missing/f",
    "echo x 3> /missing/f",
    "exec > /missing/f",
    "exec {fd}> /missing/f",
    "{ echo x; } > /missing/f",
  ])("fails only the command for %s", async (command) => {
    const result = await bashWithoutParentCreation().exec(
      `${command}; echo after rc=$?`,
    );
    expect(result.stdout).toBe("after rc=1\n");
    expect(result.stderr).toBe("bash: /missing/f: No such file or directory\n");
    expect(result.exitCode).toBe(0);
  });

  it("reports a non-directory parent", async () => {
    const result = await bashWithoutParentCreation().exec(
      "echo x > /file/f; echo after rc=$?",
    );
    expect(result.stdout).toBe("after rc=1\n");
    expect(result.stderr).toBe("bash: /file/f: Not a directory\n");
    expect(result.exitCode).toBe(0);
  });

  it("reads the errno from an error's code", async () => {
    const result = await new Bash({ fs: new CodeOnlyErrorFs() }).exec(
      "echo x > /missing/f; echo after rc=$?",
    );
    expect(result.stdout).toBe("after rc=1\n");
    expect(result.stderr).toBe("bash: /missing/f: No such file or directory\n");
    expect(result.exitCode).toBe(0);
  });

  it("keeps running every loop iteration", async () => {
    const result = await bashWithoutParentCreation().exec(
      "for c in a b; do echo $c > /missing/f; echo iter $c; done; echo after rc=$?",
    );
    expect(result.stdout).toBe("iter a\niter b\nafter rc=0\n");
    expect(result.stderr).toBe(
      "bash: /missing/f: No such file or directory\n".repeat(2),
    );
    expect(result.exitCode).toBe(0);
  });
});

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
  override async writeFile(): Promise<void> {
    throw Object.assign(new Error("no such file or directory"), {
      code: "ENOENT",
    });
  }
}

class InputReadErrorFs extends InMemoryFs {
  failRead = true;

  override async readFile(path: string): Promise<string> {
    if (path === "/data" && this.failRead) {
      throw new Error("EIO: input/output error, open '/data'");
    }
    return super.readFile(path);
  }
}

const bashWithoutParentCreation = () =>
  new Bash({ fs: new NoParentCreationFs({ "/file": "" }) });

describe("redirection open errors", () => {
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

  it("does not create or truncate a read-write target after a non-ENOENT read error", async () => {
    const fs = new InputReadErrorFs({ "/data": "original" });
    const bash = new Bash({ fs });
    const result = await bash.exec("cat <> /data");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: /data: cannot open redirect target\n",
      exitCode: 1,
    });
    fs.failRead = false;
    expect(await fs.readFile("/data")).toBe("original");
  });

  it("creates a read-write target when the read error has an ENOENT code", async () => {
    class MissingInputFs extends InMemoryFs {
      override async readFile(path: string): Promise<string> {
        if (path === "/new") {
          throw Object.assign(new Error("missing file"), { code: "ENOENT" });
        }
        return super.readFile(path);
      }
    }

    const fs = new MissingInputFs();
    const result = await new Bash({ fs }).exec("cat <> /new");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.exists("/new")).toBe(true);
  });

  it("does not truncate a read-write target when its stat fails", async () => {
    class FailingStatFs extends InMemoryFs {
      override async stat(path: string) {
        if (path === "/data") {
          throw new Error("EIO: input/output error, stat '/data'");
        }
        return super.stat(path);
      }
    }

    const fs = new FailingStatFs({ "/data": "original" });
    const result = await new Bash({ fs }).exec("cat <> /data");

    expect(result).toMatchObject({
      stdout: "original",
      stderr: "",
      exitCode: 0,
    });
    expect(await fs.readFile("/data")).toBe("original");
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

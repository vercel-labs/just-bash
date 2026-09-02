import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { getEncoding, toBuffer } from "../fs/encoding.js";
import { InMemoryFs } from "../fs/in-memory-fs/in-memory-fs.js";
import type {
  BufferEncoding,
  FileContent,
  OpenWritableOptions,
  WritableFile,
  WriteFileOptions,
} from "../fs/interface.js";

function text(content: FileContent): string {
  return typeof content === "string"
    ? content
    : new TextDecoder().decode(content);
}

class RecordingWritableFs extends InMemoryFs {
  readonly events: string[] = [];
  readonly commits: string[] = [];

  override async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    this.events.push(`legacy-write:${path}:${text(content)}`);
    await super.writeFile(path, content, options);
  }

  override async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    this.events.push(`legacy-append:${path}:${text(content)}`);
    await super.appendFile(path, content, options);
  }

  async openWritable(
    path: string,
    options: OpenWritableOptions,
  ): Promise<WritableFile> {
    this.events.push(`open:${options.mode}:${path}`);
    if (path === "/denied") throw new Error("denied");
    if (options.mode === "truncate") {
      await super.writeFile(path, "", "binary");
    } else {
      await super.appendFile(path, "", "binary");
    }

    let closed = false;
    let position = 0;
    return {
      write: async (content, writeOptions) => {
        if (closed) throw new Error("write after close");
        this.events.push(`handle-write:${path}:${text(content)}`);
        if (options.mode === "append") {
          await super.appendFile(path, content, writeOptions);
          return;
        }
        const existing = await super.readFileBuffer(path);
        const added = toBuffer(content, getEncoding(writeOptions));
        const updated = new Uint8Array(
          Math.max(existing.length, position + added.length),
        );
        updated.set(existing);
        updated.set(added, position);
        position += added.length;
        await super.writeFile(path, updated, "binary");
      },
      close: async () => {
        if (closed) throw new Error("double close");
        closed = true;
        this.commits.push(`${path}:${await super.readFile(path)}`);
        this.events.push(`close:${path}`);
      },
    };
  }
}

class FailingCloseFs extends RecordingWritableFs {
  override async openWritable(
    path: string,
    options: OpenWritableOptions,
  ): Promise<WritableFile> {
    const writable = await super.openWritable(path, options);
    return {
      write: writable.write,
      close: async () => {
        await writable.close();
        throw new Error("durable commit failed");
      },
    };
  }
}

class AbortingOpenFs extends RecordingWritableFs {
  constructor(private readonly controller: AbortController) {
    super();
  }

  override async openWritable(
    path: string,
    options: OpenWritableOptions,
  ): Promise<WritableFile> {
    const writable = await super.openWritable(path, options);
    this.controller.abort();
    return writable;
  }
}

describe("optional writable file descriptions", () => {
  it("opens, writes, and closes a redirected output through one description", async () => {
    const fs = new RecordingWritableFs();
    const bash = new Bash({ fs });

    const result = await bash.exec("printf hello > /out");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/out")).toBe("hello");
    expect(fs.events).toEqual([
      "open:truncate:/out",
      "handle-write:/out:hello",
      "close:/out",
    ]);
    expect(fs.commits).toEqual(["/out:hello"]);
  });

  it("closes an output opened by a command that produces no output", async () => {
    const fs = new RecordingWritableFs({ "/out": "previous" });
    const bash = new Bash({ fs });

    const result = await bash.exec("false > /out");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 1 });
    expect(await fs.readFile("/out")).toBe("");
    expect(fs.events).toEqual(["open:truncate:/out", "close:/out"]);
    expect(fs.commits).toEqual(["/out:"]);
  });

  it("uses append mode without truncating existing content", async () => {
    const fs = new RecordingWritableFs({ "/out": "before" });
    const bash = new Bash({ fs });

    const result = await bash.exec("printf after >> /out");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/out")).toBe("beforeafter");
    expect(fs.events).toEqual([
      "open:append:/out",
      "handle-write:/out:after",
      "close:/out",
    ]);
  });

  it("opens multiple redirects in source order and writes only to the final one", async () => {
    const fs = new RecordingWritableFs();
    const bash = new Bash({ fs });

    const result = await bash.exec("printf hello > /first > /second");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/first")).toBe("");
    expect(await fs.readFile("/second")).toBe("hello");
    expect(fs.events).toEqual([
      "open:truncate:/first",
      "open:truncate:/second",
      "handle-write:/second:hello",
      "close:/second",
      "close:/first",
    ]);
    expect(fs.commits).toEqual(["/second:hello", "/first:"]);
  });

  it("preserves independent positions for separate opens of one path", async () => {
    const fs = new RecordingWritableFs();
    const bash = new Bash({ fs });

    const result = await bash.exec(
      "{ printf abc; printf Z >&2; } > /out 2> /out",
    );

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/out")).toBe("Zbc");
    expect(fs.events).toEqual([
      "open:truncate:/out",
      "open:truncate:/out",
      "handle-write:/out:abc",
      "handle-write:/out:Z",
      "close:/out",
      "close:/out",
    ]);
  });

  it("closes earlier successful opens when a later redirect fails", async () => {
    const fs = new RecordingWritableFs({ "/first": "previous" });
    const bash = new Bash({ fs });

    await expect(
      bash.exec("printf ignored > /first > /denied"),
    ).rejects.toThrow("denied");
    expect(await fs.readFile("/first")).toBe("");
    expect(fs.events).toEqual([
      "open:truncate:/first",
      "open:truncate:/denied",
      "close:/first",
    ]);
  });

  it("keeps a persistent descriptor open until the descriptor is closed", async () => {
    const fs = new RecordingWritableFs();
    const bash = new Bash({ fs });

    const result = await bash.exec(
      "exec 3> /out; printf one >&3; printf two >&3; exec 3>&-",
    );

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/out")).toBe("onetwo");
    expect(fs.events).toEqual([
      "open:truncate:/out",
      "handle-write:/out:one",
      "handle-write:/out:two",
      "close:/out",
    ]);
  });

  it("closes persistent descriptors during execution cleanup", async () => {
    const fs = new RecordingWritableFs();
    const bash = new Bash({ fs });

    const result = await bash.exec("exec 3> /out; printf value >&3");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/out")).toBe("value");
    expect(fs.events).toEqual([
      "open:truncate:/out",
      "handle-write:/out:value",
      "close:/out",
    ]);
  });

  it("does not close a parent description when a subshell closes its copy", async () => {
    const fs = new RecordingWritableFs();
    const bash = new Bash({ fs });

    const result = await bash.exec(
      "exec 3> /out; (exec 3>&-); printf value >&3; exec 3>&-",
    );

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/out")).toBe("value");
    expect(fs.events).toEqual([
      "open:truncate:/out",
      "handle-write:/out:value",
      "close:/out",
    ]);
  });

  it("closes child-only persistent descriptions when isolated state is restored", async () => {
    const fs = new RecordingWritableFs();
    const bash = new Bash({ fs });

    const result = await bash.exec(
      "(exec 3> /out; printf value >&3); printf after",
    );

    expect(result).toMatchObject({ stdout: "after", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/out")).toBe("value");
    expect(fs.events).toEqual([
      "open:truncate:/out",
      "handle-write:/out:value",
      "close:/out",
    ]);
  });

  it("restores a persistent writer after a command-scoped descriptor override", async () => {
    const fs = new RecordingWritableFs();
    const bash = new Bash({ fs });

    const result = await bash.exec(
      [
        "exec 3> /persistent",
        "printf temporary 3> /temporary >&3",
        "printf persistent >&3",
        "exec 3>&-",
      ].join("; "),
    );

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/temporary")).toBe("temporary");
    expect(await fs.readFile("/persistent")).toBe("persistent");
    expect(fs.events).toEqual([
      "open:truncate:/persistent",
      "open:truncate:/temporary",
      "handle-write:/temporary:temporary",
      "close:/temporary",
      "handle-write:/persistent:persistent",
      "close:/persistent",
    ]);
  });

  it("keeps a duplicated descriptor open until its final alias closes", async () => {
    const fs = new RecordingWritableFs();
    const bash = new Bash({ fs });

    const result = await bash.exec(
      "exec 3> /out; exec 4>&3; exec 3>&-; printf value >&4; exec 4>&-",
    );

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/out")).toBe("value");
    expect(fs.events).toEqual([
      "open:truncate:/out",
      "handle-write:/out:value",
      "close:/out",
    ]);
  });

  it("keeps a named descriptor open beyond its creating command", async () => {
    const fs = new RecordingWritableFs();
    const bash = new Bash({ fs });

    const result = await bash.exec(
      "true {output}>/out; printf value >&$output; exec {output}>&-",
    );

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/out")).toBe("value");
    expect(fs.events).toEqual([
      "open:truncate:/out",
      "handle-write:/out:value",
      "close:/out",
    ]);
  });

  it("reports close failures through execution cleanup", async () => {
    const fs = new FailingCloseFs();
    const bash = new Bash({ fs });

    const result = await bash.exec("printf value > /out");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: execution cleanup failed\n",
      exitCode: 126,
    });
    expect(fs.events).toEqual([
      "open:truncate:/out",
      "handle-write:/out:value",
      "close:/out",
    ]);
  });

  it("closes a writable acquired while execution is being cancelled", async () => {
    const controller = new AbortController();
    const fs = new AbortingOpenFs(controller);
    const bash = new Bash({ fs });

    const result = await bash.exec("printf value > /out", {
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: execution aborted\n",
      exitCode: 124,
    });
    expect(fs.events).toEqual(["open:truncate:/out", "close:/out"]);
  });

  it("keeps legacy path operations as the fallback", async () => {
    const fs = new InMemoryFs();
    const bash = new Bash({ fs });

    const result = await bash.exec("printf hello > /out");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/out")).toBe("hello");
  });
});

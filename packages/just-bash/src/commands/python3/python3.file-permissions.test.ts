import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

describe("python3 file permissions", () => {
  it("appends to a write-only file without replacing existing content", async () => {
    const env = new Bash({
      python: true,
      files: { "/data": { content: "original", mode: 0o200 } },
    });

    const result = await env.exec(
      `python3 -c "f = open('/data', 'a'); f.write('X'); f.flush(); f.seek(0); f.write('Y'); f.close()"`,
    );

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    await env.fs.chmod("/data", 0o600);
    expect(await env.fs.readFile("/data")).toBe("originalXY");
  });

  it("appends a single write larger than the bridge payload", async () => {
    const size = 9 * 1024 * 1024;
    const env = new Bash({ python: true, files: { "/data": "start" } });
    const result = await env.exec(`python3 -c "
import os
fd = os.open('/host/data', os.O_WRONLY | os.O_APPEND)
print(os.write(fd, b'x' * ${size}))
os.close(fd)
"`);

    expect(result).toMatchObject({
      stdout: `${size}\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(await env.fs.readFile("/data")).toBe(`start${"x".repeat(size)}`);
  });

  it("reports bytes appended before a later bridge chunk fails", async () => {
    class FailingSecondAppendFs extends InMemoryFs {
      appendCount = 0;

      override async appendFile(...args: Parameters<InMemoryFs["appendFile"]>) {
        this.appendCount += 1;
        if (this.appendCount === 2) throw new Error("EIO: append failed");
        return super.appendFile(...args);
      }
    }
    const fs = new FailingSecondAppendFs({ "/data": "start" });
    const env = new Bash({ python: true, fs });
    const result = await env.exec(`python3 -c "
import os
fd = os.open('/host/data', os.O_WRONLY | os.O_APPEND)
print(os.write(fd, b'x' * (9 * 1024 * 1024)))
os.close(fd)
"`);

    expect(result).toMatchObject({
      stdout: `${8 * 1024 * 1024}\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(await fs.readFile("/data")).toBe(
      `start${"x".repeat(8 * 1024 * 1024)}`,
    );
  });

  it("opens and truncates a write-only file without reading it", async () => {
    const env = new Bash({
      python: true,
      files: { "/data": { content: "original", mode: 0o200 } },
    });

    const result = await env.exec(`python3 -c "
import os
os.close(os.open('/host/data', os.O_WRONLY))
with open('/data', 'w') as file:
    file.write('replacement')
"`);

    expect(result).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect((await env.fs.stat("/data")).mode).toBe(0o200);
    await env.fs.chmod("/data", 0o600);
    expect(await env.fs.readFile("/data")).toBe("replacement");
  });

  it("does not truncate a read-only file", async () => {
    const env = new Bash({
      python: true,
      files: { "/data": { content: "original", mode: 0o400 } },
    });

    const result = await env.exec(`python3 -c "
try:
    open('/data', 'w')
except PermissionError:
    print('denied')
"`);

    expect(result).toMatchObject({
      stdout: "denied\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await env.fs.readFile("/data")).toBe("original");
  });

  it("uses the backend's permission decision for append", async () => {
    class DenyingAppendFs extends InMemoryFs {
      override async appendFile(): Promise<void> {
        throw new Error("EACCES: permission denied, open '/data'");
      }
    }
    const deniedFs = new DenyingAppendFs({ "/data": "original" });
    const env = new Bash({ python: true, fs: deniedFs });
    const result = await env.exec(`python3 -c "
try:
    with open('/data', 'a') as f:
        f.write('X')
except PermissionError:
    print('denied')
"`);

    expect(result).toMatchObject({
      stdout: "denied\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await deniedFs.readFile("/data")).toBe("original");
  });

  it("does not truncate a writable file opened without O_TRUNC", async () => {
    const env = new Bash({
      python: true,
      files: { "/data": "original" },
    });
    const result = await env.exec(`python3 -c "
import os
fd = os.open('/host/data', os.O_WRONLY)
os.write(fd, b'X')
os.close(fd)
"`);

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await env.fs.readFile("/data")).toBe("Xriginal");
  });

  it.each([
    0o200, 0o240,
  ])("preserves mode %s content when read-write truncation is denied", async (mode) => {
    const env = new Bash({
      python: true,
      files: { "/data": { content: "original", mode } },
    });
    const result = await env.exec(`python3 -c "
try:
    open('/data', 'w+')
except PermissionError:
    print('denied')
"`);

    expect(result).toMatchObject({
      stdout: "denied\n",
      stderr: "",
      exitCode: 0,
    });
    await env.fs.chmod("/data", 0o600);
    expect(await env.fs.readFile("/data")).toBe("original");
  });

  it("does not overwrite a file when an append-read open encounters an I/O error", async () => {
    class FailingReadFs extends InMemoryFs {
      failRead = true;

      override async readFileBuffer(path: string): Promise<Uint8Array> {
        if (path === "/data" && this.failRead) {
          throw new Error("EIO: input/output error, open '/data'");
        }
        return super.readFileBuffer(path);
      }
    }

    const fs = new FailingReadFs({ "/data": "original" });
    const env = new Bash({ python: true, fs });
    const result = await env.exec(`python3 -c "
try:
    open('/data', 'a+').write('new')
except OSError as e:
    print(e.errno)
"`);

    expect(result).toMatchObject({ stdout: "29\n", stderr: "", exitCode: 0 });
    fs.failRead = false;
    expect(await fs.readFile("/data")).toBe("original");
  });

  it.each([
    "write",
    "pwrite",
  ])("limits %s on an append stream", async (operation) => {
    const env = new Bash({
      python: true,
      files: { "/data": "a".repeat(1023) },
      executionLimits: { maxStringLength: 1024 },
    });

    const result = await env.exec(`python3 -c "
import os
fd = os.open('/host/data', os.O_WRONLY | os.O_APPEND)
try:
    os.${operation}(fd, b'xy'${operation === "pwrite" ? ", 0" : ""})
except OSError as e:
    print(e.errno)
os.close(fd)
"`);

    expect(result).toMatchObject({
      stdout: "29\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await env.fs.readFile("/data")).toBe("a".repeat(1023));
  });
});

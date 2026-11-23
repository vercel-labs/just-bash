import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("python3 growing file buffers", () => {
  it.each([
    0, 8192,
  ])("preserves repeated binary writes with buffering=%i", async (buffering) => {
    const env = new Bash({ python: true });
    const result = await env.exec(`python3 - <<'PY'
chunk = bytes(range(256)) * 4 + b'!'
with open('/tmp/growing.bin', 'wb', buffering=${buffering}) as file:
    for _ in range(257):
        file.write(chunk)
with open('/tmp/growing.bin', 'rb') as file:
    actual = file.read()
print(len(actual), actual == chunk * 257)
PY`);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("263425 True\n");
    const chunk = Uint8Array.from({ length: 1025 }, (_, i) =>
      i === 1024 ? 33 : i % 256,
    );
    const expected = new Uint8Array(chunk.length * 257);
    for (let i = 0; i < 257; i++) expected.set(chunk, i * chunk.length);
    expect(await env.fs.readFileBuffer("/tmp/growing.bin")).toEqual(expected);
  });

  it("uses logical EOF for reads, readinto, seeks, and overwrites", async () => {
    const env = new Bash({ python: true });
    const result = await env.exec(`python3 - <<'PY'
with open('/tmp/seek.bin', 'w+b', buffering=0) as file:
    file.write(b'abc')
    file.write(b'de')
    print(file.seek(0, 2))
    print(repr(file.read()))
    file.seek(-2, 2)
    print(repr(file.read()))
    file.seek(1)
    file.write(b'XY')
    print(file.seek(0, 2))
    file.seek(3)
    target = bytearray(b'????')
    print(file.readinto(target), repr(target))
    file.seek(0)
    print(repr(file.read()))
PY`);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "5\nb''\nb'de'\n5\n2 bytearray(b'de??')\nb'aXYde'\n",
    );
    expect(await env.fs.readFile("/tmp/seek.bin")).toBe("aXYde");
  });

  it("appends at logical EOF after seeks and when reopening", async () => {
    const env = new Bash({
      python: true,
      files: { "/tmp/append.bin": "abc" },
    });
    const result = await env.exec(`python3 - <<'PY'
with open('/tmp/append.bin', 'a+b', buffering=0) as file:
    print(file.tell())
    file.seek(0)
    file.write(b'd')
    file.seek(0)
    file.write(b'e')
    print(file.seek(0, 2))
    file.seek(0)
    print(repr(file.read()))
with open('/tmp/append.bin', 'ab', buffering=0) as file:
    print(file.tell())
    file.write(b'f')
PY`);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("3\n5\nb'abcde'\n5\n");
    expect(await env.fs.readFile("/tmp/append.bin")).toBe("abcdef");
  });

  it("zero-fills holes within spare capacity and across a growth boundary", async () => {
    const env = new Bash({ python: true });
    const result = await env.exec(`python3 - <<'PY'
with open('/tmp/sparse.bin', 'w+b', buffering=0) as file:
    file.write(b'abc')
    file.write(b'd')
    file.seek(5)
    file.write(b'X')
    file.seek(10)
    file.write(b'Y')
    file.seek(0)
    print(file.read().hex())
PY`);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("6162636400580000000059\n");
    expect(await env.fs.readFileBuffer("/tmp/sparse.bin")).toEqual(
      Uint8Array.from([97, 98, 99, 100, 0, 88, 0, 0, 0, 0, 89]),
    );
  });

  it("does not extend a file on seek or an empty write", async () => {
    const env = new Bash({ python: true });
    const result = await env.exec(`python3 - <<'PY'
with open('/tmp/empty-write.bin', 'w+b', buffering=0) as file:
    file.write(b'abc')
    file.write(b'de')
    file.seek(100)
    print(file.write(b''))
    print(file.seek(0, 2))
PY`);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0\n5\n");
    expect(await env.fs.readFile("/tmp/empty-write.bin")).toBe("abcde");
  });

  it("discards previous contents on a truncating open", async () => {
    const env = new Bash({ python: true });
    const result = await env.exec(`python3 - <<'PY'
with open('/tmp/truncate.bin', 'wb', buffering=0) as file:
    file.write(b'abc')
    file.write(b'de')
with open('/tmp/truncate.bin', 'wb', buffering=0) as file:
    file.write(b'X')
with open('/tmp/empty.bin', 'wb', buffering=0) as file:
    pass
PY`);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(await env.fs.readFile("/tmp/truncate.bin")).toBe("X");
    expect(await env.fs.readFileBuffer("/tmp/empty.bin")).toEqual(
      new Uint8Array(0),
    );
  });

  it("grows to an odd file-size limit without exposing capacity", async () => {
    const env = new Bash({
      python: true,
      executionLimits: { maxStringLength: 1025 },
    });
    const result = await env.exec(`python3 - <<'PY'
with open('/tmp/limit.bin', 'wb', buffering=0) as file:
    for _ in range(1025):
        file.write(b'x')
print('ok')
PY`);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok\n");
    expect(await env.fs.readFile("/tmp/limit.bin")).toBe("x".repeat(1025));
  });

  it("flushes an 8 MiB file even when its capacity exceeds the bridge limit", async () => {
    const env = new Bash({ python: true });
    const result = await env.exec(`python3 - <<'PY'
size = 8 * 1024 * 1024
chunk = b'x' * 65537
with open('/tmp/bridge-limit.bin', 'wb', buffering=0) as file:
    for _ in range(size // len(chunk)):
        file.write(chunk)
    file.write(b'x' * (size % len(chunk)))
with open('/tmp/bridge-limit.bin', 'rb') as file:
    print(file.read() == b'x' * size)
PY`);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("True\n");
    const bytes = await env.fs.readFileBuffer("/tmp/bridge-limit.bin");
    expect(bytes.length).toBe(8 * 1024 * 1024);
    expect(bytes.every((byte) => byte === 120)).toBe(true);
  });
});

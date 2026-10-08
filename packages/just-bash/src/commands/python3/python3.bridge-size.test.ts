import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const MIB = 1024 * 1024;

describe("python3 configurable bridge capacity", () => {
  it("round-trips a file larger than 8 MiB with an explicit larger limit", async () => {
    const bash = new Bash({
      python: true,
      executionLimits: { maxPythonBridgeBytes: 10 * MIB },
    });
    const result = await bash.exec(`python3 - <<'PY'
data = b"x" * (9 * 1024 * 1024)
with open("/tmp/large.bin", "wb") as file:
    file.write(data)
with open("/tmp/large.bin", "rb") as file:
    actual = file.read()
print(len(actual), actual == data)
PY`);
    expect(result).toMatchObject({
      stdout: "9437184 True\n",
      stderr: "",
      exitCode: 0,
    });
    expect((await bash.fs.stat("/tmp/large.bin")).size).toBe(9 * MIB);
  });

  it("keeps the default at 8 MiB and rejects a larger write", async () => {
    const bash = new Bash({ python: true });
    const result = await bash.exec(`python3 - <<'PY'
import errno
try:
    with open("/tmp/large.bin", "wb") as file:
        file.write(b"x" * (8 * 1024 * 1024 + 1))
except OSError as error:
    print("rejected", error.errno == errno.EFBIG)
PY`);
    expect(result).toMatchObject({
      stdout: "rejected True\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("accepts the exact configured byte count and rejects one byte more", async () => {
    const bash = new Bash({
      python: true,
      executionLimits: { maxPythonBridgeBytes: 1025 },
    });
    const result = await bash.exec(`python3 - <<'PY'
import errno
with open("/tmp/exact.bin", "wb") as file:
    file.write(b"x" * 1025)
with open("/tmp/exact.bin", "rb") as file:
    print(len(file.read()))
try:
    with open("/tmp/exact.bin", "ab") as file:
        file.write(b"y")
except OSError as error:
    print("rejected", error.errno == errno.EFBIG)
PY`);
    expect(result).toMatchObject({
      stdout: "1025\nrejected True\n",
      stderr: "",
      exitCode: 0,
    });
    expect((await bash.fs.stat("/tmp/exact.bin")).size).toBe(1025);
  });

  it("still respects a smaller maxStringLength file limit", async () => {
    const bash = new Bash({
      python: true,
      executionLimits: { maxPythonBridgeBytes: 4096, maxStringLength: 1024 },
    });
    const result = await bash.exec(`python3 - <<'PY'
import errno
try:
    with open("/tmp/limited.bin", "wb") as file:
        file.write(b"x" * 1025)
except OSError as error:
    print("rejected", error.errno == errno.EFBIG)
PY`);
    expect(result).toMatchObject({
      stdout: "rejected True\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

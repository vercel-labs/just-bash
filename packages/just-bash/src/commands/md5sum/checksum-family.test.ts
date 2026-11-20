// Automa modifications: N5b binary digest, shared accounting and cancellation.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";

const algorithms = [
  ["md5sum", "md5"],
  ["sha1sum", "sha1"],
  ["sha224sum", "sha224"],
  ["sha256sum", "sha256"],
  ["sha384sum", "sha384"],
  ["sha512sum", "sha512"],
  ["b2sum", "blake2b512"],
] as const;
describe("N5b bounded hash family", () => {
  it.each(
    algorithms,
  )("%s hashes exact binary bytes and verifies non-ASCII names", async (command, algorithm) => {
    const bytes = Uint8Array.from(
      { length: 131077 },
      (_, index) => index % 256,
    );
    const hash = createHash(algorithm).update(bytes).digest("hex");
    const bash = new Bash({ cwd: "/", files: { "/数据": bytes } });
    expect(await bash.exec(`${command} 数据`)).toMatchObject({
      stdout: `${hash}  数据\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(
      await bash.exec(`${command} 数据 > sums; ${command} -c sums`),
    ).toMatchObject({ stdout: "数据: OK\n", stderr: "", exitCode: 0 });
  });

  it.each(
    algorithms,
  )("%s has prospective input reservations and cumulative limits", async (command) => {
    const fs = new InMemoryFs({ "/f": "abcdef" });
    const read = vi.spyOn(fs, "readFileBuffer");
    const limited = new Bash({
      fs,
      cwd: "/",
      executionLimits: { maxInputBytes: 5 },
    });
    const first = await limited.exec(`${command} f; true`);
    expect(first.executionFailure?.kind).toBe("resource-limit");
    expect(read).not.toHaveBeenCalled();
    const memory = new Bash({
      fs,
      cwd: "/",
      executionLimits: { maxLiveBytes: 128 },
    });
    expect(
      (await memory.exec(`${command} f; true`)).executionFailure?.kind,
    ).toBe("resource-limit");
    expect(read).not.toHaveBeenCalled();
    const cumulative = new Bash({
      fs,
      cwd: "/",
      executionLimits: { maxInputBytes: 10 },
    });
    const second = await cumulative.exec(`${command} f f; true`);
    expect(second.executionFailure?.kind).toBe("resource-limit");
    expect(read).toHaveBeenCalledTimes(1);
    const output = new Bash({
      fs,
      cwd: "/",
      executionLimits: { maxOutputSize: 8 },
    });
    expect(
      (await output.exec(`${command} f; true`)).executionFailure?.kind,
    ).toBe("resource-limit");
    const work = new Bash({
      fs,
      cwd: "/",
      executionLimits: { maxWorkUnits: 1 },
    });
    expect((await work.exec(`${command} f; true`)).executionFailure?.kind).toBe(
      "resource-limit",
    );
  });

  it.each([
    "md5sum",
    "sha224sum",
    "b2sum",
  ])("%s yields during CPU hashing for cancellation", async (command) => {
    const bash = new Bash({ files: { "/f": new Uint8Array(8 * 1024 * 1024) } });
    await bash.exec(`${command} /dev/null`); // Load command before scheduling abort.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10);
    try {
      const result = await bash.exec(`${command} /f; echo must-not-run`, {
        signal: controller.signal,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("must-not-run");
    } finally {
      clearTimeout(timer);
    }
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { createCommandContext } from "../../custom-commands.js";
import { encodeUtf8ToBytes } from "../../encoding.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import { defineWasiCommand } from "../index.js";

const wasm = new Uint8Array(
  await readFile(new URL("./fixtures/command.wasm", import.meta.url)),
);

describe("WASI execution boundaries", () => {
  it("terminates a guest CPU loop and permits the next execution", async () => {
    const shell = new Bash({
      customCommands: [defineWasiCommand("native", { wasm, timeoutMs: 300 })],
    });
    const result = await shell.exec("native loop");
    expect(result).toMatchObject({
      stdout: "",
      stderr: "native: Execution timeout: exceeded 300ms limit\n",
      exitCode: 124,
    });
    expect(await shell.exec("echo alive")).toMatchObject({
      stdout: "alive\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("bounds memory growth even when the original binary declares no maximum", async () => {
    const shell = new Bash({
      customCommands: [
        defineWasiCommand("native", { wasm, maxMemoryBytes: 32 * 1024 * 1024 }),
      ],
    });
    expect(await shell.exec("native grow")).toMatchObject({
      stdout: "bounded\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("cannot read the host filesystem through a virtual absolute path", async () => {
    const shell = new Bash({
      customCommands: [defineWasiCommand("native", { wasm })],
    });
    expect(await shell.exec("native open /etc/passwd")).toMatchObject({
      stdout: "denied\n",
      stderr: "",
      exitCode: 1,
    });
  });

  it("enforces output limits before retaining a guest chunk", async () => {
    const command = defineWasiCommand("native", { wasm });
    const ctx = createCommandContext({
      fs: new InMemoryFs(),
      stdin: encodeUtf8ToBytes("x".repeat(1024)),
      executionLimits: { maxOutputSize: 256 },
    });
    expect(await command.execute(["cat"], ctx)).toMatchObject({
      stdout: "",
      stderr: "native: WASI output limit exceeded\n",
      exitCode: 126,
    });
  });

  it("leaves live-byte headroom for hardened file reads and output", async () => {
    const content = "x".repeat(128 * 1024);
    const shell = new Bash({
      executionLimitProfile: "hardened",
      files: { "/in": content },
      customCommands: [defineWasiCommand("native", { wasm })],
    });
    const result = await shell.exec("native cat /in");
    expect(result).toMatchObject({
      stdout: content,
      stderr: "",
      exitCode: 0,
    });
  });

  it("enforces virtual file size limits before allocating or writing", async () => {
    const fs = new InMemoryFs();
    const command = defineWasiCommand("native", { wasm, maxFileBytes: 4 });
    const result = await command.execute(
      ["write", "/out", "12345"],
      createCommandContext({ fs }),
    );
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 3 });
    expect(await fs.readFileBuffer("/out")).toEqual(new Uint8Array());
  });

  it("cancels a pending module loader without starting a late worker", async () => {
    let release: (bytes: Uint8Array) => void = () => {};
    let loaderSignal: AbortSignal | undefined;
    const loading = new Promise<Uint8Array>((resolve) => {
      release = resolve;
    });
    const command = defineWasiCommand("native", {
      wasm: (signal) => {
        loaderSignal = signal;
        return loading;
      },
    });
    const controller = new AbortController();
    const result = command.execute(
      ["write", "/out", "late"],
      createCommandContext({ fs: new InMemoryFs(), signal: controller.signal }),
    );
    controller.abort();
    expect(await result).toMatchObject({
      stdout: "",
      stderr: "native: Execution aborted\n",
      exitCode: 124,
    });
    expect(loaderSignal?.aborted).toBe(true);
    release(wasm);
    await loading;
  });

  it("revokes filesystem work waiting across cancellation", async () => {
    const fs = new InMemoryFs({ "/out": "before" });
    const original = fs.stat.bind(fs);
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fs.stat = async (path) => {
      if (path === "/out") {
        entered();
        await blocked;
      }
      return original(path);
    };
    const controller = new AbortController();
    const command = defineWasiCommand("native", { wasm });
    const execution = command.execute(
      ["append", "/out", "after"],
      createCommandContext({ fs, signal: controller.signal }),
    );
    await pending;
    controller.abort();
    expect(await execution).toMatchObject({
      stdout: "",
      stderr: "native: Execution aborted\n",
      exitCode: 124,
    });
    release();
    await blocked;
    expect(await fs.readFile("/out")).toBe("before");
  });

  it("validates option sizes and command names", () => {
    expect(() => defineWasiCommand("../native", { wasm })).toThrow(
      "Invalid WASI command name",
    );
    expect(() =>
      defineWasiCommand("native", { wasm, timeoutMs: Infinity }),
    ).toThrow(RangeError);
    expect(() =>
      defineWasiCommand("native", { wasm, maxMemoryBytes: 1 }),
    ).toThrow(RangeError);
  });

  it("rejects oversized modules before worker creation", async () => {
    const command = defineWasiCommand("native", { wasm, maxModuleBytes: 8 });
    expect(
      await command.execute([], createCommandContext({ fs: new InMemoryFs() })),
    ).toMatchObject({
      stdout: "",
      stderr: "native: WASM module exceeds configured byte limit\n",
      exitCode: 126,
    });
  });
});

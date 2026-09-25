import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import { defineWasiCommand } from "../index.js";

const wasm = new Uint8Array(
  await readFile(new URL("./fixtures/command.wasm", import.meta.url)),
);
function bash(options: ConstructorParameters<typeof Bash>[0] = {}): Bash {
  return new Bash({
    customCommands: [defineWasiCommand("native", { wasm })],
    ...options,
  });
}

describe("WASI commands", () => {
  it("passes quoted arguments without shell reparsing", async () => {
    const result = await bash().exec(
      "native args 'hello world' '$(echo unsafe)' café",
    );
    expect(result.stdout).toBe("[hello world]\n[$(echo unsafe)]\n[café]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("shares bytes with pipes and redirects", async () => {
    const result = await bash().exec(
      "printf 'hello café\\n' | native cat > /out; native cat /out | grep café",
    );
    expect(result).toMatchObject({
      stdout: "hello café\n",
      stderr: "",
      exitCode: 0,
    });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves binary stdout and decodes stderr", async () => {
    const shell = bash();
    const result = await shell.exec("native binary > /bytes");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("diagnostic café\n");
    expect(result.exitCode).toBe(0);
    expect(await shell.fs.readFileBuffer("/bytes")).toEqual(
      new Uint8Array([0, 255, 128, 195, 169, 10]),
    );
  });

  it("handles stdin larger than one bridge frame", async () => {
    const content = "abcé\n".repeat(14_000);
    const shell = bash({ files: { "/in": content } });
    const result = await shell.exec("cat /in | native cat > /out");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await shell.fs.readFile("/out")).toBe(content);
  }, 15_000);

  it("makes the shell cwd available through PWD while retaining absolute paths", async () => {
    const shell = bash({ files: { "/project/readme": "" }, cwd: "/project" });
    const result = await shell.exec(
      'native write "$PWD/result" hello; native append "$PWD/result" " world"; cat result',
    );
    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("supports seeking, stat, directory reads, rename, and deletion", async () => {
    const result = await bash({ cwd: "/" }).exec("native fs");
    expect(result.stdout).toBe("aZc\nsize=3\nfile=b\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("passes only exported environment and never the process environment", async () => {
    const result = await bash().exec(
      "HIDDEN=secret; export EXPORTED=visible; native env HIDDEN; native env EXPORTED; native env FNM_MULTISHELL_PATH",
    );
    expect(result.stdout).toBe("<unset>\nvisible\n<unset>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("returns command exit status and handles unknown flags in the guest", async () => {
    const shell = bash();
    expect((await shell.exec("native exit 42")).exitCode).toBe(42);
    const unknown = await shell.exec("native --unknown");
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toBe("unknown command\n");
    expect(unknown.exitCode).toBe(2);
  });

  it("uses arbitrary asynchronous filesystem implementations", async () => {
    const fs = new InMemoryFs({ "/hello": "from backend\n" });
    const original = fs.readFileBuffer.bind(fs);
    fs.readFileBuffer = async (path) => {
      await Promise.resolve();
      return original(path);
    };
    const result = await bash({ fs }).exec("native cat /hello");
    expect(result).toMatchObject({
      stdout: "from backend\n",
      stderr: "",
      exitCode: 0,
    });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

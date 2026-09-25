import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs.js";

describe("InMemoryFs content versions", () => {
  it("isolates stored bytes from write and read buffers", async () => {
    const fs = new InMemoryFs();
    const input = Uint8Array.of(65);
    fs.writeFileSync("/file", input);
    const initial = (await fs.stat("/file")).contentVersion;

    input[0] = 88;
    const read = await fs.readFileBuffer("/file");
    read[0] = 89;
    expect(await fs.readFile("/file")).toBe("A");
    expect((await fs.stat("/file")).contentVersion).toBe(initial);

    await fs.writeFile("/file", "B");
    expect((await fs.stat("/file")).contentVersion).not.toBe(initial);
  });

  it("isolates lazy provider buffers after materialization", async () => {
    const fs = new InMemoryFs();
    const supplied = Uint8Array.of(65);
    fs.writeFileLazy("/lazy", () => supplied);
    expect(await fs.readFile("/lazy")).toBe("A");
    const initial = (await fs.stat("/lazy")).contentVersion;

    supplied[0] = 88;
    expect(await fs.readFile("/lazy")).toBe("A");
    expect((await fs.stat("/lazy")).contentVersion).toBe(initial);
  });

  it("keeps hard-linked writes and versions coherent", async () => {
    const fs = new InMemoryFs();
    const input = Uint8Array.of(65);
    await fs.writeFile("/file", input);
    await fs.link("/file", "/alias");
    const initial = (await fs.stat("/file")).contentVersion;

    input[0] = 88;
    await fs.appendFile("/alias", "B");
    expect(await fs.readFile("/file")).toBe("AB");
    expect(await fs.readFile("/alias")).toBe("AB");
    const updated = (await fs.stat("/file")).contentVersion;
    expect(updated).not.toBe(initial);
    expect((await fs.stat("/alias")).contentVersion).toBe(updated);
  });
});

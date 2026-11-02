// Automa N2c: adapt the overwrite-mode preservation in upstream PR #578.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "./in-memory-fs.js";

describe("InMemoryFs preserves existing file modes", () => {
  it("rejects writes over a directory without replacing its children", async () => {
    const fs = new InMemoryFs({ "/d/f": "kept" });
    await expect(fs.writeFile("/d", "bad")).rejects.toThrow("EISDIR");
    expect(() => fs.writeFileLazy("/d", () => "bad")).toThrow("EISDIR");
    expect((await fs.stat("/d")).isDirectory).toBe(true);
    expect(await fs.readFile("/d/f")).toBe("kept");
  });
  it("keeps a restricted file mode through overwrite and truncate", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/f", "old");
    await fs.chmod("/f", 0o640);
    await fs.writeFile("/f", new Uint8Array([1, 2, 3]));
    expect((await fs.stat("/f")).mode).toBe(0o640);
    await fs.writeFile("/f", "");
    expect((await fs.stat("/f")).mode).toBe(0o640);
  });
  it("keeps lazy overwrite mode without materializing the old file", async () => {
    const fs = new InMemoryFs();
    fs.writeFileLazy(
      "/f",
      () => {
        throw new Error("must not read old contents");
      },
      { mode: 0o750 },
    );
    fs.writeFileLazy("/f", () => "new");
    expect((await fs.stat("/f")).mode).toBe(0o750);
    expect(await fs.readFile("/f")).toBe("new");
  });
  it("allows explicit mode metadata and defaults new files", async () => {
    const fs = new InMemoryFs();
    fs.writeFileSync("/f", "old", undefined, { mode: 0o750 });
    fs.writeFileSync("/f", "new", undefined, { mode: 0o600 });
    expect((await fs.stat("/f")).mode).toBe(0o600);
    await fs.rm("/f");
    await fs.writeFile("/f", "new");
    expect((await fs.stat("/f")).mode).toBe(0o644);
  });
  it("keeps an executable script executable after a redirection and sed -i", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "printf '#!/bin/bash\\necho old\\n' > script; chmod 755 script; printf '#!/bin/bash\\necho changed\\n' > script; sed -i s/changed/final/ script; ./script; stat -c %a script",
    );
    expect(result).toMatchObject({
      stdout: "final\n755\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

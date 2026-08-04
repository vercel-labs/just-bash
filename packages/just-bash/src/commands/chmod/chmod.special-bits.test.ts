import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("chmod symbolic replacement of special bits", () => {
  it.each([
    ["u=rw", 0o4755, 0o655],
    ["g=rx", 0o2755, 0o755],
    ["o=rx", 0o1755, 0o755],
  ] as const)("clears the class-associated bit for %s", async (mode, before, after) => {
    const bash = new Bash({ files: { "/file": "data" } });
    await bash.fs.chmod("/file", before);

    const result = await bash.exec(`chmod ${mode} /file`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect((await bash.fs.stat("/file")).mode & 0o7777).toBe(after);
  });
});

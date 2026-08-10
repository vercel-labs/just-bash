import { describe, expect, it } from "vitest";
import { Bash } from "../index.js";

describe("command filesystem traversal budgets", () => {
  it("preflights recursive cp before creating a partial destination", async () => {
    const bash = new Bash({
      files: { "/source/a": "a", "/source/b": "b" },
      executionLimits: { maxTraversalEntries: 2 },
    });

    const result = await bash.exec("cp -r /source /copy");

    expect(result.exitCode).toBe(126);
    expect(await bash.fs.exists("/copy")).toBe(false);
  });

  it("preflights recursive mv before removing the source", async () => {
    const bash = new Bash({
      files: { "/source/a": "a", "/source/b": "b" },
      executionLimits: { maxTraversalEntries: 2 },
    });

    const result = await bash.exec("mv /source /moved");

    expect(result.exitCode).toBe(126);
    expect(await bash.fs.exists("/source/a")).toBe(true);
    expect(await bash.fs.exists("/moved")).toBe(false);
  });

  // `ls` walks the tree only under -R; operands are resolved one stat at a
  // time, so the recursive descent is the path the budget has to bound.
  it("bounds find and recursive ls traversal independently of loop limits", async () => {
    const bash = new Bash({
      files: { "/root/a": "a", "/root/b": "b", "/root/c": "c" },
      executionLimits: { maxTraversalEntries: 2 },
    });

    await expect(bash.exec("find /root")).resolves.toMatchObject({
      exitCode: 126,
    });
    // ls charges the budget per directory it descends into, so the recursive
    // fixture needs nesting where find's flat one is enough.
    const second = new Bash({
      files: { "/root/a/1": "a", "/root/b/2": "b", "/root/c/3": "c" },
      executionLimits: { maxTraversalEntries: 2 },
    });
    await expect(second.exec("ls -R /root")).resolves.toMatchObject({
      exitCode: 126,
    });
  });
});

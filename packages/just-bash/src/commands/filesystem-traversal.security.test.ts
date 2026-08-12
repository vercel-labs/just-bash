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

  // Operands are visits too: a long list would otherwise stat every one of
  // them before the budget got a chance to refuse any of the work.
  it("bounds ls operand resolution, not just the walk below it", async () => {
    const bash = new Bash({
      files: { "/root/a": "a", "/root/b": "b", "/root/c": "c" },
      executionLimits: { maxTraversalEntries: 2 },
    });

    await expect(
      bash.exec("ls /root/a /root/b /root/c"),
    ).resolves.toMatchObject({ exitCode: 126 });
  });

  // An operand is resolved once and listed once. Charging both spends two
  // entries on one visit, so the limit bites at half the capacity it states.
  it("charges an ls operand once, not once per stage", async () => {
    const bash = new Bash({
      files: { "/root/a": "a", "/root/b": "b" },
      executionLimits: { maxTraversalEntries: 2 },
    });

    await expect(bash.exec("ls /root/a /root/b")).resolves.toMatchObject({
      exitCode: 0,
      stdout: "/root/a\n/root/b\n",
      stderr: "",
    });
  });

  // -d returns before the walk, which is exactly why it needs charging of its
  // own: without it an arbitrarily long operand list stats unmetered.
  it("bounds ls -d operands", async () => {
    const bash = new Bash({
      files: { "/root/a": "a", "/root/b": "b", "/root/c": "c" },
      executionLimits: { maxTraversalEntries: 2 },
    });

    await expect(
      bash.exec("ls -d /root/a /root/b /root/c"),
    ).resolves.toMatchObject({ exitCode: 126 });
  });

  // -t and -S read metadata for every name before printing any of it, so the
  // sort is charged up front rather than after the reads have happened.
  it("bounds the metadata reads -t performs to sort a directory", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 40; index++) {
      files[`/root/f${index}`] = "x";
    }
    const bash = new Bash({
      files,
      executionLimits: { maxTraversalWork: 8 },
    });

    await expect(bash.exec("ls -t /root")).resolves.toMatchObject({
      exitCode: 126,
    });
    // The same listing in name order reads no metadata and stays under it.
    await expect(bash.exec("ls /root")).resolves.toMatchObject({ exitCode: 0 });
  });
});

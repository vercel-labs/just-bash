import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sort reads UTF-8 from stdin", () => {
  it("default sort preserves bytes (no case-fold corruption)", async () => {
    const env = new Bash({ files: { "/in.txt": "café\nbé\n" } });
    const result = await env.exec("cat /in.txt | sort");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("bé\ncafé\n");
  });

  it("sort -f case-folds without mutating UTF-8 leading bytes", async () => {
    // Without the fix, naive `.toLowerCase()` over a latin1 byte buffer
    // turns the 0xC3 leading byte of `é` into 0xE3 — a *different* valid
    // UTF-8 leading byte — silently corrupting accented characters.
    const env = new Bash({ files: { "/in.txt": "Café\nApple\n" } });
    const result = await env.exec("cat /in.txt | sort -f");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Apple\nCafé\n");
  });
});

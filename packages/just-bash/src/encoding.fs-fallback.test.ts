/**
 * `readFileBytes` is optional on `IFileSystem` — external implementations
 * predating this method must keep working. The `readBytesFrom` helper
 * detects the gap and falls back to `readFileBuffer` + manual conversion.
 * Without this back-compat, common commands (cat, jq, wc, sort, ...) would
 * throw `TypeError: readFileBytes is not a function` for any user-supplied
 * filesystem written before the method existed.
 */
import { describe, expect, it, vi } from "vitest";
import { Bash } from "./Bash.js";
import { type ByteString, bytesFromUint8Array } from "./encoding.js";
import { InMemoryFs } from "./fs/in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "./fs/interface.js";

/**
 * Wrap an InMemoryFs in a Proxy that hides `readFileBytes`, forcing every
 * caller down the fallback path. Delegates everything else.
 */
function createLegacyFs(seed: Record<string, string>): IFileSystem {
  const inner = new InMemoryFs(seed);
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "readFileBytes") return undefined;
      const value = Reflect.get(target, prop, receiver);
      // Methods need to keep their `this` bound to the inner instance.
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(target, prop) {
      if (prop === "readFileBytes") return false;
      return Reflect.has(target, prop);
    },
  }) as IFileSystem;
}

describe("readFileBytes back-compat fallback", () => {
  it("commands work against a custom IFileSystem missing readFileBytes", async () => {
    const fs = createLegacyFs({ "/in.txt": "한글" });
    expect(typeof fs.readFileBytes).toBe("undefined");
    // Sanity: proxy still resolves and reads files.
    const direct = await fs.readFileBuffer(fs.resolvePath("/", "/in.txt"));
    expect(new TextDecoder().decode(direct)).toBe("한글");

    const bash = new Bash({ fs });
    // cat goes through readFiles → readBytesFrom → falls back to
    // readFileBuffer (which is present), then converts to ByteString.
    const r = await bash.exec("cat /in.txt");
    expect({
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
    }).toEqual({ stdout: "한글", stderr: "", exitCode: 0 });
  });

  it.each([
    false,
    true,
  ])("round-trips large byte views (browser: %s)", (browser) => {
    const buf = Uint8Array.from(
      { length: 256 * 1024 + 2 },
      (_, i) => i % 256,
    ).subarray(1, -1);
    let s: ByteString;
    try {
      if (browser) vi.stubGlobal("Buffer", undefined);
      s = bytesFromUint8Array(buf);
      expect(() => bytesFromUint8Array(buf, buf.length - 1)).toThrow(
        "byte conversion limit exceeded",
      );
    } finally {
      vi.unstubAllGlobals();
    }
    const back = Uint8Array.from(s as unknown as string, (c) =>
      c.charCodeAt(0),
    );
    expect(back).toEqual(buf);
  });
});

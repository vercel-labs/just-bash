/**
 * `readFileBytes` is optional on `IFileSystem` — external implementations
 * predating this method must keep working. The `readBytesFrom` helper
 * detects the gap and falls back to `readFileBuffer` + manual conversion.
 * Without this back-compat, common commands (cat, jq, wc, sort, ...) would
 * throw `TypeError: readFileBytes is not a function` for any user-supplied
 * filesystem written before the method existed.
 */
import { describe, expect, it } from "vitest";
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

  it("bytesFromUint8Array round-trips bytes verbatim", () => {
    const buf = new Uint8Array([0x00, 0x7f, 0x80, 0xc3, 0xa9, 0xff]);
    const s: ByteString = bytesFromUint8Array(buf);
    const back = Uint8Array.from(s as unknown as string, (c) =>
      c.charCodeAt(0),
    );
    expect(Array.from(back)).toEqual(Array.from(buf));
  });
});

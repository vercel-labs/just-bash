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
import {
  type ByteString,
  bytesFromUint8Array,
  encodeUtf8ToBytes,
  latin1FromBytes,
} from "./encoding.js";
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

  it("bytesFromUint8Array preserves all byte values and chunk boundaries", () => {
    const buf = Uint8Array.from({ length: 8193 }, (_, i) => i & 0xff);
    const s: ByteString = bytesFromUint8Array(buf);
    const back = Uint8Array.from(latin1FromBytes(s), (c) => c.charCodeAt(0));
    expect(Array.from(back)).toEqual(Array.from(buf));
  });

  it("encodeUtf8ToBytes matches TextEncoder for Unicode and lone surrogates", () => {
    const text = "ASCII é 水 💩 \uD800 lone-high \uDC00 lone-low";
    const actual = latin1FromBytes(encodeUtf8ToBytes(text));
    const expected = Array.from(new TextEncoder().encode(text), (byte) =>
      String.fromCharCode(byte),
    ).join("");
    expect(actual).toBe(expected);
  });
});

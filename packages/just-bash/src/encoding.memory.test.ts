import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("converts large byte buffers and UTF-8 text within a bounded heap", () => {
  const encodingUrl = new URL("./encoding.ts", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=128",
      "--import",
      import.meta.resolve("tsx"),
      "--input-type=module",
      "--eval",
      `
        import assert from 'node:assert/strict';
        import { bytesFromUint8Array, encodeUtf8ToBytes, latin1FromBytes }
          from ${JSON.stringify(encodingUrl)};
        const bytes = new Uint8Array(8 * 1024 * 1024 + 1);
        for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
        const binary = latin1FromBytes(bytesFromUint8Array(bytes));
        assert.equal(binary.length, bytes.length);
        for (let i = 0; i < bytes.length; i++) {
          assert.equal(binary.charCodeAt(i), bytes[i]);
        }
        const text = 'é😀'.repeat(1024 * 1024);
        const encoded = latin1FromBytes(encodeUtf8ToBytes(text));
        assert.equal(encoded, Buffer.from(text).toString('latin1'));
        console.log('ok');
      `,
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("ok\n");
}, 35_000);

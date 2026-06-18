import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";

/**
 * UTF-8 across statement / command-substitution boundaries (issue #957).
 *
 * A single `exec()` can interleave text-shaped statements (sed, awk, echo — ö
 * as U+00F6) with byte-shaped ones (grep | head, cat — ö as bytes 0xC3 0xB6).
 * Concatenated raw, the lone high byte from the text half makes the combined
 * stream invalid UTF-8, so the output-boundary decoder bails and leaves the
 * byte half as Latin-1 mojibake. The fix decodes each statement/pipeline result
 * to text via its explicit `stdoutKind` before concatenating.
 */

function utf8Hex(s: string): string {
  return [...new TextEncoder().encode(s)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

describe("statement-interleave UTF-8 (issue #957)", () => {
  it("round-trips when text (sed) and byte (grep|head) statements interleave", async () => {
    const b = new Bash({ files: { "/doc.txt": "Köpenicker\n" } });
    expect(
      (await b.exec("sed -n 1p /doc.txt\ngrep Köpenicker /doc.txt | head -1"))
        .stdout,
    ).toBe("Köpenicker\nKöpenicker\n");
    expect(
      (await b.exec("sed -n 1p /doc.txt; grep Köpenicker /doc.txt | head -1"))
        .stdout,
    ).toBe("Köpenicker\nKöpenicker\n");
  });

  it("handles 3-byte (CJK) and 4-byte (emoji) codepoints across the interleave", async () => {
    const cjk = new Bash({ files: { "/d.txt": "日本語\n" } });
    expect(
      (await cjk.exec("sed -n 1p /d.txt\ngrep 日本語 /d.txt | head -1")).stdout,
    ).toBe("日本語\n日本語\n");
    const emoji = new Bash({ files: { "/e.txt": "🌍\n" } });
    expect(
      (await emoji.exec("sed -n 1p /e.txt\ngrep 🌍 /e.txt | head -1")).stdout,
    ).toBe("🌍\n🌍\n");
  });

  it("decodes a byte producer inside command substitution before splicing", async () => {
    const b = new Bash({ files: { "/world.txt": "世界\n" } });
    expect((await b.exec('echo "你好: $(cat /world.txt)"')).stdout).toBe(
      "你好: 世界\n",
    );
    expect(
      (await b.exec('echo "Company: $(grep 世界 /world.txt)"')).stdout,
    ).toBe("Company: 世界\n");
  });

  it("preserves UTF-8 through $(...) captured into a var and re-emitted (the #957 report)", async () => {
    const b = new Bash({ files: { "/utf8.txt": "—\n" } });
    const r = await b.exec('VAR=$(cat /utf8.txt); printf %s "$VAR"');
    expect(r.exitCode).toBe(0);
    expect(utf8Hex(r.stdout)).toBe("e2 80 94");
    expect(r.stdout).toBe("—");
  });

  it("builds a UTF-8 payload from a file via $(...) without mojibake", async () => {
    const b = new Bash({ files: { "/msg.txt": "price: 5 × 3 — done 🌍" } });
    const r = await b.exec('TEXT=$(cat /msg.txt); printf %s "$TEXT"');
    expect(r.stdout).toBe("price: 5 × 3 — done 🌍");
  });

  it("decodes byte output inside a for-loop body (Jueast case)", async () => {
    const b = new Bash({ files: { "/世界.txt": "Hello 世界\n" } });
    const r = await b.exec(
      'for f in /世界.txt; do echo "--- $(basename "$f")"; grep Hello "$f" | head -n 1; done',
    );
    expect(r.stdout).toBe("--- 世界.txt\nHello 世界\n");
  });

  it("does NOT decode text-shaped output whose chars look like mojibake (no regression)", async () => {
    // `KÃ¶penicker` from `echo` is text (U+00C3 U+00B6), not bytes. It must not
    // be reinterpreted as UTF-8 — the heuristic that guesses from code units
    // would wrongly fold `Ã¶` into `ö` and change shell control flow.
    const b = new Bash({});
    expect(
      (
        await b.exec(
          '[ "$(echo KÃ¶penicker)" = KÃ¶penicker ] && echo SAME || echo DIFF',
        )
      ).stdout,
    ).toBe("SAME\n");
  });

  it("preserves a legitimate single Latin-1 char that is invalid standalone UTF-8", async () => {
    const b = new Bash({});
    expect(
      (
        await b.exec(
          '[ "$(echo Köpenicker)" = Köpenicker ] && echo SAME || echo DIFF',
        )
      ).stdout,
    ).toBe("SAME\n");
  });

  it("passes raw binary through cat redirection untouched by the decode", async () => {
    const b = new Bash({
      files: { "/b.bin": new Uint8Array([0x80, 0xff, 0x00, 0x90]) },
    });
    await b.exec("cat /b.bin | cat > /out.bin");
    const out = await b.fs.readFileBuffer("/out.bin");
    expect(Array.from(out)).toEqual([0x80, 0xff, 0x00, 0x90]);
  });
});

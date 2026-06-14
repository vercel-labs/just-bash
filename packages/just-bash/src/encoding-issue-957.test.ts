import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";

/**
 * Reproducers from ai-ecoverse/slicc#957: "Bash command substitution `$(...)`
 * double-encodes UTF-8 bytes".
 *
 * The downstream report saw UTF-8 captured via `$(...)` / `head -c` / `tail -c`
 * / `cat | …` come back Latin-1 double-encoded (em-dash `e2 80 94` → `c3 a2 c2
 * 80 c2 94`), with each extra capture layer adding another encode pass. The
 * issue also lists operations that were NOT broken (heredoc literals, plain
 * `printf`/`echo`, on-disk bytes), which we pin as non-regression guards.
 *
 * Bytes are asserted directly here rather than via `python3`/`node` (as the
 * issue did) so the checks don't depend on the optional worker runtimes.
 */

function utf8Hex(s: string): string {
  return [...new TextEncoder().encode(s)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

describe("issue #957 — $(...) / byte-window UTF-8 round-trips", () => {
  it("captures `$(cat file)` without Latin-1 double-encoding (the original report)", async () => {
    const b = new Bash({ files: { "/utf8.txt": "—\n" } });
    const r = await b.exec('VAR=$(cat /utf8.txt); printf %s "$VAR"');
    expect(r.exitCode).toBe(0);
    // em-dash U+2014 = e2 80 94, NOT the reported c3 a2 c2 80 c2 94.
    expect(utf8Hex(r.stdout)).toBe("e2 80 94");
    expect(r.stdout).toBe("—");
  });

  it("does not triple-encode when the capture is wrapped again", async () => {
    const b = new Bash({ files: { "/utf8.txt": "—\n" } });
    const r = await b.exec(
      'VAR=$(cat /utf8.txt); VAR2=$(echo "$VAR"); printf %s "$VAR2"',
    );
    expect(r.exitCode).toBe(0);
    expect(utf8Hex(r.stdout)).toBe("e2 80 94");
  });

  it("keeps `head -c` / `tail -c` byte windows aligned to the source bytes", async () => {
    // "ABC—DEF\n" = 41 42 43 | e2 80 94 | 44 45 46 0a. The first 6 bytes are
    // "ABC" + the em-dash; the last 3 of those are exactly the em-dash.
    const b = new Bash({ files: { "/f.txt": "ABC—DEF\n" } });
    const r = await b.exec('X=$(head -c 6 /f.txt | tail -c 3); printf %s "$X"');
    expect(r.exitCode).toBe(0);
    expect(utf8Hex(r.stdout)).toBe("e2 80 94");
  });

  it("counts `head -c` byte windows exactly even when they split a codepoint", async () => {
    // head -c 4 cuts mid-em-dash (41 42 43 e2); the pipe must forward 4 raw
    // bytes, not a re-encoded expansion.
    const b = new Bash({ files: { "/f.txt": "ABC—DEF\n" } });
    const r = await b.exec("head -c 4 /f.txt | wc -c");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("4");
  });

  it("preserves UTF-8 through `cat | sed` (listed as NOT broken)", async () => {
    const b = new Bash({ files: { "/utf8.txt": "—\n" } });
    const r = await b.exec("cat /utf8.txt | sed 's/^/PFX: /'");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("PFX: —\n");
    expect(utf8Hex(r.stdout)).toBe("50 46 58 3a 20 e2 80 94 0a");
  });

  it("round-trips a real-world multi-codepoint payload via `$(cat)` to disk and stdout", async () => {
    // The Slack chat.postMessage case: ESCAPED=$(cat file) re-emitted later.
    const b = new Bash({ files: { "/reply.txt": "price: 5 × 3 — done 🌍" } });
    const r = await b.exec(
      'ESCAPED=$(cat /reply.txt); printf %s "$ESCAPED" > /out.txt; printf %s "$ESCAPED"',
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("price: 5 × 3 — done 🌍");
    // × = c3 97, — = e2 80 94, 🌍 = f0 9f 8c 8d — single-encoded on disk.
    const onDisk = await b.fs.readFileBuffer("/out.txt");
    expect(Array.from(onDisk)).toEqual([
      0x70, 0x72, 0x69, 0x63, 0x65, 0x3a, 0x20, 0x35, 0x20, 0xc3, 0x97, 0x20,
      0x33, 0x20, 0xe2, 0x80, 0x94, 0x20, 0x64, 0x6f, 0x6e, 0x65, 0x20, 0xf0,
      0x9f, 0x8c, 0x8d,
    ]);
  });

  it("writes correct on-disk bytes from a quoted heredoc literal (NOT broken)", async () => {
    const b = new Bash({});
    await b.exec("cat > /x <<'JS'\nsome — text\nJS");
    const onDisk = await b.fs.readFileBuffer("/x");
    expect(Array.from(onDisk)).toEqual([
      0x73, 0x6f, 0x6d, 0x65, 0x20, 0xe2, 0x80, 0x94, 0x20, 0x74, 0x65, 0x78,
      0x74, 0x0a,
    ]);
  });

  it("emits literal UTF-8 from printf / echo unchanged (NOT broken)", async () => {
    const b = new Bash({});
    expect(utf8Hex((await b.exec("printf '%s' '—'")).stdout)).toBe("e2 80 94");
    expect(utf8Hex((await b.exec("echo -n '—'")).stdout)).toBe("e2 80 94");
  });
});

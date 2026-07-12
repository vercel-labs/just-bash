import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/** Independent reference implementation of the GNU `cat -v` byte table. */
function vRef(byte: number, showTabs: boolean): string {
  if (byte === 9) return showTabs ? "^I" : "\t";
  if (byte >= 32) {
    if (byte < 127) return String.fromCharCode(byte);
    if (byte === 127) return "^?";
    const c = byte - 128;
    if (c >= 32) return c === 127 ? "M-^?" : `M-${String.fromCharCode(c)}`;
    return `M-^${String.fromCharCode(c + 64)}`;
  }
  return `^${String.fromCharCode(byte + 64)}`;
}

describe("cat -v byte table (GNU semantics)", () => {
  it("transforms every byte 0-255 (except LF) exactly", async () => {
    const codes: number[] = [];
    for (let b = 0; b <= 255; b++) {
      if (b !== 10) codes.push(b);
    }
    codes.push(10); // trailing newline terminator
    const env = new Bash({ files: { "/bytes.bin": new Uint8Array(codes) } });
    const r = await env.exec("cat -v /bytes.bin");

    let expected = "";
    for (const b of codes) {
      if (b === 10) expected += "\n";
      else expected += vRef(b, false);
    }
    expect(r.stdout).toBe(expected);
    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
  });

  it("matches known control-character representations", async () => {
    const env = new Bash({
      files: {
        "/c.bin": new Uint8Array([0, 1, 7, 8, 27, 31, 32, 126, 127, 10]),
      },
    });
    const r = await env.exec("cat -v /c.bin");
    expect(r.stdout).toBe("^@^A^G^H^[^_ ~^?\n");
  });

  it("renders high bytes with M- notation", async () => {
    const env = new Bash({
      files: {
        "/h.bin": new Uint8Array([128, 129, 155, 159, 160, 200, 254, 255, 10]),
      },
    });
    const r = await env.exec("cat -v /h.bin");
    expect(r.stdout).toBe("M-^@M-^AM-^[M-^_M- M-HM-~M-^?\n");
  });

  it("leaves TAB literal under -v but renders ^I under -vT", async () => {
    const env = new Bash({
      files: { "/t.bin": new Uint8Array([97, 9, 98, 10]) },
    });
    const v = await env.exec("cat -v /t.bin");
    expect(v.stdout).toBe("a\tb\n");
    const vt = await env.exec("cat -vT /t.bin");
    expect(vt.stdout).toBe("a^Ib\n");
  });

  it("never transforms the newline terminator", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\nb\\n" | cat -v');
    expect(r.stdout).toBe("a\nb\n");
  });

  it("renders UTF-8 multibyte bytes with M- notation", async () => {
    // "é" is UTF-8 0xC3 0xA9
    const env = new Bash({
      files: { "/u.bin": new Uint8Array([0xc3, 0xa9, 10]) },
    });
    const r = await env.exec("cat -v /u.bin");
    expect(r.stdout).toBe("M-CM-)\n");
  });
});

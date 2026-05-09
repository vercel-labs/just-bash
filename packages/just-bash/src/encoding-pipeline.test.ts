/**
 * End-to-end regression tests for the byte/text pipeline contract.
 *
 * just-bash represents shell strings as JS strings, but the same string can
 * be either JS Unicode text (echo, printf, sed, jq output) or a latin1 byte
 * buffer (cat, gzip, tar output). The pipeline + redirect layer must treat
 * those shapes differently — text gets UTF-8 encoded once on handoff so
 * byte consumers see real UTF-8 bytes, byte buffers pass through verbatim.
 *
 * Each producer marks its `stdout` shape with `stdoutKind: "text" | "bytes"`
 * (or the legacy `stdoutEncoding: "binary"`). The pipe glue and redirects
 * consult that metadata; they never inspect characters.
 *
 * These tests fence in the cases that fall out of that contract — adding a
 * new pipeline stage or a new producer that breaks any of them is a sign
 * the contract has been violated.
 */
import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";

describe("byte/text pipeline contract", () => {
  describe("text → byte consumer", () => {
    it("`echo 한 | wc -c` reports 4 bytes (3 UTF-8 + newline)", async () => {
      const env = new Bash();
      const r = await env.exec("echo 한 | wc -c");
      expect(r.stdout.trim()).toBe("4");
    });

    it("`echo Ü | wc -c` reports 3 bytes (2 UTF-8 + newline)", async () => {
      const env = new Bash();
      const r = await env.exec("echo Ü | wc -c");
      expect(r.stdout.trim()).toBe("3");
    });

    it("`echo abc | wc -c` reports 4 bytes (3 ASCII + newline)", async () => {
      const env = new Bash();
      const r = await env.exec("echo abc | wc -c");
      expect(r.stdout.trim()).toBe("4");
    });
  });

  describe("byte producer → byte consumer (no double encoding)", () => {
    it("`cat /utf8 | wc -c` reports the original byte count", async () => {
      const env = new Bash({ files: { "/in.txt": "한글" } });
      const r = await env.exec("cat /in.txt | wc -c");
      expect(r.stdout.trim()).toBe("6");
    });

    it("`cat /utf8 | sed s/x/y/ | wc -c` keeps the byte count", async () => {
      const env = new Bash({ files: { "/in.txt": "한글" } });
      const r = await env.exec("cat /in.txt | sed 's/x/y/' | wc -c");
      expect(r.stdout.trim()).toBe("6");
    });

    it("`cat /utf8 | rev | base64` encodes the reversed UTF-8 bytes", async () => {
      const env = new Bash({ files: { "/in.txt": "한" } });
      const r = await env.exec("cat /in.txt | rev | base64");
      // base64 of UTF-8 bytes 0xED 0x95 0x9C is "7ZWc".
      expect(r.stdout.trim()).toBe("7ZWc");
    });
  });

  describe("text → file redirect (UTF-8 write)", () => {
    it("`echo café > /out` writes valid UTF-8", async () => {
      const env = new Bash();
      await env.exec("echo café > /out.txt");
      const file = await env.fs.readFileBuffer("/out.txt");
      expect(new TextDecoder().decode(file)).toBe("café\n");
    });

    it("redirect encoding picks utf8 for unmarked text stdout regardless of where the first non-ASCII byte lands", async () => {
      // The redirect layer must not pick its encoding by sampling the
      // first 8 KiB of the content. A text-emitting command (sed,
      // grep, jq, ...) returns text without `stdoutKind`; its long
      // mostly-ASCII output may have its first non-ASCII codepoint past
      // the sample window, and a content-based heuristic would mis-
      // classify the prefix as ASCII / "binary" and write each later
      // codepoint truncated to its low byte. Unmarked stdout is
      // unconditionally text and gets UTF-8 encoded by the writer.
      const env = new Bash();
      const longAscii = "x".repeat(8200);
      await env.exec(`printf '%s\\n' '${longAscii}Ü' | sed 's/^//' > /out.txt`);
      const file = await env.fs.readFileBuffer("/out.txt");
      expect(new TextDecoder().decode(file)).toBe(`${longAscii}Ü\n`);
    });
  });

  describe("byte → file redirect (binary write)", () => {
    it("`cat /utf8 > /out` round-trips bytes verbatim", async () => {
      const env = new Bash({ files: { "/in.txt": "한글" } });
      await env.exec("cat /in.txt > /out.txt");
      const a = await env.fs.readFileBuffer("/in.txt");
      const b = await env.fs.readFileBuffer("/out.txt");
      expect(Array.from(b)).toEqual(Array.from(a));
    });

    it("non-UTF-8 binary file round-trips through cat | cat | cat", async () => {
      const env = new Bash({
        files: { "/binary.bin": new Uint8Array([0x80, 0xff, 0x00, 0x90]) },
      });
      await env.exec("cat /binary.bin | cat | cat > /out.bin");
      const out = await env.fs.readFileBuffer("/out.bin");
      expect(Array.from(out)).toEqual([0x80, 0xff, 0x00, 0x90]);
    });
  });

  describe("tee writes byte-identical output", () => {
    it("piped UTF-8 bytes survive tee verbatim", async () => {
      const env = new Bash({ files: { "/in.txt": "한글 / café / 漢字" } });
      const r = await env.exec("cat /in.txt | tee /out.txt > /dev/null");
      expect(r.exitCode).toBe(0);
      const a = await env.fs.readFileBuffer("/in.txt");
      const b = await env.fs.readFileBuffer("/out.txt");
      expect(Array.from(b)).toEqual(Array.from(a));
    });
  });

  describe("here-docs / here-strings → byte consumer", () => {
    it("heredoc with non-ASCII text pipes as UTF-8 bytes", async () => {
      const env = new Bash();
      const r = await env.exec(`wc -c <<EOF
한
EOF`);
      // "한\n" = 3 UTF-8 bytes + 1 newline = 4 bytes.
      expect(r.stdout.trim()).toBe("4");
    });

    it("here-string with non-ASCII text pipes as UTF-8 bytes", async () => {
      const env = new Bash();
      const r = await env.exec(`wc -c <<< "한"`);
      expect(r.stdout.trim()).toBe("4");
    });
  });

  describe("`bash -c`, sh, functions, groups, subshells preserve stdin", () => {
    it("bash -c inherits piped stdin and forwards it to byte consumers", async () => {
      const env = new Bash();
      const r = await env.exec(`echo 한 | bash -c 'wc -c'`);
      expect(r.stdout.trim()).toBe("4");
    });

    it("function call sees the parent's stdin in byte form", async () => {
      const env = new Bash();
      const r = await env.exec(
        `f() { wc -c; }
echo 한 | f`,
      );
      expect(r.stdout.trim()).toBe("4");
    });

    it("group command preserves piped stdin", async () => {
      const env = new Bash();
      const r = await env.exec("echo 한 | { wc -c; }");
      expect(r.stdout.trim()).toBe("4");
    });

    it("subshell preserves piped stdin", async () => {
      const env = new Bash();
      const r = await env.exec("echo 한 | (wc -c)");
      expect(r.stdout.trim()).toBe("4");
    });
  });

  describe("custom commands", () => {
    it("text-emitting custom command pipes correctly without setting flags", async () => {
      const { defineCommand } = await import("./custom-commands.js");
      const greet = defineCommand("greet", async () => ({
        stdout: "안녕\n",
        stderr: "",
        exitCode: 0,
      }));
      const env = new Bash({ customCommands: [greet] });
      const r = await env.exec("greet | wc -c");
      // "안녕\n" = 7 UTF-8 bytes (3 + 3 + 1).
      expect(r.stdout.trim()).toBe("7");
    });

    it("byte-emitting custom command pipes without double encoding", async () => {
      const { bytesOutput, encodeUtf8ToBytes } = await import("./encoding.js");
      const { defineCommand } = await import("./custom-commands.js");
      const emitBytes = defineCommand("emit-bytes", async () => ({
        ...bytesOutput(encodeUtf8ToBytes("안녕\n")),
        stderr: "",
        exitCode: 0,
      }));
      const env = new Bash({ customCommands: [emitBytes] });
      const r = await env.exec("emit-bytes | wc -c");
      expect(r.stdout.trim()).toBe("7");
    });
  });

  describe("Bash.exec({ stdin })", () => {
    it("text stdin (default) reaches byte consumers as UTF-8 bytes", async () => {
      const env = new Bash();
      const r = await env.exec("wc -c", { stdin: "한" });
      // No trailing newline in the input.
      expect(r.stdout.trim()).toBe("3");
    });

    it("byte stdin (stdinKind: 'bytes') is forwarded verbatim", async () => {
      const env = new Bash();
      // 4 bytes: 0x00, 0x80, 0xFF, 0x90 (not valid UTF-8).
      const raw = "\x00\x80\xff\x90";
      const r = await env.exec("wc -c", { stdin: raw, stdinKind: "bytes" });
      expect(r.stdout.trim()).toBe("4");
    });
  });

  describe("public encoding exports", () => {
    // The byte/text helpers are part of the package's public API.
    // Custom-command authors and downstream tools import them by name;
    // removing any of these names is a breaking change.
    it("exports the canonical helpers from the package entry", async () => {
      const mod = (await import("./index.js")) as Record<string, unknown>;
      for (const name of [
        "decodeBytesToUtf8",
        "encodeUtf8ToBytes",
        "latin1FromBytes",
        "unsafeBytesFromLatin1",
        "stdoutKind",
        "stdoutAsBytes",
        "textOutput",
        "bytesOutput",
        "EMPTY_BYTES",
      ]) {
        const expected = name === "EMPTY_BYTES" ? "string" : "function";
        expect({ [name]: typeof mod[name] }).toEqual({ [name]: expected });
      }
    });
  });
});

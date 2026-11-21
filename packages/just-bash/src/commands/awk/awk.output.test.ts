import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type {
  FileContent,
  BufferEncoding as FsBufferEncoding,
  WriteFileOptions,
} from "../../fs/interface.js";

/**
 * InMemoryFs that records every appendFile call (byte size), so tests can
 * prove output was batched instead of re-reading the file per print.
 */
class CountingFs extends InMemoryFs {
  appendSizes: number[] = [];
  override async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | FsBufferEncoding,
  ): Promise<void> {
    this.appendSizes.push(
      typeof content === "string" ? content.length : content.byteLength,
    );
    return super.appendFile(path, content, options);
  }
}

describe("awk output control", () => {
  describe("OFS (output field separator)", () => {
    it("should use default OFS (space)", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "a b c" | awk '{ print $1, $2, $3 }'`,
      );
      expect(result.stdout).toBe("a b c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should use custom OFS", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "a b c" | awk 'BEGIN { OFS = ":" } { print $1, $2, $3 }'`,
      );
      expect(result.stdout).toBe("a:b:c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should use OFS with tab", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "a b c" | awk 'BEGIN { OFS = "\\t" } { print $1, $2, $3 }'`,
      );
      expect(result.stdout).toBe("a\tb\tc\n");
      expect(result.exitCode).toBe(0);
    });

    it("should use multi-character OFS", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "a b c" | awk 'BEGIN { OFS = " | " } { print $1, $2, $3 }'`,
      );
      expect(result.stdout).toBe("a | b | c\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("ORS (output record separator)", () => {
    it("should use default ORS (newline)", async () => {
      const env = new Bash({
        files: { "/data.txt": "a\nb\nc\n" },
      });
      const result = await env.exec(`awk '{ print $0 }' /data.txt`);
      expect(result.stdout).toBe("a\nb\nc\n");
      expect(result.exitCode).toBe(0);
    });

    it("should use custom ORS", async () => {
      const env = new Bash({
        files: { "/data.txt": "a\nb\nc\n" },
      });
      const result = await env.exec(
        `awk 'BEGIN { ORS = ";" } { print $0 }' /data.txt`,
      );
      expect(result.stdout).toBe("a;b;c;");
      expect(result.exitCode).toBe(0);
    });

    it("should use empty ORS", async () => {
      const env = new Bash({
        files: { "/data.txt": "a\nb\nc\n" },
      });
      const result = await env.exec(
        `awk 'BEGIN { ORS = "" } { print $0 }' /data.txt`,
      );
      expect(result.stdout).toBe("abc");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("print without arguments", () => {
    it("should print $0 when no arguments", async () => {
      const env = new Bash();
      const result = await env.exec(`echo "hello world" | awk '{ print }'`);
      expect(result.stdout).toBe("hello world\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("printf without newline", () => {
    it("should not add newline after printf", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { printf "no newline" }'`,
      );
      expect(result.stdout).toBe("no newline");
      expect(result.exitCode).toBe(0);
    });

    it("should allow explicit newline in printf", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { printf "with newline\\n" }'`,
      );
      expect(result.stdout).toBe("with newline\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("printf with special features", () => {
    it("should handle parenthesized printf", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "42" | awk '{ printf("%d\\n", $1) }'`,
      );
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle printf length modifiers", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "10" | awk '{ printf("%d %ld %lld\\n", $1, $1, $1) }'`,
      );
      expect(result.stdout).toBe("10 10 10\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle %*s width specifier", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { printf("a%*sb\\n", 5, "x") }'`,
      );
      expect(result.stdout).toBe("a    xb\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle negative %*s width specifier", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "" | awk 'BEGIN { printf("a%*sb\\n", -5, "x") }'`,
      );
      expect(result.stdout).toBe("ax    b\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("file output redirection", () => {
    it("should redirect to file with >", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "test" | awk '{ print "output" > "/tmp/out.txt" }' && cat /tmp/out.txt`,
      );
      expect(result.stdout).toBe("output\n");
      expect(result.exitCode).toBe(0);
    });

    it("should append to file with >>", async () => {
      const env = new Bash({
        files: { "/tmp/existing.txt": "line1\n" },
      });
      const result = await env.exec(
        `echo "test" | awk '{ print "line2" >> "/tmp/existing.txt" }' && cat /tmp/existing.txt`,
      );
      expect(result.stdout).toBe("line1\nline2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should write multiple lines to same file with >", async () => {
      const env = new Bash({
        files: { "/data.txt": "a\nb\nc\n" },
      });
      const result = await env.exec(
        `awk '{ print $0 > "/tmp/out.txt" }' /data.txt && cat /tmp/out.txt`,
      );
      expect(result.stdout).toBe("a\nb\nc\n");
      expect(result.exitCode).toBe(0);
    });

    it("should write many lines to the same file without re-reading it", async () => {
      // Regression test for #769: every `print > file` used to re-read the
      // whole file and write `existing + content` back (quadratic). 2000
      // appends must produce exactly the input, byte for byte.
      // The counting filesystem proves the batching itself: the base
      // implementation issues one append per print (2000 calls), while
      // the buffered implementation flushes in 64 KiB batches (tens).
      const lines = Array.from({ length: 2000 }, (_, i) => `line-${i}`);
      const fs = new CountingFs({ "/data.txt": `${lines.join("\n")}\n` });
      const env = new Bash({ fs, cwd: "/" });
      const result = await env.exec(
        `awk '{ print $0 > "/tmp/out.txt" }' /data.txt && cat /tmp/out.txt`,
      );
      expect(result.stdout).toBe(`${lines.join("\n")}\n`);
      expect(result.exitCode).toBe(0);
      expect(fs.appendSizes.length).toBeLessThan(100);
      expect(fs.appendSizes.some((size) => size > 1024)).toBe(true);
    });

    it("should flush at the per-file 64 KiB threshold", async () => {
      // Each printed line is exactly 1024 bytes, so after 64 lines the
      // per-file buffer holds exactly 64 KiB and the per-file >= check
      // fires — the aggregate > check alone would only fire one line
      // later, after the next print. The recorded append sizes prove
      // the per-file check fired: a flush deletes the entry, so the
      // next print writes through (1024 bytes) and the following 64
      // lines flush again at 65536. Over 2000 lines that cycle gives
      // 61 appends (30 of 65536 bytes, 30 of 1024, plus the 51200-byte
      // exit flush); without the per-file check the aggregate cap alone
      // would flush one line later per cycle and the 1024-byte
      // write-throughs would disappear, so the exact count pins the
      // per-file check itself.
      const line = "x".repeat(1023);
      const lines = Array.from({ length: 2000 }, () => line);
      const fs = new CountingFs({ "/data.txt": `${lines.join("\n")}\n` });
      const env = new Bash({ fs, cwd: "/" });
      const result = await env.exec(
        `awk '{ print $0 > "/tmp/out.txt" }' /data.txt && wc -c /tmp/out.txt`,
      );
      expect(result.stdout).toBe("2048000 /tmp/out.txt\n");
      expect(result.exitCode).toBe(0);
      expect(fs.appendSizes.length).toBe(61);
      expect(fs.appendSizes.filter((size) => size === 65536).length).toBe(30);
      expect(fs.appendSizes.filter((size) => size === 1024).length).toBe(30);
    });

    it("should truncate the file when printing after close()", async () => {
      const env = new Bash();
      const result = await env.exec(
        `awk 'BEGIN { print "a" > "/tmp/c.txt"; print "b" > "/tmp/c.txt"; close("/tmp/c.txt"); print "c" > "/tmp/c.txt" }' && cat /tmp/c.txt`,
      );
      expect(result.stdout).toBe("c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should still append with >> after close()", async () => {
      const env = new Bash({
        files: { "/tmp/existing.txt": "old\n" },
      });
      const result = await env.exec(
        `awk 'BEGIN { print "n1" >> "/tmp/existing.txt"; close("/tmp/existing.txt"); print "n2" >> "/tmp/existing.txt" }' && cat /tmp/existing.txt`,
      );
      expect(result.stdout).toBe("old\nn1\nn2\n");
      expect(result.exitCode).toBe(0);
    });

    it("should let getline see output written earlier in the program", async () => {
      const env = new Bash();
      const result = await env.exec(
        `awk 'BEGIN { print "one" > "/tmp/g.txt"; print "two" > "/tmp/g.txt"; while ((getline line < "/tmp/g.txt") > 0) print "got:" line }'`,
      );
      expect(result.stdout).toBe("got:one\ngot:two\n");
      expect(result.exitCode).toBe(0);
    });

    it("should re-read a file from the start after close()", async () => {
      const env = new Bash();
      const result = await env.exec(
        `awk 'BEGIN { print "a" > "/tmp/r.txt"; print "b" > "/tmp/r.txt"; if ((getline l1 < "/tmp/r.txt") > 0) print "first:" l1; close("/tmp/r.txt"); if ((getline l2 < "/tmp/r.txt") > 0) print "after-close:" l2 }'`,
      );
      expect(result.stdout).toBe("first:a\nafter-close:a\n");
      expect(result.exitCode).toBe(0);
    });
  });
});

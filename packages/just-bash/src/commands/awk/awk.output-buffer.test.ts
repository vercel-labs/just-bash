import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { OverlayFs } from "../../fs/overlay-fs/overlay-fs.js";

/**
 * Review fixes for #770 (buffered awk file output): the aggregate pending
 * cap, fatal-error rethrows from fflush(), symlink-aware flushing, the
 * close()/fflush() name mismatches, the symlink append regression, and
 * exit-flush failure reporting.
 */
describe("awk buffered file output (review fixes for #770)", () => {
  it("should return -1 from close('./f') and keep the 'f' stream open", async () => {
    // Review repro for #770: close() resolves the name before flushing,
    // so close("./f") used to flush (and effectively close) the separate
    // "f" stream. It must return -1 and leave "f" alone; the buffered
    // a/b/c then survive the "./f" truncate and land before "X" at exit,
    // matching GNU awk.
    const env = new Bash({ cwd: "/tmp" });
    const result = await env.exec(
      `awk 'BEGIN { print "a" > "f"; print "b" > "f"; print "c" > "f"; print "close-alias:" close("./f"); print "X" > "./f"; close("f"); close("./f") }' && cat /tmp/f`,
    );
    expect(result.stdout).toBe("close-alias:-1\na\nb\nc\nX\n");
    expect(result.exitCode).toBe(0);
  });

  it("should return -1 from close('./f') for >> prints and keep a, b, c", async () => {
    const env = new Bash({ cwd: "/tmp" });
    const result = await env.exec(
      `awk 'BEGIN { print "a" >> "f"; print "b" >> "f"; print "c" >> "f"; print "close-alias:" close("./f"); print "X" >> "./f"; close("f"); close("./f") }' && cat /tmp/f`,
    );
    expect(result.stdout).toBe("close-alias:-1\na\nb\nc\nX\n");
    expect(result.exitCode).toBe(0);
  });

  it("should return -1 from close() and fflush() on names never opened", async () => {
    const env = new Bash({ cwd: "/tmp" });
    const result = await env.exec(
      `awk 'BEGIN { print "close-never:" close("nope"); print "fflush-never:" fflush("nope") }'`,
    );
    expect(result.stdout).toBe("close-never:-1\nfflush-never:-1\n");
    expect(result.exitCode).toBe(0);
  });

  it("should return -1 from fflush() on an unopened alias or input-only file", async () => {
    const fs = new InMemoryFs({ "/tmp/f": "", "/tmp/g": "old\n" });
    await fs.symlink("/tmp/f", "/tmp/alias");
    const env = new Bash({ fs, cwd: "/" });
    const result = await env.exec(
      `awk 'BEGIN { print "a" >> "/tmp/f"; print "b" >> "/tmp/f"; print "fflush-alias:" fflush("/tmp/alias"); getline x < "/tmp/g"; print "fflush-input:" fflush("/tmp/g"); print "c" >> "/tmp/f" }' && cat /tmp/f`,
    );
    expect(result.stdout).toBe("fflush-alias:-1\nfflush-input:-1\na\nb\nc\n");
    expect(result.exitCode).toBe(0);
  });

  it("should return the command exit status from close() on a pipe", async () => {
    const env = new Bash({ cwd: "/tmp" });
    const result = await env.exec(
      `awk 'BEGIN { "false" | getline x; print "close-false:" close("false"); "true" | getline y; print "close-true:" close("true") }'`,
    );
    expect(result.stdout).toBe("close-false:1\nclose-true:0\n");
    expect(result.exitCode).toBe(0);
  });

  it("should flush on fflush('') and report the result", async () => {
    // The old version of this test passed even with a no-op fflush: the
    // following getline flushed everything anyway. This version pins the
    // flush itself: with an 8 KiB filesystem quota the buffered 4 KiB
    // line cannot flush, so fflush("") must return -1; a working fflush
    // on a healthy filesystem returns 0.
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 8192 });
    const env = new Bash({ fs, cwd: "/" });
    const result = await env.exec(
      `awk 'BEGIN { print "aa" >> "/tmp/q.txt"; printf "%4000s\\n", "x" >> "/tmp/q.txt"; print "fflush:" fflush("") }'`,
    );
    expect(result.stdout).toBe("fflush:-1\n");
    // The exit flush fails the same way, so the run itself fails too.
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("failed to flush buffered output");

    const healthy = new Bash({ cwd: "/tmp" });
    const ok = await healthy.exec(
      `awk 'BEGIN { print "one" >> "f"; print "two" >> "f"; print "fflush:" fflush("") }' && cat /tmp/f`,
    );
    expect(ok.stdout).toBe("fflush:0\none\ntwo\n");
    expect(ok.exitCode).toBe(0);
  });

  it("should let getline through a symlink alias see buffered output", async () => {
    const fs = new InMemoryFs({ "/tmp/real.txt": "old\n" });
    await fs.symlink("/tmp/real.txt", "/tmp/alias");
    const env = new Bash({ fs, cwd: "/" });
    const result = await env.exec(
      `awk 'BEGIN { print "one" >> "/tmp/real.txt"; print "two" >> "/tmp/real.txt"; while ((getline x < "/tmp/alias") > 0) print x }'`,
    );
    expect(result.stdout).toBe("old\none\ntwo\n");
    expect(result.exitCode).toBe(0);
  });

  it("should let getline see output appended after the stream was opened", async () => {
    const env = new Bash({
      files: { "/tmp/g.txt": "a\n" },
    });
    const result = await env.exec(
      `awk 'BEGIN { if ((getline x < "/tmp/g.txt") > 0) print "first:" x; print "b" >> "/tmp/g.txt"; if ((getline y < "/tmp/g.txt") > 0) print "second:" y }'`,
    );
    expect(result.stdout).toBe("first:a\nsecond:b\n");
    expect(result.exitCode).toBe(0);
  });

  it("should rethrow fatal errors from fflush instead of returning -1", async () => {
    const env = new Bash();
    const result = await env.exec(
      `awk 'BEGIN { print fflush(sprintf("%10001s", "x")); print "after" }'`,
    );
    expect(result.exitCode).toBe(126);
    expect(result.stdout).not.toContain("after");
    expect(result.stderr).toContain("printf width limit exceeded");
  });

  it("should keep existing content when appending through a symlink", async () => {
    const fs = new InMemoryFs({ "/tmp/real.txt": "old\n" });
    await fs.symlink("/tmp/real.txt", "/tmp/alias");
    const env = new Bash({ fs, cwd: "/" });
    const result = await env.exec(
      `awk 'BEGIN { print "new" >> "/tmp/alias" }' && cat /tmp/real.txt`,
    );
    expect(result.stdout).toBe("old\nnew\n");
    expect(result.exitCode).toBe(0);
    // The link itself must survive the append.
    expect(await fs.readFile("/tmp/alias")).toBe("old\nnew\n");
  });

  it("should produce byte-exact output across the 64 KiB flush", async () => {
    // 2000 lines of ~40 bytes each: ~80 KiB total, so the per-file flush
    // fires mid-run. The output must still match the input byte for byte.
    const lines = Array.from(
      { length: 2000 },
      (_, i) => `line-${i}-${"x".repeat(30)}`,
    );
    const env = new Bash({
      files: { "/data.txt": `${lines.join("\n")}\n` },
    });
    const result = await env.exec(
      `awk '{ print $0 > "/tmp/out.txt" }' /data.txt && cat /tmp/out.txt`,
    );
    expect(result.stdout).toBe(`${lines.join("\n")}\n`);
    expect(result.exitCode).toBe(0);
  });

  it("should stay correct when pending output across many files exceeds the aggregate cap", async () => {
    // 200 files x (write-through first line + ~400 buffered bytes) is
    // ~80 KiB pending, past the 64 KiB aggregate cap, so the buffer is
    // flushed mid-run. Every file must still end up complete.
    const env = new Bash();
    const result = await env.exec(
      `awk 'BEGIN { for (i = 0; i < 200; i++) { printf "first-%04d\\n", i >> ("/tmp/m" i); printf "%0400d\\n", i >> ("/tmp/m" i) } }' && awk 'END { print NR }' /tmp/m*`,
    );
    expect(result.stdout).toBe("400\n");
    expect(result.exitCode).toBe(0);
    const sample = await env.exec(`cat /tmp/m0`);
    expect(sample.stdout).toBe(`first-0000\n${"0".repeat(400)}\n`);
  });

  it("should not accumulate empty printf appends", async () => {
    const env = new Bash();
    const result = await env.exec(
      `awk 'BEGIN { for (i = 0; i < 5000; i++) printf "" >> "/tmp/e.txt" }' && cat /tmp/e.txt; echo "exit:$?"`,
    );
    expect(result.stdout).toBe("exit:0\n");
    expect(result.exitCode).toBe(0);
  });

  it("should report a failed exit flush even with a nonzero exit status", async () => {
    // Review follow-up for #770: a program that uses `exit 7` can lose
    // buffered output with no message. The status stays 7, but the
    // lost output must be reported.
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 8192 });
    const env = new Bash({ fs, cwd: "/" });
    const result = await env.exec(
      `awk 'BEGIN { print "aa" >> "/tmp/q.txt"; printf "%4000s\\n", "x" >> "/tmp/q.txt"; exit 7 }'`,
    );
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("failed to flush buffered output");
    const after = await env.exec(`cat /tmp/q.txt`);
    expect(after.stdout).toBe("aa\n");
  });

  it("should write a single oversized print in bounded chunks", async () => {
    // Review follow-up for #770: a single print over 64 KiB used to go
    // into pendingAppend whole and could blow a small maxLiveBytes
    // budget. A 1 MiB print must succeed under a 128 KiB budget by
    // writing straight through in bounded pieces.
    const env = new Bash({
      cwd: "/",
      executionLimits: { maxLiveBytes: 128 * 1024 },
    });
    const result = await env.exec(
      `awk 'BEGIN { print "seed" >> "/tmp/out.txt"; s = ""; for (i = 0; i < 100; i++) s = s sprintf("%10000s", "x"); print s >> "/tmp/out.txt" }' && wc -c /tmp/out.txt`,
    );
    expect(result.stdout).toBe("1000006 /tmp/out.txt\n");
    expect(result.exitCode).toBe(0);
  });

  it("should write a buffered chunk through when the live-bytes budget cannot hold it", async () => {
    // A 4 KiB buffered print under a 2 KiB live-bytes budget must not
    // fail the program: buffering is an optimization, and the chunk is
    // transient once written.
    const env = new Bash({
      cwd: "/",
      executionLimits: { maxLiveBytes: 2048 },
    });
    const result = await env.exec(
      `awk 'BEGIN { print "seed" >> "/tmp/o.txt"; printf "%4000s\\n", "x" >> "/tmp/o.txt" }' && wc -c /tmp/o.txt`,
    );
    expect(result.stdout).toBe("4006 /tmp/o.txt\n");
    expect(result.exitCode).toBe(0);
  });

  it("should not lose buffered output when cancelled mid-run", async () => {
    // Review follow-up for #770: cancelling awk mid-run used to lose
    // buffered `>>` prints, because the exit flush runs against the
    // revoked filesystem. Every file created before the deadline must
    // still hold both of its lines: the buffer is flushed before any
    // filesystem call that can suspend, so nothing pending is left
    // behind when cancellation wins.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jb-cancel-"));
    const overlayFs = new OverlayFs({ root });
    const env = new Bash({
      fs: overlayFs,
      cwd: "/",
      executionLimits: { maxExecutionTimeMs: 300 },
    });
    const result = await env.exec(
      `awk 'BEGIN { for (i = 0; i < 100000; i++) { printf "first-%d\\n", i >> ("/tmp/m" i); printf "second-%d\\n", i >> ("/tmp/m" i) } }'`,
    );
    expect(result.exitCode).toBe(124);
    let checked = 0;
    for (let i = 0; ; i++) {
      let content: string;
      try {
        content = await overlayFs.readFile(`/tmp/m${i}`);
      } catch {
        break;
      }
      checked++;
      expect(content).toBe(`first-${i}\nsecond-${i}\n`);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("should keep getline working after a large append during an open read", async () => {
    // Review follow-up for #770: spreading all new records into push()
    // exceeds the JavaScript argument limit for a large enough append,
    // and the surrounding catch then reports an ordinary EOF. One
    // million appended lines is past that limit in every environment
    // this suite runs in (the limit sits near 140k-600k lines).
    const lines = Array.from({ length: 1000000 }, (_, i) => String(i + 1));
    const fs = new InMemoryFs({
      "/tmp/f": "a\n",
      "/tmp/many": `${lines.join("\n")}\n`,
    });
    const env = new Bash({ fs, cwd: "/" });
    const result = await env.exec(
      `awk 'BEGIN { getline x < "/tmp/f"; "cat /tmp/many >> /tmp/f" | getline t; r = (getline x < "/tmp/f"); print r, x }'`,
    );
    expect(result.stdout).toBe("1 1\n");
    expect(result.exitCode).toBe(0);
  });

  it("should bound retained entries over many distinct empty writes", async () => {
    // Review follow-up for #770: empty entries never added to
    // pendingTotalBytes, so many distinct empty writes could grow the
    // pending map without triggering either cap.
    const env = new Bash();
    const result = await env.exec(
      `awk 'BEGIN { for (i = 0; i < 3000; i++) printf "" >> ("/tmp/e" i) }' && ls /tmp/e0 && echo "exit:$?"`,
    );
    expect(result.stdout).toBe("/tmp/e0\nexit:0\n");
    expect(result.exitCode).toBe(0);
  });
});

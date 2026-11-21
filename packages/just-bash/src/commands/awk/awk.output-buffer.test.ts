import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

/**
 * Review fixes for #770 (buffered awk file output): the aggregate pending
 * cap, fatal-error rethrows from fflush(), symlink-aware flushing, the
 * close()/fflush() name mismatches, the symlink append regression, and
 * exit-flush failure reporting.
 */
describe("awk buffered file output (review fixes for #770)", () => {
  it("should not let close('./f') close a stream opened as 'f'", async () => {
    const env = new Bash({ cwd: "/tmp" });
    const result = await env.exec(
      `awk 'BEGIN { print "one" > "f"; print "two" > "f"; close("./f"); print "three" > "f" }' && cat /tmp/f`,
    );
    expect(result.stdout).toBe("one\ntwo\nthree\n");
    expect(result.exitCode).toBe(0);
  });

  it("should treat fflush('') as flush-all", async () => {
    const fs = new InMemoryFs({ "/tmp/f": "" });
    await fs.symlink("/tmp/f", "/tmp/alias");
    const env = new Bash({ fs, cwd: "/" });
    const result = await env.exec(
      `awk 'BEGIN { print "one" >> "/tmp/f"; print "two" >> "/tmp/f"; fflush(""); while ((getline x < "/tmp/alias") > 0) print x }'`,
    );
    expect(result.stdout).toBe("one\ntwo\n");
    expect(result.exitCode).toBe(0);
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

  it("should report a flush failure at exit instead of returning success", async () => {
    // 8 KiB filesystem quota: Bash construction itself retains ~6.5 KiB
    // (command stubs in /bin and /usr/bin plus /dev and /proc files),
    // leaving ~1.7 KiB free. The first small write fits, but the ~4 KiB
    // buffered remainder does not, so the exit flush fails.
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 8192 });
    const env = new Bash({ fs, cwd: "/" });
    const result = await env.exec(
      `awk 'BEGIN { print "aa" >> "/tmp/q.txt"; printf "%4000s\\n", "x" >> "/tmp/q.txt" }'`,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("failed to flush buffered output");
    // The first write survived; the unflushable remainder did not land.
    const after = await env.exec(`cat /tmp/q.txt`);
    expect(after.stdout).toBe("aa\n");
  });
});

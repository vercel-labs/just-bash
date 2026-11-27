import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("find predicates", () => {
  describe("-mmin (modification time in minutes)", () => {
    // Ages in whole minutes, the fraction dropped: recent is 2 (2.5 minutes
    // old), fresh is 0 (30 seconds old), old is 60.
    it.each([
      ["-mmin -2", "/dir/fresh.txt\n"],
      ["-mmin 0", "/dir/fresh.txt\n"],
      ["-mmin 2", "/dir/recent.txt\n"],
      ["-mmin +2", "/dir/old.txt\n"],
      ["-mmin -10", "/dir/fresh.txt\n/dir/recent.txt\n"],
    ])("find /dir -type f %s", async (predicate, expected) => {
      const now = Date.now();
      const env = new Bash({
        files: {
          "/dir/fresh.txt": { content: "fresh", mtime: new Date(now - 30_000) },
          "/dir/recent.txt": {
            content: "recent",
            mtime: new Date(now - 150_000),
          },
          "/dir/old.txt": { content: "old", mtime: new Date(now - 3_600_000) },
        },
      });
      const result = await env.exec(`find /dir -type f ${predicate} | sort`);
      expect(result.stdout).toBe(expected);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("rejects a non-numeric argument", async () => {
      const env = new Bash({ files: { "/dir/a.txt": "a" } });
      const result = await env.exec("find /dir -mmin soon");
      expect(result.stderr).toBe("find: invalid argument `soon' to `-mmin'\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("-newermt (modified after a date)", () => {
    const files = {
      "/dir/before.txt": {
        content: "before",
        mtime: new Date(Date.UTC(2026, 8, 19, 23, 0)),
      },
      "/dir/after.txt": {
        content: "after",
        mtime: new Date(Date.UTC(2026, 8, 20, 9, 0)),
      },
      "/dir/later.txt": {
        content: "later",
        mtime: new Date(Date.UTC(2026, 8, 21, 12, 0)),
      },
    };

    it.each([
      ["2026-09-20", "/dir/after.txt\n/dir/later.txt\n"],
      ["'2026-09-20 10:00'", "/dir/later.txt\n"],
      ["2026-09-20T08:59:59", "/dir/after.txt\n/dir/later.txt\n"],
    ])("reads %s in UTC without $TZ", async (date, expected) => {
      const env = new Bash({ files });
      const result = await env.exec(
        `find /dir -type f -newermt ${date} | sort`,
      );
      expect(result.stdout).toBe(expected);
      expect(result.exitCode).toBe(0);
    });

    it("reads a bare date in $TZ when it names a zone", async () => {
      const env = new Bash({ files });
      // New York is UTC-4 in September: after.txt (09:00 UTC) is 05:00 there.
      const result = await env.exec(
        "TZ=America/New_York find /dir -type f -newermt '2026-09-20 04:30' | sort",
      );
      expect(result.stdout).toBe("/dir/after.txt\n/dir/later.txt\n");
      const later = await env.exec(
        "TZ=America/New_York find /dir -type f -newermt '2026-09-20 05:00:01'",
      );
      expect(later.stdout).toBe("/dir/later.txt\n");
    });

    it("reads a date with a zone in that zone", async () => {
      const env = new Bash({ files });
      const result = await env.exec(
        "find /dir -type f -newermt 2026-09-21T00:00:00Z",
      );
      expect(result.stdout).toBe("/dir/later.txt\n");
    });

    it("combines with ! to find what is older", async () => {
      const env = new Bash({ files });
      const result = await env.exec("find /dir -type f ! -newermt 2026-09-20");
      expect(result.stdout).toBe("/dir/before.txt\n");
    });

    it.each([
      "yesterday",
      "2026-02-31",
      "09/20/2026",
      "'2026-09-20 10:60'",
      "'2026-09-20 24:00'",
      "2026-09-20T10:00:60",
    ])("refuses %s as GNU find refuses a date it cannot read", async (date) => {
      const env = new Bash({ files });
      const result = await env.exec(`find /dir -newermt ${date}`);
      const shown = date.replace(/^'|'$/g, "");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        `find: I cannot figure out how to interpret \`${shown}' as a date or time\n`,
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("-mtime (modification time)", () => {
    it("should find files modified today with -mtime 0", async () => {
      const now = new Date();
      const env = new Bash({
        files: {
          "/dir/today.txt": { content: "today", mtime: now },
          "/dir/old.txt": {
            content: "old",
            mtime: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
          },
        },
      });
      const result = await env.exec("find /dir -type f -mtime 0");
      expect(result.stdout).toBe("/dir/today.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should find files modified more than N days ago with -mtime +N", async () => {
      const now = new Date();
      const env = new Bash({
        files: {
          "/dir/recent.txt": { content: "recent", mtime: now },
          "/dir/old.txt": {
            content: "old",
            mtime: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          },
        },
      });
      const result = await env.exec("find /dir -type f -mtime +7");
      expect(result.stdout).toBe("/dir/old.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should find files modified less than N days ago with -mtime -N", async () => {
      const now = new Date();
      const env = new Bash({
        files: {
          "/dir/recent.txt": { content: "recent", mtime: now },
          "/dir/old.txt": {
            content: "old",
            mtime: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
          },
        },
      });
      const result = await env.exec("find /dir -type f -mtime -7");
      expect(result.stdout).toBe("/dir/recent.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should find files modified exactly N days ago with -mtime N", async () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const env = new Bash({
        files: {
          "/dir/two-days.txt": { content: "two days", mtime: twoDaysAgo },
          "/dir/today.txt": { content: "today", mtime: now },
        },
      });
      const result = await env.exec("find /dir -type f -mtime 2");
      expect(result.stdout).toBe("/dir/two-days.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-newer FILE", () => {
    it("should find files newer than reference file", async () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 60 * 1000);
      const env = new Bash({
        files: {
          "/ref.txt": { content: "ref", mtime: earlier },
          "/dir/newer.txt": { content: "newer", mtime: now },
          "/dir/older.txt": {
            content: "older",
            mtime: new Date(earlier.getTime() - 60 * 1000),
          },
        },
      });
      const result = await env.exec("find /dir -type f -newer /ref.txt");
      expect(result.stdout).toBe("/dir/newer.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should return nothing when reference file does not exist", async () => {
      const env = new Bash({
        files: {
          "/dir/file.txt": "content",
        },
      });
      const result = await env.exec(
        "find /dir -type f -newer /nonexistent.txt",
      );
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-size", () => {
    it("should find files larger than N bytes with -size +Nc", async () => {
      const env = new Bash({
        files: {
          "/dir/large.txt": "x".repeat(1000),
          "/dir/small.txt": "tiny",
        },
      });
      const result = await env.exec("find /dir -type f -size +100c");
      expect(result.stdout).toBe("/dir/large.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should find files smaller than N bytes with -size -Nc", async () => {
      const env = new Bash({
        files: {
          "/dir/large.txt": "x".repeat(1000),
          "/dir/small.txt": "tiny",
        },
      });
      const result = await env.exec("find /dir -type f -size -100c");
      expect(result.stdout).toBe("/dir/small.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should find files exactly N bytes with -size Nc", async () => {
      const env = new Bash({
        files: {
          "/dir/exact.txt": "12345",
          "/dir/other.txt": "1234",
        },
      });
      const result = await env.exec("find /dir -type f -size 5c");
      expect(result.stdout).toBe("/dir/exact.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should find files by size in kilobytes with -size Nk", async () => {
      const env = new Bash({
        files: {
          "/dir/large.txt": "x".repeat(2048),
          "/dir/small.txt": "tiny",
        },
      });
      const result = await env.exec("find /dir -type f -size +1k");
      expect(result.stdout).toBe("/dir/large.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should find files by size in megabytes with -size NM", async () => {
      const env = new Bash({
        files: {
          "/dir/small.txt": "tiny",
        },
      });
      const result = await env.exec("find /dir -type f -size -1M");
      expect(result.stdout).toBe("/dir/small.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-perm", () => {
    it("should find files with exact permission mode", async () => {
      const env = new Bash({
        files: {
          "/dir/exec.sh": { content: "#!/bin/bash", mode: 0o755 },
          "/dir/normal.txt": { content: "text", mode: 0o644 },
        },
      });
      const result = await env.exec("find /dir -type f -perm 755");
      expect(result.stdout).toBe("/dir/exec.sh\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should find files with all permission bits set using -perm -MODE", async () => {
      const env = new Bash({
        files: {
          "/dir/exec.sh": { content: "#!/bin/bash", mode: 0o755 },
          "/dir/readonly.txt": { content: "text", mode: 0o444 },
        },
      });
      // Files where at least user execute bit is set
      const result = await env.exec("find /dir -type f -perm -100");
      expect(result.stdout).toBe("/dir/exec.sh\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should find files with any permission bits set using -perm /MODE", async () => {
      const env = new Bash({
        files: {
          "/dir/exec.sh": { content: "#!/bin/bash", mode: 0o755 },
          "/dir/group-exec.txt": { content: "text", mode: 0o654 },
          "/dir/no-exec.txt": { content: "text", mode: 0o644 },
        },
      });
      // Files where any execute bit is set
      const result = await env.exec("find /dir -type f -perm /111");
      expect(result.stdout).toBe("/dir/exec.sh\n/dir/group-exec.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});

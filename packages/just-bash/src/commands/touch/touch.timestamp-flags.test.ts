import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { currentYearInTimezone } from "../timezone.js";

/**
 * `touch -t` and `touch -r` set the modification time.
 *
 * Both were accepted, had their argument skipped, and were then discarded, so
 * `touch -t 202001010000 f` left the file stamped with the current time and
 * said nothing about it. A script that stamps a file and then sorts by age
 * got the wrong answer with no failure anywhere to explain it.
 *
 * The `-t` stamp is `[[CC]YY]MMDDhhmm[.ss]`. Two-digit years pivot at 69:
 * 69-99 are 1969-1999, 00-68 are 2000-2068, which is the boundary POSIX
 * fixes for this format. With no year at all the stamp lands in the year the
 * shell's zone is currently in.
 *
 * Neither `-t` nor `-d` names a zone, so both are read in `$TZ`, or in UTC
 * when the shell has none. That is `date`'s contract, and it keeps the host's
 * own zone out of a timestamp nobody asked to be host-relative. Assertions
 * here are therefore on UTC components: a local-component assertion would
 * pass or fail depending on where the suite runs.
 *
 * Measured against GNU coreutils touch 9.2 with TZ set explicitly.
 */

async function mtimeOf(bash: Bash, path: string): Promise<Date> {
  return (await bash.fs.stat(path)).mtime;
}

describe("touch -t", () => {
  it.each([
    ["202601020304", "2026-01-02T03:04:00.000Z"],
    ["2601020304.05", "2026-01-02T03:04:05.000Z"],
    ["6901020304", "1969-01-02T03:04:00.000Z"],
    ["6801020304", "2068-01-02T03:04:00.000Z"],
  ])("stamps %s as UTC when the shell has no TZ", async (stamp, iso) => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec(`touch -t ${stamp} /w/f.txt`);
    expect(result.exitCode).toBe(0);
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(iso);
  });

  it("reads the stamp in $TZ when the shell sets one", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec(
      "TZ=America/Chicago touch -t 202601020304 /w/f.txt",
    );
    expect(result.exitCode).toBe(0);
    // 03:04 CST is 09:04 UTC.
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(
      "2026-01-02T09:04:00.000Z",
    );
  });

  // The year has to come from the zone the rest of the stamp is read in. The
  // two only disagree either side of a New Year boundary, which the unit tests
  // in timezone.test.ts pin against a fixed instant; this covers the wiring.
  it.each([
    ["", undefined],
    ["TZ=Pacific/Kiritimati ", "Pacific/Kiritimati"],
  ])("defaults a yearless stamp to the year %s is in", async (prefix, tz) => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec(`${prefix}touch -t 06150304 /w/f.txt`);
    expect(result.exitCode).toBe(0);
    expect((await mtimeOf(bash, "/w/f.txt")).getUTCFullYear()).toBe(
      currentYearInTimezone(tz),
    );
  });

  it("creates the file it stamps", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/keep": "" } });
    const result = await bash.exec("touch -t 202001010000 /w/new.txt");
    expect(result.exitCode).toBe(0);
    expect(await bash.fs.exists("/w/new.txt")).toBe(true);
    expect((await mtimeOf(bash, "/w/new.txt")).toISOString()).toBe(
      "2020-01-01T00:00:00.000Z",
    );
  });

  it.each([
    "99",
    "202613010000",
    "202002300000",
    "2020010100000",
  ])("rejects %s as a date format", async (stamp) => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec(`touch -t ${stamp} /w/f.txt`);
    expect(result.stderr).toBe(`touch: invalid date format '${stamp}'\n`);
    expect(result.exitCode).toBe(1);
  });

  it("reports a missing argument", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec("touch -t");
    expect(result.stderr).toBe("touch: option requires an argument -- 't'\n");
    expect(result.exitCode).toBe(1);
  });

  it("reads the stamp out of a combined short option", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec("touch -ct 202001010000 /w/f.txt");
    expect(result.exitCode).toBe(0);
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(
      "2020-01-01T00:00:00.000Z",
    );
  });
});

describe("touch -r", () => {
  it("copies the reference file's time", async () => {
    const bash = new Bash({
      cwd: "/w",
      files: { "/w/ref.txt": "", "/w/f.txt": "" },
    });
    const result = await bash.exec(
      "touch -t 202001020304 /w/ref.txt && touch -r /w/ref.txt /w/f.txt",
    );

    expect(result.exitCode).toBe(0);
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(
      "2020-01-02T03:04:00.000Z",
    );
  });

  it("reports a reference that does not exist", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec("touch -r /w/nope.txt /w/f.txt");
    expect(result.stderr).toBe(
      "touch: failed to get attributes of '/w/nope.txt': No such file or directory\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("reports why a reference could not be read", async () => {
    class UnreadableReferenceFs extends InMemoryFs {
      override async stat(path: string) {
        if (path === "/w/locked.txt") throw new Error("Permission denied");
        return super.stat(path);
      }
    }
    const fs = new UnreadableReferenceFs({
      "/w/locked.txt": "",
      "/w/f.txt": "",
    });
    const bash = new Bash({ fs, cwd: "/w" });

    const result = await bash.exec("touch -r /w/locked.txt /w/f.txt");

    // Reporting this as "No such file or directory" sends the caller looking
    // for a file that is right there.
    expect(result.stderr).toBe(
      "touch: failed to get attributes of '/w/locked.txt': Permission denied\n",
    );
    expect(result.exitCode).toBe(1);
  });
});

describe("touch -d", () => {
  it("reads a bare date as UTC when the shell has no TZ", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec("touch -d 2021-01-01 /w/f.txt");

    expect(result.exitCode).toBe(0);
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(
      "2021-01-01T00:00:00.000Z",
    );
  });

  // A bare date already read as UTC. A spelling carrying a time did not: it
  // reached `new Date`, which reads that as host-local, so the same script
  // stamped a different instant on a machine in a different zone and
  // disagreed with the identical `-t 202101011000`.
  it.each([
    ["2021-01-01 10:00:00", "2021-01-01T10:00:00.000Z"],
    ["2021-01-01T10:00:00", "2021-01-01T10:00:00.000Z"],
    ["2021-01-01T10:00:00.500", "2021-01-01T10:00:00.500Z"],
    ["2021/01/01 10:00:00", "2021-01-01T10:00:00.000Z"],
  ])("reads %s as UTC when the shell has no TZ", async (spelling, iso) => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec(`touch -d '${spelling}' /w/f.txt`);

    expect(result.exitCode).toBe(0);
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(iso);
  });

  // Fractional seconds fall outside the zone-aware grammar unless it accepts
  // them, and falling through means $TZ is ignored for that spelling alone.
  it("keeps the fraction and still honors $TZ", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec(
      "TZ=Asia/Tokyo touch -d '2021-01-01T10:00:00.500' /w/f.txt",
    );

    expect(result.exitCode).toBe(0);
    // 10:00 JST is 01:00 UTC, and the half second survives.
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(
      "2021-01-01T01:00:00.500Z",
    );
  });

  it("reads a bare date in $TZ when the shell sets one", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec(
      "TZ=America/Chicago touch -d 2021-01-01 /w/f.txt",
    );

    expect(result.exitCode).toBe(0);
    // Midnight CST is 06:00 UTC.
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(
      "2021-01-01T06:00:00.000Z",
    );
  });

  it("keeps an explicit offset over $TZ", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec(
      "TZ=America/Chicago touch -d 2021-01-01T00:00:00Z /w/f.txt",
    );

    expect(result.exitCode).toBe(0);
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(
      "2021-01-01T00:00:00.000Z",
    );
  });

  it("ignores a $TZ Intl cannot resolve and falls back to UTC", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec("TZ=Not/AZone touch -d 2021-01-01 /w/f.txt");

    expect(result.exitCode).toBe(0);
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(
      "2021-01-01T00:00:00.000Z",
    );
  });
});

describe("touch timestamp flag precedence", () => {
  it.each([
    ["-d 2021-01-01 -t 202201010000", "2022-01-01T00:00:00.000Z"],
    ["-t 202201010000 -d 2021-01-01", "2021-01-01T00:00:00.000Z"],
  ])("lets the last of %s win", async (flags, iso) => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.txt": "" } });
    const result = await bash.exec(`touch ${flags} /w/f.txt`);
    expect(result.exitCode).toBe(0);
    expect((await mtimeOf(bash, "/w/f.txt")).toISOString()).toBe(iso);
  });
});

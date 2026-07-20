import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/** Format date in UTC as YYYY-MM-DD (date defaults to UTC display) */
function formatUTCDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("date", () => {
  describe("format specifiers", () => {
    it("should format year with %Y", async () => {
      const env = new Bash();
      const result = await env.exec("date +%Y");
      expect(result.stdout).toMatch(/^\d{4}\n$/);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should format month with %m", async () => {
      const env = new Bash();
      const result = await env.exec("date +%m");
      expect(result.stdout).toMatch(/^(0[1-9]|1[0-2])\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format day with %d", async () => {
      const env = new Bash();
      const result = await env.exec("date +%d");
      expect(result.stdout).toMatch(/^(0[1-9]|[12]\d|3[01])\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format ISO date with %F", async () => {
      const env = new Bash();
      const result = await env.exec("date +%F");
      expect(result.stdout).toMatch(/^\d{4}-\d{2}-\d{2}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format time with %T", async () => {
      const env = new Bash();
      const result = await env.exec("date +%T");
      expect(result.stdout).toMatch(/^\d{2}:\d{2}:\d{2}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format hours with %H", async () => {
      const env = new Bash();
      const result = await env.exec("date +%H");
      expect(result.stdout).toMatch(/^([01]\d|2[0-3])\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format 12-hour with %I", async () => {
      const env = new Bash();
      const result = await env.exec("date +%I");
      expect(result.stdout).toMatch(/^(0[1-9]|1[0-2])\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format minutes with %M", async () => {
      const env = new Bash();
      const result = await env.exec("date +%M");
      expect(result.stdout).toMatch(/^[0-5]\d\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format seconds with %S", async () => {
      const env = new Bash();
      const result = await env.exec("date +%S");
      expect(result.stdout).toMatch(/^[0-5]\d\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format abbreviated weekday name with %a", async () => {
      const env = new Bash();
      const result = await env.exec("date +%a");
      expect(result.stdout).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format full weekday name with %A", async () => {
      const env = new Bash();
      const result = await env.exec("date +%A");
      expect(result.stdout).toMatch(
        /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\n$/,
      );
      expect(result.exitCode).toBe(0);
    });

    it("should format abbreviated month name with %b", async () => {
      const env = new Bash();
      const result = await env.exec("date +%b");
      expect(result.stdout).toMatch(
        /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\n$/,
      );
      expect(result.exitCode).toBe(0);
    });

    it("should format full month name with %B", async () => {
      const env = new Bash();
      const result = await env.exec("date +%B");
      expect(result.stdout).toMatch(
        /^(January|February|March|April|May|June|July|August|September|October|November|December)\n$/,
      );
      expect(result.exitCode).toBe(0);
    });

    it("should format unix timestamp with %s", async () => {
      const env = new Bash();
      const result = await env.exec("date +%s");
      const timestamp = Number.parseInt(result.stdout.trim(), 10);
      expect(timestamp).toBeGreaterThan(1700000000);
      expect(result.exitCode).toBe(0);
    });

    it("should format AM/PM with %p", async () => {
      const env = new Bash();
      const result = await env.exec("date +%p");
      expect(result.stdout).toMatch(/^(AM|PM)\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format 12-hour time with AM/PM using %r", async () => {
      const env = new Bash();
      const result = await env.exec("date +%r");
      expect(result.stdout).toMatch(/^\d{2}:\d{2}:\d{2} (AM|PM)\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format century with %C", async () => {
      const env = new Bash();
      const result = await env.exec("date +%C");
      expect(result.stdout).toMatch(/^\d{2}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format day of year with %j", async () => {
      const env = new Bash();
      const result = await env.exec("date +%j");
      expect(result.stdout).toMatch(/^\d{3}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format ISO week number with %V", async () => {
      const env = new Bash();
      const result = await env.exec("date +%V");
      expect(result.stdout).toMatch(/^\d{2}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format week number (Sunday start) with %U", async () => {
      const env = new Bash();
      const result = await env.exec("date +%U");
      expect(result.stdout).toMatch(/^\d{2}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should return 00 for %U when date is before the first Sunday", async () => {
      const env = new Bash();
      // 2024-01-01 is Monday — before the first Sunday (Jan 7) so week 00
      const result = await env.exec("date -u -d '2024-01-01T12:00:00Z' +%U");
      expect(result.stdout.trim()).toBe("00");
      expect(result.exitCode).toBe(0);
    });

    it("should return 01 for %U on the first Sunday of the year", async () => {
      const env = new Bash();
      // 2024-01-07 is Sunday — first Sunday so week 01
      const result = await env.exec("date -u -d '2024-01-07T12:00:00Z' +%U");
      expect(result.stdout.trim()).toBe("01");
      expect(result.exitCode).toBe(0);
    });

    it("should format week number (Monday start) with %W", async () => {
      const env = new Bash();
      const result = await env.exec("date +%W");
      expect(result.stdout).toMatch(/^\d{2}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should return 00 for %W when date is before the first Monday", async () => {
      const env = new Bash();
      // 2023-01-01 is Sunday — before the first Monday (Jan 2) so week 00
      const result = await env.exec("date -u -d '2023-01-01T12:00:00Z' +%W");
      expect(result.stdout.trim()).toBe("00");
      expect(result.exitCode).toBe(0);
    });

    it("should handle literal percent with %%", async () => {
      const env = new Bash();
      const result = await env.exec("date +%%");
      expect(result.stdout).toBe("%\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle combined format string", async () => {
      const env = new Bash();
      const result = await env.exec("date '+%Y-%m-%d %H:%M:%S'");
      expect(result.stdout).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should handle newline with %n", async () => {
      const env = new Bash();
      const result = await env.exec("date '+%Y%n%m'");
      expect(result.stdout).toMatch(/^\d{4}\n\d{2}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should handle tab with %t", async () => {
      const env = new Bash();
      const result = await env.exec("date '+%Y%t%m'");
      expect(result.stdout).toMatch(/^\d{4}\t\d{2}\n$/);
      expect(result.exitCode).toBe(0);
    });

    it("should format known specifiers correctly against a fixed UTC date", async () => {
      const env = new Bash();
      // 2024-03-15T14:30:45Z is a Friday in week 11, day 75 of the year
      const result = await env.exec(
        "date -u -d '2024-03-15T14:30:45Z' '+%Y %m %d %H %M %S %a %A %b %B %j %V %u %w'",
      );
      expect(result.stdout.trim()).toBe(
        "2024 03 15 14 30 45 Fri Friday Mar March 075 11 5 5",
      );
      expect(result.exitCode).toBe(0);
    });
  });

  describe("options", () => {
    it("should parse date string with -d (local noon stays same day)", async () => {
      const env = new Bash();
      const result = await env.exec("date -d '2024-01-15T12:00:00' +%Y-%m-%d");
      expect(result.stdout).toBe("2024-01-15\n");
      expect(result.exitCode).toBe(0);
    });

    it("should parse date string with --date (local noon stays same day)", async () => {
      const env = new Bash();
      const result = await env.exec("date --date='2024-06-20T12:00:00' +%F");
      expect(result.stdout).toBe("2024-06-20\n");
      expect(result.exitCode).toBe(0);
    });

    it("should output ISO format with -I", async () => {
      const env = new Bash();
      const result = await env.exec("date -I");
      expect(result.stdout).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.exitCode).toBe(0);
    });

    it("should output RFC format with -R", async () => {
      const env = new Bash();
      const result = await env.exec("date -R");
      expect(result.stdout).toMatch(
        /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}/,
      );
      expect(result.exitCode).toBe(0);
    });

    it("should output UTC timezone name with -u", async () => {
      const env = new Bash();
      const result = await env.exec("date -u +%Z");
      expect(result.stdout).toBe("UTC\n");
      expect(result.exitCode).toBe(0);
    });

    it("should output +0000 offset with -u", async () => {
      const env = new Bash();
      const result = await env.exec("date -u +%z");
      expect(result.stdout).toBe("+0000\n");
      expect(result.exitCode).toBe(0);
    });

    it("should output +0000 in -I format with -u", async () => {
      const env = new Bash();
      const result = await env.exec("date -u -I");
      expect(result.stdout.trim()).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0000$/,
      );
      expect(result.exitCode).toBe(0);
    });

    it("should output +0000 in -R format with -u", async () => {
      const env = new Bash();
      const result = await env.exec("date -u -R");
      expect(result.stdout).toContain("+0000");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("@timestamp parsing", () => {
    it("should parse Unix epoch with @0", async () => {
      const env = new Bash();
      const result = await env.exec("date -u -d '@0' '+%Y-%m-%dT%H:%M:%S'");
      expect(result.stdout.trim()).toBe("1970-01-01T00:00:00");
      expect(result.exitCode).toBe(0);
    });

    it("should parse arbitrary @timestamp", async () => {
      const env = new Bash();
      const result = await env.exec("date -u -d '@1705276800' +%F");
      expect(result.stdout.trim()).toBe("2024-01-15");
      expect(result.exitCode).toBe(0);
    });

    it("should reject @timestamp with non-numeric suffix", async () => {
      const env = new Bash();
      const result = await env.exec("date -d '@0abc' +%s");
      expect(result.stderr).toContain("invalid date");
      expect(result.exitCode).toBe(1);
    });

    it("rejects timestamps outside the exact and supported Date range", async () => {
      const env = new Bash();
      for (const timestamp of ["9007199254740992", "8640000000001"]) {
        const result = await env.exec(`date -d '@${timestamp}' +%s`);
        expect(result.stderr).toContain("invalid date");
        expect(result.exitCode).toBe(1);
      }
    });

    it("should treat bare numeric -d as a year, not epoch seconds (GNU compat)", async () => {
      // Pre-PR behaviour: -d '2024' falls through to new Date(s), which JS
      // parses as the year 2024 (YYYY -> 2024-01-01T00:00:00Z). The PR
      // briefly broke this by short-circuiting on /^\d+$/ and treating it as
      // epoch seconds (= 1970-01-01T00:33:44Z). Only the `@` prefix should
      // mean epoch seconds.
      const env = new Bash();
      const result = await env.exec("date -u -d '2024' +%Y");
      expect(result.stdout).toBe("2024\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("TZ-aware -d parsing", () => {
    it("should interpret bare ISO string in TZ context when TZ is set", async () => {
      const env = new Bash();
      // America/New_York in January is EST = UTC-5.
      // 2024-01-15T00:00:00 in New York = 2024-01-15T05:00:00Z = timestamp 1705294800.
      const result = await env.exec(
        "export TZ=America/New_York && date -d '2024-01-15T00:00:00' +%s",
      );
      expect(result.stdout.trim()).toBe("1705294800");
      expect(result.exitCode).toBe(0);
    });

    it("should not shift a string that already has an explicit UTC offset", async () => {
      const env = new Bash();
      // Z suffix means UTC regardless of TZ env var
      const result = await env.exec(
        "export TZ=America/New_York && date -d '2024-01-15T00:00:00Z' +%s",
      );
      expect(result.stdout.trim()).toBe("1705276800");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("relative dates", () => {
    it("should parse 'now'", async () => {
      const env = new Bash();
      const result = await env.exec("date -d now +%s");
      const timestamp = Number.parseInt(result.stdout.trim(), 10);
      const now = Math.floor(Date.now() / 1000);
      expect(Math.abs(timestamp - now)).toBeLessThan(5);
      expect(result.exitCode).toBe(0);
    });

    it("should parse 'today'", async () => {
      const env = new Bash();
      const result = await env.exec("date -d today +%F");
      const today = formatUTCDate(new Date());
      expect(result.stdout).toBe(`${today}\n`);
      expect(result.exitCode).toBe(0);
    });

    it("should parse 'yesterday'", async () => {
      const env = new Bash();
      const result = await env.exec("date -d yesterday +%F");
      const yesterday = formatUTCDate(new Date(Date.now() - 86400000));
      expect(result.stdout).toBe(`${yesterday}\n`);
      expect(result.exitCode).toBe(0);
    });

    it("should parse 'tomorrow'", async () => {
      const env = new Bash();
      const result = await env.exec("date -d tomorrow +%F");
      const tomorrow = formatUTCDate(new Date(Date.now() + 86400000));
      expect(result.stdout).toBe(`${tomorrow}\n`);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should error on invalid date string", async () => {
      const env = new Bash();
      const result = await env.exec("date -d 'invalid date string xyz'");
      expect(result.stderr).toContain("invalid date");
      expect(result.exitCode).toBe(1);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      const result = await env.exec("date --unknown");
      expect(result.stderr).toContain("unrecognized option");
      expect(result.exitCode).toBe(1);
    });

    it("should error on unknown short option", async () => {
      const env = new Bash();
      const result = await env.exec("date -z");
      expect(result.stderr).toContain("invalid option");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("help", () => {
    it("should show help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("date --help");
      expect(result.stdout).toContain("date");
      expect(result.stdout).toContain("FORMAT");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("default output", () => {
    it("should output default format without arguments", async () => {
      const env = new Bash();
      const result = await env.exec("date");
      // Default format: weekday month day HH:MM:SS TZ year. With no $TZ set
      // the display defaults to UTC, so the timezone field is "UTC".
      expect(result.stdout).toMatch(
        /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ 0-9][0-9] \d{2}:\d{2}:\d{2} UTC \d{4}\n$/,
      );
      expect(result.exitCode).toBe(0);
    });
  });

  describe("timezone", () => {
    it("should use UTC for %Z by default", async () => {
      const env = new Bash();
      const result = await env.exec("date +%Z");
      expect(result.stdout).toBe("UTC\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should use +0000 for %z by default", async () => {
      const env = new Bash();
      const result = await env.exec("date +%z");
      expect(result.stdout).toBe("+0000\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("-u should force UTC for %Z", async () => {
      const env = new Bash();
      const result = await env.exec("date -u +%Z");
      expect(result.stdout).toBe("UTC\n");
      expect(result.exitCode).toBe(0);
    });

    it("-u should force +0000 for %z", async () => {
      const env = new Bash();
      const result = await env.exec("date -u +%z");
      expect(result.stdout).toBe("+0000\n");
      expect(result.exitCode).toBe(0);
    });

    it("UTC time values are correct with -u on a fixed timestamp", async () => {
      const env = new Bash();
      const result = await env.exec(
        "date -u -d '2024-01-15T00:00:00Z' '+%H:%M:%S'",
      );
      expect(result.stdout).toBe("00:00:00\n");
      expect(result.exitCode).toBe(0);
    });

    it("UTC date is correct with -u on a fixed timestamp", async () => {
      const env = new Bash();
      const result = await env.exec("date -u -d '2024-01-15T23:59:59Z' '+%F'");
      expect(result.stdout).toBe("2024-01-15\n");
      expect(result.exitCode).toBe(0);
    });

    it("%Z and %z agree on the UTC default", async () => {
      // Without $TZ and without -u, display defaults to UTC, so %Z=UTC
      // and %z=+0000 always agree.
      const env = new Bash();
      const tzResult = await env.exec("date +%Z");
      const offsetResult = await env.exec("date +%z");
      expect(tzResult.stdout).toBe("UTC\n");
      expect(offsetResult.stdout).toBe("+0000\n");
    });

    it("invalid TZ falls back to UTC for both parsing and display", async () => {
      // When $TZ is set to a value Intl doesn't understand (e.g. Mars/Olympus),
      // isValidTimezone() treats it as unset. With the UTC-by-default contract,
      // an unset $TZ yields UTC display — so %Z is "UTC" and %z is "+0000",
      // consistent with the displayed time parts (and matching the no-$TZ
      // baseline).
      const env = new Bash();
      const baseline = await env.exec("date +'%Z %z'");
      const badTz = await env.exec(
        "export TZ=Not/A/Real/Zone && date +'%Z %z'",
      );
      expect(baseline.stdout).toBe("UTC +0000\n");
      expect(badTz.stdout).toBe("UTC +0000\n");
      expect(badTz.stderr).toBe("");
      expect(badTz.exitCode).toBe(0);
    });

    it("invalid TZ does not break -d parsing of bare ISO strings", async () => {
      // Without TZ validation, parseBareISOInTimezone would be called with
      // "Not/A/Real/Zone" and silently fail or fall back. We treat the bad
      // TZ as undefined so parsing falls through to JS `new Date(s)`; an
      // explicit-Z input is unambiguous regardless of parseTz.
      const env = new Bash();
      const result = await env.exec(
        "export TZ=Not/A/Real/Zone && date -d '2024-06-15T12:00:00Z' +%s",
      );
      // 2024-06-15T12:00:00Z = 1718452800
      expect(result.stdout).toBe("1718452800\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("TZ environment variable opts in to local time", () => {
    // Per PR #251: UTC is the default (non-disclosure of host timezone);
    // callers opt in to a specific zone by exporting $TZ.
    it("TZ=America/Los_Angeles makes %Z print PST or PDT", async () => {
      const env = new Bash();
      const result = await env.exec(
        "export TZ=America/Los_Angeles && date +%Z",
      );
      expect(result.stdout.trim()).toMatch(/^(PST|PDT)$/);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("TZ=America/Los_Angeles makes %z print -0800 or -0700", async () => {
      const env = new Bash();
      const result = await env.exec(
        "export TZ=America/Los_Angeles && date +%z",
      );
      expect(result.stdout.trim()).toMatch(/^-0[78]00$/);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});

describe("date strftime execution limits", () => {
  it("bounds directive processing with maxLoopIterations", async () => {
    const env = new Bash({ executionLimits: { maxLoopIterations: 2 } });
    const result = await env.exec("date +%Y%Y%Y");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("strftime: iteration limit exceeded");
  });

  it("bounds formatted output before returning it", async () => {
    const env = new Bash({ executionLimits: { maxOutputSize: 4 } });
    const result = await env.exec("date +%Y");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("strftime: output size limit exceeded");
  });
});

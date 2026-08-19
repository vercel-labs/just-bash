import { describe, expect, it } from "vitest";
import { currentYearInTimezone, parseBareISOInTimezone } from "./timezone.js";

/**
 * The year a `touch -t MMDDhhmm` stamp lands in, and the instant a zone-less
 * `-d` spelling names, both have to come from the shell's `$TZ` or from UTC.
 * Reading either off the host's own calendar makes the same script mean two
 * different things on two machines.
 */

// 23:30 UTC on New Year's Eve: already 2026 anywhere past UTC+00:30, still
// 2025 everywhere behind it.
const NEW_YEARS_EVE = new Date("2025-12-31T23:30:00Z");

describe("currentYearInTimezone", () => {
  it("uses the UTC year when there is no timezone", () => {
    expect(currentYearInTimezone(undefined, NEW_YEARS_EVE)).toBe(2025);
  });

  it.each([
    ["Pacific/Kiritimati", 2026],
    ["Asia/Tokyo", 2026],
    ["Europe/London", 2025],
    ["America/Chicago", 2025],
  ])("reads the year %s is in", (tz, year) => {
    expect(currentYearInTimezone(tz, NEW_YEARS_EVE)).toBe(year);
  });

  it("falls back to the UTC year for a zone Intl cannot resolve", () => {
    expect(currentYearInTimezone("Not/AZone", NEW_YEARS_EVE)).toBe(2025);
  });
});

describe("parseBareISOInTimezone", () => {
  it.each([
    ["2021-01-01", "2021-01-01T00:00:00.000Z"],
    ["2021-01-01T10:00:00", "2021-01-01T10:00:00.000Z"],
    ["2021-01-01 10:00:00", "2021-01-01T10:00:00.000Z"],
    ["2021-01-01T10:00:00.5", "2021-01-01T10:00:00.500Z"],
    ["2021-01-01T10:00:00.25", "2021-01-01T10:00:00.250Z"],
    ["2021-01-01T10:00:00.125", "2021-01-01T10:00:00.125Z"],
  ])("reads %s in UTC", (spelling, iso) => {
    expect(parseBareISOInTimezone(spelling, "UTC")?.toISOString()).toBe(iso);
  });

  // The zone reports whole seconds, so a fraction has to be carried around
  // the convergence loop rather than through it.
  it("keeps a fraction while shifting into a zone", () => {
    expect(
      parseBareISOInTimezone(
        "2021-01-01T10:00:00.500",
        "Asia/Tokyo",
      )?.toISOString(),
    ).toBe("2021-01-01T01:00:00.500Z");
  });

  it("returns null for a spelling outside the grammar", () => {
    expect(parseBareISOInTimezone("last tuesday", "UTC")).toBeNull();
  });
});

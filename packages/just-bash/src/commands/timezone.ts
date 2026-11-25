import { resolveTimezoneAt } from "./posix-timezone.js";

/**
 * Timezone-aware parsing shared by the commands that accept a date.
 *
 * `date` and `touch` both resolve `$TZ` the same way, as a zone Intl accepts
 * or a POSIX TZ string, so a stamp written by one is read back the same way by
 * the other. Without `$TZ`, both hand a zone-less spelling to the JS date
 * parser, which reads a bare date as UTC and a date with a time as host-local;
 * `touch -t`, which `date` has no counterpart for, reads in UTC.
 */

/**
 * True iff `tz` is a timezone Intl understands. Used to fall back to host-local
 * when `TZ` is set to a value Node's ICU build can't resolve, matching GNU
 * `date` (which silently uses local time on invalid `TZ`).
 */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Return what `tz` shows at instant `d`, encoded as a UTC Date whose
 * UTC components equal the wall-clock components shown in `tz`.
 * Returns null if Intl rejects the timezone or produces an unparseable date.
 */
function tzShownAsUtc(d: Date, tz: string): Date | null {
  const resolved = resolveTimezoneAt(tz, d.getTime());
  if (resolved === null) return null;
  // A POSIX TZ string resolves to the offset it has at this instant, which
  // is applied directly rather than handed to Intl as a zone.
  if (!("zone" in resolved)) {
    return new Date(d.getTime() + resolved.offsetSeconds * 1000);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolved.zone,
    era: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) =>
    Number.parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  // Intl writes a year below 1000 unpadded and one before 1 AD as BC, so the
  // wall clock is assembled from numbers rather than parsed from a string.
  const bc = parts.find((p) => p.type === "era")?.value === "BC";
  const shown = new Date(0);
  shown.setUTCFullYear(
    bc ? 1 - get("year") : get("year"),
    get("month") - 1,
    get("day"),
  );
  shown.setUTCHours(get("hour") % 24, get("minute"), get("second"), 0);
  return Number.isNaN(shown.getTime()) ? null : shown;
}

/**
 * Interpret a bare ISO datetime string (no explicit offset) as if it were
 * in the given named timezone, returning the corresponding UTC Date.
 *
 * Strategy: treat the requested components as a UTC instant, then iteratively
 * refine by asking the timezone what wall-clock it shows at the current
 * candidate and applying the residual delta. Outside DST the loop converges
 * in one pass; across a DST boundary it converges in two. Bounded at 3
 * iterations as a safety net.
 *
 * DST edge cases:
 * - Skipped wall times (spring-forward gap, e.g. America/New_York
 *   2024-03-10T02:30 does not exist): the loop oscillates and we return the
 *   last candidate. In practice this lands on the post-shift (EDT) instant
 *   for the gap. With `strict`, a wall time the zone never shows is null
 *   instead, as `touch -t` rejects one.
 * - Ambiguous wall times (fall-back, e.g. America/New_York 2024-11-03T01:30
 *   occurs twice): the seed's first shift uses the offset at the requested
 *   components-as-UTC, which is still EDT for the November case, so the
 *   loop converges on the earlier (EDT) instant.
 */
export function parseBareISOInTimezone(
  s: string,
  tz: string,
  { strict = false }: { strict?: boolean } = {},
): Date | null {
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/,
  );
  if (!m) return null;
  const [, yr, mo, dy, hr = "00", mn = "00", sc = "00", frac] = m;
  // The zone shows whole seconds, so a fractional part would read as permanent
  // drift and never converge. It is added back to the instant the loop settles,
  // to the millisecond the filesystem keeps.
  const milliseconds = frac
    ? Number.parseInt(frac.slice(0, 3).padEnd(3, "0"), 10)
    : 0;
  const requested = new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}Z`);
  if (Number.isNaN(requested.getTime())) return null;
  try {
    let candidate = requested;
    let converged = false;
    for (let pass = 0; pass < 3; pass++) {
      const shown = tzShownAsUtc(candidate, tz);
      if (shown === null) return null;
      const drift = shown.getTime() - requested.getTime();
      if (drift === 0) {
        converged = true;
        break;
      }
      candidate = new Date(candidate.getTime() - drift);
    }
    if (strict && !converged) return null;
    return new Date(candidate.getTime() + milliseconds);
  } catch {
    return null;
  }
}

/**
 * The calendar year `tz` is currently in, or the UTC year when the shell has
 * no `$TZ`. `touch -t` fills in a missing year from this, so a stamp written
 * either side of a New Year boundary lands in the year the shell's zone is
 * in rather than the host's.
 */
export function currentYearInTimezone(
  tz?: string,
  now: Date = new Date(),
): number {
  if (!tz) return now.getUTCFullYear();
  const resolved = resolveTimezoneAt(tz, now.getTime());
  if (resolved === null) return now.getUTCFullYear();
  if (!("zone" in resolved)) {
    return new Date(
      now.getTime() + resolved.offsetSeconds * 1000,
    ).getUTCFullYear();
  }
  try {
    const year = new Intl.DateTimeFormat("en-US", {
      timeZone: resolved.zone,
      year: "numeric",
    }).format(now);
    return Number.parseInt(year, 10) || now.getUTCFullYear();
  } catch {
    return now.getUTCFullYear();
  }
}

/**
 * True when `s` names its own zone: a trailing `Z` or numeric offset, or one
 * of the zone words the JS date parser honors (`UTC`, `GMT`, `EST`, ...).
 * Such a spelling means one instant wherever it is read, so `$TZ` stays out.
 */
export function hasExplicitZone(s: string): boolean {
  return (
    /Z$/i.test(s) ||
    /[+-]\d{2}:?\d{2}$/.test(s) ||
    /(?:^|[^a-z])(?:ut|utc|gmt|[ecmp][sd]t)(?:$|[^a-z])/i.test(s)
  );
}

/**
 * Read a spelling that names no zone in `tz`. The ISO grammar above is tried
 * first; anything else the JS date parser understands (`Jan 1 2021 10:00`) is
 * read with ` UTC` appended, so its wall clock comes out without passing
 * through the host's zone, and that wall clock is then resolved in `tz`.
 */
export function parseZonelessInTimezone(s: string, tz: string): Date | null {
  const iso = parseBareISOInTimezone(s, tz);
  if (iso) return iso;
  const wall = new Date(`${s} UTC`);
  if (Number.isNaN(wall.getTime())) return null;
  return parseBareISOInTimezone(wall.toISOString().slice(0, -1), tz);
}

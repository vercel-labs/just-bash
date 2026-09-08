/**
 * Timezone-aware parsing shared by the commands that accept a date.
 *
 * The sandbox default is UTC: the host timezone never leaks unless the caller
 * opts in by setting `$TZ`. `date` and `touch` both resolve `$TZ` the same way,
 * so a stamp written by one is read back the same way by the other.
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
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const h = Number.parseInt(get("hour"), 10) % 24;
  const shown = new Date(
    `${get("year")}-${get("month")}-${get("day")}T${String(h).padStart(2, "0")}:${get("minute")}:${get("second")}Z`,
  );
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
 *   for the gap.
 * - Ambiguous wall times (fall-back, e.g. America/New_York 2024-11-03T01:30
 *   occurs twice): the seed's first shift uses the offset at the requested
 *   components-as-UTC, which is still EDT for the November case, so the
 *   loop converges on the earlier (EDT) instant.
 */
export function parseBareISOInTimezone(s: string, tz: string): Date | null {
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/,
  );
  if (!m) return null;
  const [, yr, mo, dy, hr = "00", mn = "00", sc = "00", frac] = m;
  // The zone shows whole seconds, so a fractional part would read as permanent
  // drift and never converge. It is added back to the instant the loop settles.
  const milliseconds = frac ? Number.parseInt(frac.padEnd(3, "0"), 10) : 0;
  const requested = new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}Z`);
  if (Number.isNaN(requested.getTime())) return null;
  try {
    let candidate = requested;
    for (let pass = 0; pass < 3; pass++) {
      const shown = tzShownAsUtc(candidate, tz);
      if (shown === null) return null;
      const drift = shown.getTime() - requested.getTime();
      if (drift === 0) break;
      candidate = new Date(candidate.getTime() - drift);
    }
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
  try {
    const year = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
    }).format(now);
    return Number.parseInt(year, 10) || now.getUTCFullYear();
  } catch {
    return now.getUTCFullYear();
  }
}

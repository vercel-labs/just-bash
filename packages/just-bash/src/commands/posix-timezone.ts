/**
 * POSIX `TZ` strings, the form glibc reads when `TZ` is not a zone name:
 * `EST5`, `<+0530>-5:30`, `EST5EDT,M3.2.0,M11.1.0`. Intl accepts IANA names
 * but not this grammar, so a POSIX value is resolved to the offset it puts in
 * effect at a given instant, in seconds, and callers apply that offset
 * themselves. Handing it to Intl as a `+HH:MM` zone would not work on every
 * supported runtime (Node 20 rejects offset zones) and could not carry the
 * seconds the grammar allows.
 */

const SECONDS_PER_DAY = 86_400;
const MS_PER_SECOND = 1000;

/** A transition date: Julian `Jn`, zero-based `n`, or `Mm.w.d`. */
type TransitionDate =
  | { kind: "julian"; day: number }
  | { kind: "zero-based"; day: number }
  | { kind: "month"; month: number; week: number; weekday: number };

interface PosixRule {
  /** Seconds east of UTC in standard time. */
  stdOffset: number;
  dst?: {
    /** Seconds east of UTC in daylight time. */
    offset: number;
    start: TransitionDate;
    /** Seconds after local midnight, in standard time. */
    startTime: number;
    end: TransitionDate;
    /** Seconds after local midnight, in daylight time. */
    endTime: number;
  };
}

/** glibc's rule for a DST name given without one: the US rule. */
const DEFAULT_START: TransitionDate = {
  kind: "month",
  month: 3,
  week: 2,
  weekday: 0,
};
const DEFAULT_END: TransitionDate = {
  kind: "month",
  month: 11,
  week: 1,
  weekday: 0,
};
const DEFAULT_TRANSITION_TIME = 2 * 3600;

class Cursor {
  index = 0;
  constructor(readonly text: string) {}

  /** Consume `pattern`, which must be sticky, at the current position. */
  match(pattern: {
    lastIndex: number;
    exec(text: string): RegExpExecArray | null;
  }): string | null {
    pattern.lastIndex = this.index;
    const found = pattern.exec(this.text);
    if (!found) return null;
    this.index += found[0].length;
    return found[0];
  }

  get done(): boolean {
    return this.index >= this.text.length;
  }
}

function readName(cursor: Cursor): boolean {
  return (
    cursor.match(/<[A-Za-z0-9+-]{3,}>/y) !== null ||
    cursor.match(/[A-Za-z]{3,}/y) !== null
  );
}

/** `[+-]hh[:mm[:ss]]` as signed seconds, with `maxHours` bounding hh. */
function readTime(cursor: Cursor, maxHours: number): number | null {
  const text = cursor.match(/[+-]?\d{1,3}(?::\d{1,2}(?::\d{1,2})?)?/y);
  if (text === null) return null;
  const negative = text.startsWith("-");
  const [hours, minutes = 0, seconds = 0] = text
    .replace(/^[+-]/, "")
    .split(":")
    .map(Number);
  if (hours > maxHours || minutes > 59 || seconds > 59) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return negative ? -total : total;
}

function readDate(cursor: Cursor): TransitionDate | null {
  const text = cursor.match(/J\d{1,3}|\d{1,3}|M\d{1,2}\.\d\.\d/y);
  if (text === null) return null;
  if (text.startsWith("J")) {
    const day = Number(text.slice(1));
    return day >= 1 && day <= 365 ? { kind: "julian", day } : null;
  }
  if (text.startsWith("M")) {
    const [month, week, weekday] = text.slice(1).split(".").map(Number);
    if (month < 1 || month > 12 || week < 1 || week > 5 || weekday > 6) {
      return null;
    }
    return { kind: "month", month, week, weekday };
  }
  const day = Number(text);
  return day <= 365 ? { kind: "zero-based", day } : null;
}

/** `date[/time]`, the time defaulting to 02:00. */
function readTransition(
  cursor: Cursor,
): { date: TransitionDate; time: number } | null {
  const date = readDate(cursor);
  if (date === null) return null;
  if (cursor.match(/\//y) === null) {
    return { date, time: DEFAULT_TRANSITION_TIME };
  }
  // RFC 8536 extends the hour range to -167..167.
  const time = readTime(cursor, 167);
  return time === null ? null : { date, time };
}

/** Parse a POSIX TZ string, or null when `tz` is not one. */
function parsePosixTimezone(tz: string): PosixRule | null {
  const cursor = new Cursor(tz);
  if (!readName(cursor)) return null;
  // POSIX offsets count hours west of UTC; the rule stores seconds east.
  const stdWest = readTime(cursor, 24);
  if (stdWest === null) return null;
  const stdOffset = -stdWest;
  if (cursor.done) return { stdOffset };

  if (!readName(cursor)) return null;
  let dstOffset = stdOffset + 3600;
  if (!cursor.done && cursor.text[cursor.index] !== ",") {
    const dstWest = readTime(cursor, 24);
    if (dstWest === null) return null;
    dstOffset = -dstWest;
  }
  if (cursor.done) {
    return {
      stdOffset,
      dst: {
        offset: dstOffset,
        start: DEFAULT_START,
        startTime: DEFAULT_TRANSITION_TIME,
        end: DEFAULT_END,
        endTime: DEFAULT_TRANSITION_TIME,
      },
    };
  }
  if (cursor.match(/,/y) === null) return null;
  const start = readTransition(cursor);
  if (start === null || cursor.match(/,/y) === null) return null;
  const end = readTransition(cursor);
  if (end === null || !cursor.done) return null;
  return {
    stdOffset,
    dst: {
      offset: dstOffset,
      start: start.date,
      startTime: start.time,
      end: end.date,
      endTime: end.time,
    },
  };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Seconds from the epoch to local midnight of `date` in `year`. */
function transitionDay(year: number, date: TransitionDate): number {
  const yearStart = Date.UTC(year, 0, 1) / MS_PER_SECOND;
  switch (date.kind) {
    case "julian": {
      // `Jn` never counts February 29.
      const leapDay = isLeapYear(year) && date.day >= 60 ? 1 : 0;
      return yearStart + (date.day - 1 + leapDay) * SECONDS_PER_DAY;
    }
    case "zero-based":
      return yearStart + date.day * SECONDS_PER_DAY;
    case "month": {
      const monthStart = Date.UTC(year, date.month - 1, 1);
      const firstWeekday = new Date(monthStart).getUTCDay();
      const daysInMonth = new Date(Date.UTC(year, date.month, 0)).getUTCDate();
      let day =
        1 + ((date.weekday - firstWeekday + 7) % 7) + (date.week - 1) * 7;
      // Week 5 means the last such weekday, which may be the fourth.
      while (day > daysInMonth) day -= 7;
      return monthStart / MS_PER_SECOND + (day - 1) * SECONDS_PER_DAY;
    }
  }
}

/** Seconds east of UTC that `rule` puts in effect at `instantMs`. */
function offsetAt(rule: PosixRule, instantMs: number): number {
  const { dst } = rule;
  if (!dst) return rule.stdOffset;
  const seconds = Math.floor(instantMs / MS_PER_SECOND);
  const year = new Date(
    (seconds + rule.stdOffset) * MS_PER_SECOND,
  ).getUTCFullYear();
  const start = transitionDay(year, dst.start) + dst.startTime - rule.stdOffset;
  const end = transitionDay(year, dst.end) + dst.endTime - dst.offset;
  const inDst =
    start < end
      ? seconds >= start && seconds < end
      : !(seconds >= end && seconds < start);
  return inDst ? dst.offset : rule.stdOffset;
}

function isIntlTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * What `$TZ` resolves to at an instant: a zone Intl accepts, named as given,
 * or the offset a POSIX TZ string puts in effect then, in seconds east of UTC.
 */
type ResolvedTimezone = { zone: string } | { offsetSeconds: number };

/**
 * Resolve `tz` at `instantMs`: `tz` itself when Intl accepts it, the offset a
 * POSIX TZ string puts in effect at that instant, or null when `tz` is
 * neither. A leading `:` names a zone file in glibc, so what follows it is
 * read as a zone name only.
 */
export function resolveTimezoneAt(
  tz: string,
  instantMs: number,
): ResolvedTimezone | null {
  if (tz.startsWith(":")) {
    const name = tz.slice(1);
    return isIntlTimezone(name) ? { zone: name } : null;
  }
  if (isIntlTimezone(tz)) return { zone: tz };
  const rule = parsePosixTimezone(tz);
  return rule ? { offsetSeconds: offsetAt(rule, instantMs) } : null;
}

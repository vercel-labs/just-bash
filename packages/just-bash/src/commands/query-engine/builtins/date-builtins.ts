/**
 * Date/time-related jq builtins
 *
 * Handles date and time functions like now, gmtime, mktime, strftime, strptime, etc.
 */

import type { EvalContext } from "../evaluator.js";
import type { AstNode } from "../parser.js";
import type { QueryValue } from "../value-operations.js";

type EvalFn = (
  value: QueryValue,
  ast: AstNode,
  ctx: EvalContext,
) => QueryValue[];

const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const MAX_DATE_SECONDS = MAX_DATE_MILLISECONDS / 1000;
const ISO_UTC_FORMAT = "%Y-%m-%dT%H:%M:%SZ";

function dateFromTimestamp(value: number, operation: string): Date {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_DATE_SECONDS) {
    throw new Error(`${operation} timestamp is outside the supported range`);
  }
  return new Date(value * 1000);
}

function parseIsoUtc(value: string): Date | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/,
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match.map(Number);
  const milliseconds = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  return date;
}

/**
 * Handle date builtins that need evaluate function for arguments.
 * Returns null if the builtin name is not a date builtin handled here.
 */
export function evalDateBuiltin(
  value: QueryValue,
  name: string,
  args: AstNode[],
  ctx: EvalContext,
  evaluate: EvalFn,
): QueryValue[] | null {
  switch (name) {
    case "now":
      return [Date.now() / 1000];

    case "gmtime": {
      // Convert Unix timestamp to broken-down time array
      // jq format: [year, month(0-11), day(1-31), hour, minute, second, weekday(0-6), yearday(0-365)]
      if (typeof value !== "number") return [null];
      const date = dateFromTimestamp(value, "gmtime");
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth(); // 0-11
      const day = date.getUTCDate(); // 1-31
      const hour = date.getUTCHours();
      const minute = date.getUTCMinutes();
      const second = date.getUTCSeconds();
      const weekday = date.getUTCDay(); // 0=Sunday
      // Calculate day of year
      const startOfYear = Date.UTC(year, 0, 1);
      const yearday = Math.floor(
        (date.getTime() - startOfYear) / (24 * 60 * 60 * 1000),
      );
      return [[year, month, day, hour, minute, second, weekday, yearday]];
    }

    case "mktime": {
      // Convert broken-down time array to Unix timestamp
      if (!Array.isArray(value)) {
        throw new Error("mktime requires parsed datetime inputs");
      }
      const [year, month, day, hour = 0, minute = 0, second = 0] = value;
      if (typeof year !== "number" || typeof month !== "number") {
        throw new Error("mktime requires parsed datetime inputs");
      }
      const dateVal = Date.UTC(
        year,
        month,
        day ?? 1,
        hour ?? 0,
        minute ?? 0,
        second ?? 0,
      );
      return [Math.floor(dateVal / 1000)];
    }

    case "strftime": {
      // Format time as string
      if (args.length === 0) return [null];
      const fmtVals = evaluate(value, args[0], ctx);
      const fmt = fmtVals[0];
      if (typeof fmt !== "string") {
        throw new Error("strftime/1 requires a string format");
      }
      let date: Date;
      if (typeof value === "number") {
        // Unix timestamp
        date = dateFromTimestamp(value, "strftime");
      } else if (Array.isArray(value)) {
        // Broken-down time array
        const [year, month, day, hour = 0, minute = 0, second = 0] = value;
        if (typeof year !== "number" || typeof month !== "number") {
          throw new Error("strftime/1 requires parsed datetime inputs");
        }
        date = new Date(
          Date.UTC(year, month, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0),
        );
      } else {
        throw new Error("strftime/1 requires parsed datetime inputs");
      }
      // Simple strftime implementation
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      const pad = (n: number, w = 2) => String(n).padStart(w, "0");
      const result = fmt
        .replace(/%Y/g, String(date.getUTCFullYear()))
        .replace(/%m/g, pad(date.getUTCMonth() + 1))
        .replace(/%d/g, pad(date.getUTCDate()))
        .replace(/%H/g, pad(date.getUTCHours()))
        .replace(/%M/g, pad(date.getUTCMinutes()))
        .replace(/%S/g, pad(date.getUTCSeconds()))
        .replace(/%A/g, dayNames[date.getUTCDay()])
        .replace(/%B/g, monthNames[date.getUTCMonth()])
        .replace(/%Z/g, "UTC")
        .replace(/%%/g, "%");
      return [result];
    }

    case "strptime": {
      // Parse string to broken-down time array
      if (args.length === 0) return [null];
      if (typeof value !== "string") {
        throw new Error("strptime/1 requires a string input");
      }
      const fmtVals = evaluate(value, args[0], ctx);
      const fmt = fmtVals[0];
      if (typeof fmt !== "string") {
        throw new Error("strptime/1 requires a string format");
      }
      if (fmt !== ISO_UTC_FORMAT) {
        throw new Error(`strptime format is not supported: ${fmt}`);
      }
      const date = parseIsoUtc(value);
      if (date) {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const day = date.getUTCDate();
        const hour = date.getUTCHours();
        const minute = date.getUTCMinutes();
        const second = date.getUTCSeconds();
        const weekday = date.getUTCDay();
        const startOfYear = Date.UTC(year, 0, 1);
        const yearday = Math.floor(
          (date.getTime() - startOfYear) / (24 * 60 * 60 * 1000),
        );
        return [[year, month, day, hour, minute, second, weekday, yearday]];
      }
      throw new Error(`Cannot parse date: ${value}`);
    }

    case "fromdate": {
      // Parse ISO 8601 date string to Unix timestamp
      if (typeof value !== "string") {
        throw new Error("fromdate requires a string input");
      }
      const date = parseIsoUtc(value);
      if (!date) {
        throw new Error(
          `date "${value}" does not match format "${ISO_UTC_FORMAT}"`,
        );
      }
      return [Math.floor(date.getTime() / 1000)];
    }

    case "todate": {
      // Convert Unix timestamp to ISO 8601 date string
      if (typeof value !== "number") {
        throw new Error("todate requires a number input");
      }
      const date = dateFromTimestamp(value, "todate");
      return [date.toISOString().replace(/\.\d{3}Z$/, "Z")];
    }

    default:
      return null;
  }
}

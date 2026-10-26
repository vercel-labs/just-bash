/**
 * Detects control messages that Node's `--watch` mode relays from worker
 * threads. When `WATCH_REPORT_DEPENDENCIES` is set in a watched process,
 * Node's loader posts `{ "watch:import": [url] }` (ESM) and
 * `{ "watch:require": [...] }` (CJS) from every worker thread, and `Worker`
 * forwards those messages to main-thread listeners. They are Node internals,
 * not command responses.
 *
 * The match is the exact relay shape: exactly one own key, whose value is an
 * array of strings. Anything else — in particular a payload that carries a
 * protocol token or other response fields alongside a reserved key — is not
 * a relay message and goes through normal response validation.
 */
export function isNodeWatchModeMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return false;
  }
  const names = Object.keys(msg);
  if (names.length !== 1) {
    return false;
  }
  const key = names[0];
  if (key !== "watch:import" && key !== "watch:require") {
    return false;
  }
  const value = (msg as { "watch:import"?: unknown; "watch:require"?: unknown })[
    key
  ];
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

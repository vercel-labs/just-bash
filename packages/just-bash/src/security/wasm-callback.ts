import { sanitizeErrorMessage } from "../fs/sanitize-error.js";

export function sanitizeUnknownError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeErrorMessage(message);
}

/**
 * Wrap WASM-to-JS callbacks so callback failures are surfaced as sanitized
 * internal errors without leaking host/internal paths.
 */
export function wrapWasmCallback<TArgs extends unknown[], TResult>(
  component: string,
  phase: string,
  callback: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  return (...args: TArgs): TResult => {
    try {
      return callback(...args);
    } catch (error) {
      const message = sanitizeUnknownError(error);
      throw new Error(`${component} ${phase} callback failed: ${message}`);
    }
  };
}

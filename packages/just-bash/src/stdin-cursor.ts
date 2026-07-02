/**
 * StdinCursor — a shared, position-tracking stdin handle.
 *
 * Replaces the `groupStdin: string` pattern where the remaining content was
 * copied into a new string on every consume. Instead a single string is held
 * for the lifetime of the while-loop (or group/subshell) and a numeric
 * position advances through it, making every read O(1) instead of O(n).
 *
 * The cursor is shared by reference: the while-loop installs one, and every
 * command that runs inside the loop body (including the first command in a
 * pipeline) sees the same object. Reads advance the shared position, so the
 * next `while IFS= read -r line` picks up exactly where the last consumer
 * left off — including `cat`, `grep`, and any other stdin-consuming command.
 *
 * Non-first pipeline commands receive `undefined` for the cursor so they
 * cannot accidentally fall back to the loop's stdin.
 */
export class StdinCursor {
  private _pos = 0;

  constructor(private readonly _content: string) {}

  /** Bytes remaining from current position to end. */
  get remaining(): string {
    return this._content.slice(this._pos);
  }

  /** True when all content has been consumed. */
  get exhausted(): boolean {
    return this._pos >= this._content.length;
  }

  /**
   * Advance the position by `n` bytes (clamped to the content length).
   * Used by `read` after it has parsed how many bytes it consumed.
   */
  advance(n: number): void {
    this._pos = Math.min(this._pos + n, this._content.length);
  }

  /**
   * Consume and return all remaining content, advancing to the end.
   * Used by `file-reader.ts` so that stdin-consuming commands (cat, grep,
   * head, sed, awk, …) automatically advance the cursor.
   */
  readAll(): string {
    const rest = this._content.slice(this._pos);
    this._pos = this._content.length;
    return rest;
  }
}

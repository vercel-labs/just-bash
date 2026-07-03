import { type ByteString, unsafeBytesFromLatin1 } from "./encoding.js";

/**
 * StdinStream — the single representation of standard input.
 *
 * Models stdin the way bash models a file descriptor: one object holding
 * the content bytes and a read offset, shared by reference. A while loop
 * with `< file`, every command in its body, and every pipeline stage that
 * inherits stdin all see the same object, so consuming input in one place
 * advances it everywhere — including across subshell boundaries, where a
 * copied string field would silently lose the advance.
 *
 * Reading is consuming: `readAll()` returns the remaining bytes and
 * advances to EOF, so a command cannot read stdin and forget to consume
 * it. Commands that forward stdin to a subcommand without consuming it
 * (`timeout`, `time`, `env`) use `peek()`. Partial consumers (`read`,
 * `mapfile`) use `peek()` + `advance(n)`.
 *
 * Content is a latin1-shaped byte buffer (one char = one byte) per the
 * pipeline contract in encoding.ts. Redirect/heredoc sources UTF-8 encode
 * text before constructing a stream.
 */
export class StdinStream {
  private pos = 0;

  constructor(private readonly content: string = "") {}

  /** Remaining bytes without consuming them (for stdin forwarders). */
  peek(): ByteString {
    return unsafeBytesFromLatin1(this.content.slice(this.pos));
  }

  /** Consume and return all remaining bytes, advancing to EOF. */
  readAll(): ByteString {
    const rest = this.content.slice(this.pos);
    this.pos = this.content.length;
    return unsafeBytesFromLatin1(rest);
  }

  /**
   * Consume `n` bytes without returning them (clamped to the remaining
   * length). Partial consumers call `peek()` to parse, then advance by
   * what they actually used.
   */
  advance(n: number): void {
    if (n > 0) {
      this.pos = Math.min(this.pos + n, this.content.length);
    }
  }

  /** True when all input has been consumed. */
  get exhausted(): boolean {
    return this.pos >= this.content.length;
  }
}

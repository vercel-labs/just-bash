import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * The two streams reaching one descriptor need not agree on a shape: a
 * byte-shaped stdout is a buffer of bytes already chosen, while stderr is JS
 * text whose bytes are chosen on the way out. Merging them under a single
 * encoding rewrites one or the other, so each piece is encoded by the shape it
 * was recorded with.
 *
 * `café` is the fixture: `c a f 0xC3 0xA9` as UTF-8, but `c a f 0xE9` if a
 * decoded string is written as bytes.
 */
const setup = async (): Promise<Bash> => {
  const env = new Bash();
  await env.exec("printf 'caf\\xc3\\xa9\\n' > /bytes.txt");
  return env;
};

/** `cat` of a UTF-8 file, so stdout is bytes, beside a Unicode stderr. */
const MIXED = "{ cat /bytes.txt; printf 'gr\\xc3\\xbcn\\n' 1>&2; }";
const UTF8 = "   c   a   f 303 251  \\n   g   r 303 274   n  \\n\n";

describe("fd duplication merges by each stream's own shape", () => {
  it("writes both to a file as UTF-8", async () => {
    const env = await setup();
    await env.exec(`${MIXED} > /out 2>&1`);
    const dumped = await env.exec("od -An -c /out");
    expect(dumped.stdout).toBe(UTF8);
    expect(dumped.stderr).toBe("");
  });

  it("writes both to a descriptor as UTF-8", async () => {
    const env = await setup();
    await env.exec(`exec 3> /out; ${MIXED} >&3 2>&3`);
    const dumped = await env.exec("od -An -c /out");
    expect(dumped.stdout).toBe(UTF8);
    expect(dumped.stderr).toBe("");
  });

  it("puts both on a |& pipe as UTF-8", async () => {
    const env = await setup();
    const dumped = await env.exec(`${MIXED} |& od -An -c`);
    expect(dumped.stdout).toBe(UTF8);
    expect(dumped.stderr).toBe("");
  });

  it("hands both back to the caller as text", async () => {
    const env = await setup();
    const result = await env.exec(`${MIXED} 2>&1`);
    expect(result.stdout).toBe("café\ngrün\n");
    expect(result.stderr).toBe("");
  });
});

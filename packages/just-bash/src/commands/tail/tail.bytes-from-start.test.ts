import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("tail -c +N", () => {
  const run = async (script: string) => {
    const env = new Bash();
    return env.exec(script);
  };

  it("starts at byte N of stdin", async () => {
    const result = await run("printf 'one\\ntwo\\n' | tail -c +4");
    expect(result.stdout).toBe("\ntwo\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("starts at byte N of a file", async () => {
    const env = new Bash({ files: { "/test.txt": "one\ntwo\n" } });
    const result = await env.exec("tail -c +5 /test.txt");
    expect(result.stdout).toBe("two\n");
  });

  it("prints everything for +1 and +0", async () => {
    const result = await run(
      "printf 'one\\ntwo\\n' | tail -c +1; printf 'one\\ntwo\\n' | tail -c +0",
    );
    expect(result.stdout).toBe("one\ntwo\none\ntwo\n");
  });

  it("prints the last byte for +SIZE and nothing beyond the end", async () => {
    const result = await run(
      "printf 'one\\ntwo\\n' | tail -c +8; " +
        "printf 'one\\ntwo\\n' | tail -c +9; " +
        "printf 'one\\ntwo\\n' | tail -c +100",
    );
    expect(result.stdout).toBe("\n");
    expect(result.exitCode).toBe(0);
  });

  it("accepts the attached and long forms", async () => {
    const result = await run(
      "printf 'one\\ntwo\\n' | tail -c+5; printf 'one\\ntwo\\n' | tail --bytes=+5",
    );
    expect(result.stdout).toBe("two\ntwo\n");
  });

  it("counts bytes rather than characters", async () => {
    // 中 = E4 B8 AD, 文 = E6 96 87.
    const env = new Bash();
    await env.exec('printf "中文" > /utf8.txt');

    const whole = await env.exec("tail -c +4 /utf8.txt");
    expect(whole.stdout).toBe("文");

    await env.exec("tail -c +2 /utf8.txt > /out.bin");
    const out = await env.fs.readFileBuffer("/out.bin");
    expect(Array.from(out)).toEqual([0xb8, 0xad, 0xe6, 0x96, 0x87]);
  });

  it("leaves -c N (last N bytes) unchanged", async () => {
    const result = await run(
      "printf 'one\\ntwo\\n' | tail -c 4; printf 'one\\ntwo\\n' | tail -c 0",
    );
    expect(result.stdout).toBe("two\n");
  });

  it("does not change head -c, where a leading + is ignored", async () => {
    const result = await run("printf 'one\\ntwo\\n' | head -c +3");
    expect(result.stdout).toBe("one");
  });
});

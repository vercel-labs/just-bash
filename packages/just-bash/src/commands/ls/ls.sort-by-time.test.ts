import { beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * `-t` orders by modification time, newest first.
 *
 * The flag was parsed and then discarded, so `ls -lt` returned the same
 * name-ordered listing as `ls -l` while `--help` advertised "sort by time,
 * newest first". Nothing failed and no diagnostic appeared: the answer to
 * "what changed most recently here" was simply the alphabetically first
 * name.
 *
 * -S and -t are mutually exclusive in effect but not an error together;
 * whichever appears last on the command line decides. Both sort descending
 * and both fall back to the name when two entries tie, so the listing does
 * not depend on filesystem order. -r reverses the result, tiebreak included.
 *
 * Measured against GNU coreutils ls 9.2, cross-checked against BSD ls
 * (macOS 15), which agrees on ordering, ties and the -St precedence.
 */

const SETUP = [
  "printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n' > /w/big-old.txt",
  "printf 'a\\n' > /w/small-new.txt",
  "printf 'bb\\n' > /w/mid-tie-b.txt",
  "printf 'cc\\n' > /w/mid-tie-a.txt",
  "touch -d 2020-01-01 /w/big-old.txt",
  "touch -d 2026-01-01 /w/small-new.txt",
  "touch -d 2023-01-01 /w/mid-tie-a.txt",
  "touch -d 2023-01-01 /w/mid-tie-b.txt",
].join(" && ");

describe("ls -t sorts by modification time", () => {
  let bash: Bash;

  beforeEach(async () => {
    bash = new Bash({ cwd: "/w", files: { "/w/.keep": "" } });
    const setup = await bash.exec(SETUP);
    expect(setup.exitCode).toBe(0);
  });

  it("lists the newest entry first", async () => {
    const result = await bash.exec("ls -1t");
    expect(result.stdout).toBe(
      "small-new.txt\nmid-tie-a.txt\nmid-tie-b.txt\nbig-old.txt\n",
    );
  });

  it("differs from the default name order", async () => {
    const byTime = await bash.exec("ls -1t");
    const byName = await bash.exec("ls -1");
    expect(byTime.stdout).not.toBe(byName.stdout);
    expect(byName.stdout).toBe(
      "big-old.txt\nmid-tie-a.txt\nmid-tie-b.txt\nsmall-new.txt\n",
    );
  });

  it("reverses under -tr", async () => {
    const result = await bash.exec("ls -1tr");
    expect(result.stdout).toBe(
      "big-old.txt\nmid-tie-b.txt\nmid-tie-a.txt\nsmall-new.txt\n",
    );
  });

  it("breaks equal timestamps by name", async () => {
    const result = await bash.exec("ls -1t");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines.indexOf("mid-tie-a.txt")).toBeLessThan(
      lines.indexOf("mid-tie-b.txt"),
    );
  });

  it("breaks equal sizes by name under -S", async () => {
    const result = await bash.exec("ls -1S");
    expect(result.stdout).toBe(
      "big-old.txt\nmid-tie-a.txt\nmid-tie-b.txt\nsmall-new.txt\n",
    );
  });

  it.each([
    ["-1St", "small-new.txt\nmid-tie-a.txt\nmid-tie-b.txt\nbig-old.txt\n"],
    ["-1tS", "big-old.txt\nmid-tie-a.txt\nmid-tie-b.txt\nsmall-new.txt\n"],
    ["-1 -S -t", "small-new.txt\nmid-tie-a.txt\nmid-tie-b.txt\nbig-old.txt\n"],
    ["-1 -t -S", "big-old.txt\nmid-tie-a.txt\nmid-tie-b.txt\nsmall-new.txt\n"],
  ])("lets the last of -S and -t win for %s", async (flags, expected) => {
    const result = await bash.exec(`ls ${flags}`);
    expect(result.stdout).toBe(expected);
  });

  it("orders file operands by time", async () => {
    const result = await bash.exec("ls -1t big-old.txt small-new.txt");
    expect(result.stdout).toBe("small-new.txt\nbig-old.txt\n");
  });
});

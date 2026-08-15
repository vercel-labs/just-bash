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

describe("ls -R orders sections by the active sort key", () => {
  const NESTED = {
    "/w/aaa/f": "",
    "/w/zzz/f": "",
  };

  async function stamped() {
    const bash = new Bash({ cwd: "/w", files: NESTED });
    const setup = await bash.exec(
      "touch -d 2020-01-01 /w/aaa && touch -d 2026-01-01 /w/zzz",
    );
    expect(setup.exitCode).toBe(0);
    return bash;
  }

  it("emits the newest section first under -Rt", async () => {
    const result = await (await stamped()).exec("ls -Rt /w");
    expect(result.stdout).toBe("/w:\nzzz\naaa\n\n/w/zzz:\nf\n\n/w/aaa:\nf\n");
  });

  it("keeps name order under plain -R", async () => {
    const result = await (await stamped()).exec("ls -R /w");
    expect(result.stdout).toBe("/w:\naaa\nzzz\n\n/w/aaa:\nf\n\n/w/zzz:\nf\n");
  });

  it("reverses the sections under -Rtr", async () => {
    const result = await (await stamped()).exec("ls -Rtr /w");
    expect(result.stdout).toBe("/w:\naaa\nzzz\n\n/w/aaa:\nf\n\n/w/zzz:\nf\n");
  });
});

/**
 * Without -L, ls reads the link itself. Verified on BSD ls (macOS 15): a
 * symlink stamped 2026 whose target is stamped 2020 sorts first under -t.
 */
describe("ls -t reads the link, not its target", () => {
  it("orders a symlink by its own mtime", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/.keep": "" } });
    const setup = await bash.exec(
      [
        "printf 'x\\n' > /w/target.txt",
        "touch -d 2020-01-01 /w/target.txt",
        "printf 'y\\n' > /w/middle.txt",
        "touch -d 2023-01-01 /w/middle.txt",
        "ln -s target.txt /w/link",
      ].join(" && "),
    );
    expect(setup.exitCode).toBe(0);

    // Following the link would give it the target's 2020 stamp, putting it
    // last behind middle.txt rather than first.
    const result = await bash.exec("ls -1t");
    expect(result.stdout).toBe("link\nmiddle.txt\ntarget.txt\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

// Automa N1: newly recorded native ripgrep 14.1.1 fixtures; older 15.2 fixtures are unchanged.
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("rg N1 compatibility (ripgrep 14.1.1)", () => {
  let testDir: string;
  beforeAll(() => {
    if (process.env.RECORD_FIXTURES === "force") {
      if (
        !execFileSync("rg", ["--version"], { encoding: "utf8" }).startsWith(
          "ripgrep 14.1.1\n",
        )
      ) {
        throw new Error("Record N1 fixtures with ripgrep 14.1.1");
      }
    }
  });
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const files = {
    "f.txt": "aaa two two zzz\nshort\ntwo\n你好two好\n😀two\nlastx",
    "a.ts": "Two\ntwo\n",
    ".hidden": "two\n",
    "ignored.txt": "two\n",
    ".ignore": "ignored.txt\n",
    binary: "two\0two\n",
  };
  const cases = [
    "--max-columns 5 two f.txt",
    "-M5 . f.txt",
    "-M5 --max-columns-preview . f.txt",
    "-M5 --max-columns-preview two f.txt",
    "--max-columns=5 --max-columns-preview --no-max-columns-preview two f.txt",
    "-M0 two f.txt",
    "-nM5 two f.txt",
    "-M+5 two f.txt",
    "-M3 -o two f.txt",
    "-M2 -o two f.txt",
    "-M2 -v -r x two f.txt",
    "-M2 -o --max-columns-preview two f.txt",
    "-M5 -v two f.txt",
    "-M5 -C1 two f.txt",
    "-M5 --max-columns-preview -B1 short f.txt",
    "-M5 --max-columns-preview -A1 short f.txt",
    "-M5 --passthru two f.txt",
    "-M5 -r x two f.txt",
    "-M5 --max-columns-preview -r x two f.txt",
    "-M5 -c two f.txt",
    "-M5 -l two f.txt",
    "-M5 -U two f.txt",
    "-M5 -U --max-columns-preview two f.txt",
    "--heading --no-heading two .",
    "--no-heading --heading two .",
    "--no-messages two missing",
    "--no-messages two f.txt missing",
    "--no-messages --files missing",
    "two .",
    "two ./f.txt",
    "two < /dev/null",
    "--files -g '!*.ts'",
    "-F -i two a.ts",
    "-uu two .",
    "--hidden -u two .",
    "--no-ignore -u two .",
    "-uuu two .",
    "--binary two binary",
    "-uuu -l two .",
    "-uuu -c two .",
    "-uuu --text two binary",
    "--text -uuu two binary",
  ];
  for (const args of cases) {
    it(args, async () => {
      const env = await setupFiles(testDir, files);
      await compareOutputs(
        env,
        testDir,
        `RIPGREP_CONFIG_PATH= rg --sort path -n -s --color never ${args}`,
      );
    });
  }

  for (const preview of ["", "--max-columns-preview"]) {
    it(`vimgrep ${preview}`, async () => {
      const env = await setupFiles(testDir, { f: "aaa two two zzz\ntwo\n" });
      await compareOutputs(
        env,
        testDir,
        `RIPGREP_CONFIG_PATH= rg -n -M5 --vimgrep ${preview} two f`,
      );
    });
  }

  it("follows a symlink with -L", async () => {
    const env = await setupFiles(testDir, { "target.txt": "two\n" });
    await compareOutputs(
      env,
      testDir,
      "ln -s target.txt link; RIPGREP_CONFIG_PATH= rg -n -L two link",
    );
  });
  it("formats stdin max-columns", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "printf 'long two\ntwo\n' | RIPGREP_CONFIG_PATH= rg -n -M5 two",
    );
  });
});

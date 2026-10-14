import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  isRecordMode,
  setupFiles,
} from "./fixture-runner.js";

// Fixtures are recorded with ripgrep 15.2.0, not a host-dependent rg in CI.
// Heading/file separators and explicit-file detection:
// https://github.com/BurntSushi/ripgrep/blob/15.2.0/crates/core/flags/hiargs.rs#L176-L195
// Context and max-count interactions:
// https://github.com/BurntSushi/ripgrep/blob/15.2.0/crates/printer/src/standard.rs#L2701-L2797
describe("rg Grep tool compatibility (ripgrep 15.2.0)", () => {
  let testDir: string;

  beforeAll(() => {
    if (isRecordMode) {
      const version = execFileSync("rg", ["--version"], { encoding: "utf8" });
      if (!version.startsWith("ripgrep 15.2.0\n")) {
        throw new Error("Record these fixtures with ripgrep 15.2.0");
      }
    }
  });

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("accepts the exact baseline command", async () => {
    const env = await setupFiles(testDir, { "a.ts": "permission\n" });
    await compareOutputs(
      env,
      testDir,
      "RIPGREP_CONFIG_PATH= rg --line-number --heading --color never -- permission .",
    );
  });

  // Six optional flags give 64 combinations. Use an uppercase pattern so the
  // preserved just-bash smart-case default agrees with rg without -i.
  const optionalFlags = [
    "-i",
    "--type ts",
    "--glob '*.ts'",
    "-C 1",
    "--max-count 2",
    "--files-with-matches",
  ];
  for (let mask = 0; mask < 64; mask++) {
    const flags = optionalFlags.filter((_, index) => mask & (1 << index));
    it(`supports optional flags: ${flags.join(" ") || "none"}`, async () => {
      const env = await setupFiles(testDir, {
        "a.ts":
          "before\nPermission Permission\npermission\nPermission\nafter\ngap\ngap\nPermission\nafter\n",
        "b.ts": "Permission\nafter\n",
        "c.py": "permission\nPermission\n",
        "empty.ts": "nothing\n",
      });
      await compareOutputs(
        env,
        testDir,
        `RIPGREP_CONFIG_PATH= rg --sort path --line-number --heading --color never ${flags.join(" ")} -- Permission .`,
      );
    });
  }

  const cases = [
    ["single explicit file", "-- Permission a.ts"],
    ["one matching file in a directory", "--glob a.ts -- Permission ."],
    ["separated context groups", "-C 1 -- Permission a.ts"],
    ["adjacent matching lines", "-C 1 -- Permission b.ts"],
    [
      "after-context past the match limit",
      "-C 1 --max-count 1 -- Permission b.ts",
    ],
    ["zero match limit", "--max-count 0 -- Permission ."],
    ["no matches", "-- Missing ."],
    ["leading-dash pattern and path", "-- -Permission -file.ts"],
    ["literal help pattern", "-- --help -file.ts"],
    ["literal type-list pattern", "-- --type-list -file.ts"],
    ["negative glob", "--glob '!b.ts' -- Permission ."],
    ["type and glob filters", "--type ts --glob '*.py' -- Permission ."],
    ["glob overrides ignore", "--glob '*.ts' -- Permission ."],
    ["explicit file overrides type", "--type py -- Permission a.ts"],
    ["explicit file overrides glob", "--glob '*.py' -- Permission a.ts"],
    ["partial matches with a missing path", "-- Permission a.ts missing"],
    [
      "glob explicitly includes hidden files",
      "--glob '.hidden.ts' -- Permission .",
    ],
    ["glob matches nested paths", "--glob 'nested/*.ts' -- Permission ."],
    [
      "iglob excludes a glob match",
      "--glob '*.ts' --iglob '!nested/*' -- Permission .",
    ],
    [
      "iglob exclusions follow globs regardless of argument order",
      "--iglob '!nested/*' --glob '*.ts' -- Permission .",
    ],
    [
      "positive glob and iglob form a union",
      "--glob '*.ts' --iglob '*.PY' -- Permission .",
    ],
    [
      "last iglob match wins",
      "--iglob '!nested/*' --iglob '*.TS' -- Permission .",
    ],
    ["iglob overrides type", "--type py --iglob '*.TS' -- Permission ."],
    ["iglob overrides ignore", "--iglob 'IGNORED.TS' -- Permission ."],
    ["iglob includes hidden files", "--iglob '.HIDDEN.TS' -- Permission ."],
    ["combined short context flag", "-nC1 -- Permission a.ts"],
    ["combined short max-count flag", "-nm1 -- Permission a.ts"],
    ["combined short separate max-count value", "-nm 1 -- Permission a.ts"],
    ["combined short pattern value", "-nePermission a.ts"],
    ["positive signed max-count", "-m+1 -- Permission a.ts"],
    ["positive signed context", "-A+1 -- Permission a.ts"],
  ];
  for (const [name, args] of cases) {
    it(name, async () => {
      const env = await setupFiles(testDir, {
        "a.ts":
          "before\nPermission\nafter\ngap\ngap\nbefore\nPermission\nafter\n",
        "b.ts": "before\nPermission\nPermission\nafter\n",
        "c.py": "Permission\n",
        "ignored.ts": "Permission\n",
        ".ignore": "ignored.ts\n",
        "-file.ts": "-Permission\n--help\n--type-list\n",
        ".hidden.ts": "Permission\n",
        "nested/a.ts": "Permission\n",
      });
      await compareOutputs(
        env,
        testDir,
        `RIPGREP_CONFIG_PATH= rg --sort path --line-number --heading --color=never ${args}`,
      );
    });
  }

  for (const flags of [
    "-cm1",
    "-c -m2",
    "--count-matches -m1",
    "--count-matches -m2",
    "-c -v -m1",
  ]) {
    it(`limits matching lines per file in count mode: ${flags}`, async () => {
      const env = await setupFiles(testDir, {
        "a.txt": "other\nfoo foo foo\nother\nfoo foo\nfoo\n",
        "b.txt": "foo foo\nfoo\nother\n",
      });
      await compareOutputs(
        env,
        testDir,
        `RIPGREP_CONFIG_PATH= rg --sort path ${flags} foo a.txt b.txt`,
      );
    });
  }
});

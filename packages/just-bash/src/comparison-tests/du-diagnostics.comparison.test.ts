import { afterEach, beforeEach, describe, it } from "vitest";
import { Bash } from "../Bash.js";
import { shellJoinArgs } from "../helpers/shell-quote.js";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
} from "./fixture-runner.js";

// Original fixtures: GNU coreutils 9.12 on macOS. Mixed/Unicode fixtures:
// GNU coreutils 9.7 on Linux, LC_ALL=C.UTF-8. Redirect stderr to compare it too.
describe("du diagnostic quoting - Real Bash Comparison", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });
  it.each([
    "plain",
    "a'b",
    'a"b',
    "a'b\"c",
    "line\nbreak",
    "tab\tname",
    "escape\u001bname",
    "carriage\rreturn",
    "delete\u007fname",
    "back\\slash",
    "\n",
    "\nhead",
    "tail\n",
    "\n\t",
    "a'\\b",
    "a'$b",
    "a'`b",
    "\u0085",
    "emoji\ud83d\ude42",
    "a\n'b",
    "'\na",
    "a\n'",
    "\n'\t",
    "a\u2028b",
    "a\u2029b",
    "'\u2028\\",
    "\u0085'\n",
  ])("quotes %j", async (name) => {
    await compareOutputs(
      new Bash(),
      testDir,
      `${shellJoinArgs(["du", name])} 2>&1`,
    );
  });
});

import { afterEach, beforeEach, describe, it } from "vitest";
import { Bash } from "../Bash.js";
import { shellJoinArgs } from "../helpers/shell-quote.js";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
} from "./fixture-runner.js";

// Fixtures recorded with GNU coreutils 9.12 in a UTF-8 locale. Redirect stderr
// so the comparison runner checks diagnostic text as well as the exit status.
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
  ])("quotes %j", async (name) => {
    await compareOutputs(
      new Bash(),
      testDir,
      `${shellJoinArgs(["du", name])} 2>&1`,
    );
  });
});

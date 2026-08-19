import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("arithmetic command substitution - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("preserves arithmetic expansion and current-shell substitution semantics", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      [
        "number=4",
        "add() { printf '%s' \"$number + 2\"; }",
        "echo $(( $(add) * 3 ))",
        "echo $(( `printf '1 + 2'` * 3 ))",
        "unset number",
        'echo $(( ${number:=2} + $(printf "$number") ))',
        'echo "$number"',
        "false",
        "echo $(( $? + $(printf 1) ))",
        'echo $(( $(printf ")" >&2; printf 1) + 1 ))',
        "mkdir nested",
        "cd nested",
        "echo $(( $(pwd | grep -c '/nested') ))",
        "number=5",
        "echo $(( $(number=9; printf 1) + number ))",
        'echo "$number"',
        "rm -f marker",
        "echo $(( 0 && $(echo touched > marker; printf 1) ))",
        "if [ -f marker ]; then echo present; else echo absent; fi",
        "outer() { printf outer; }",
        "echo $(( $(outer() { printf inner; }; printf 1) + 1 ))",
        'echo "$(outer)"',
        "(( $(printf '2 + 1') * 2 ))",
        'echo "$?"',
        'for ((i=$(printf 0); i < $(printf 2); i += $(printf 1))); do echo "$i"; done',
        "value=abcd",
        "echo \"${value:$(printf '1 + 1'):1}\"",
      ].join("\n"),
    );
  });

  it("does not pair substitutions inside parameter expansions", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "arr=(4); echo $(( ${arr[$(printf 0)]} + $(printf 1) ))",
    );
  });

  it("reparses substitutions in indexed arrays and specialized slices", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      [
        "values=(zero one two three)",
        "set -- zero one two three",
        "echo \"indexed=${values[$(printf '1 + 1')]}\"",
        "printf 'quoted-pos:<%s>\\n' \"${@:$(printf '1 + 1'):$(printf '1 + 1')}\"",
        "printf 'unquoted-pos:<%s>\\n' ${@:$(printf '1 + 1'):$(printf '1 + 1')}",
        "printf 'array:<%s>\\n' \"${values[@]:$(printf '1 + 1'):$(printf '1 + 1')}\"",
      ].join("\n"),
    );
  });

  it("isolates shell options changed by substitutions", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      [
        "echo $(( $(set -u; shopt -s nullglob; printf 1) ))",
        "echo $((missing + 1))",
        "printf '<%s>\\n' no-match-*",
      ].join("\n"),
    );
  });
});

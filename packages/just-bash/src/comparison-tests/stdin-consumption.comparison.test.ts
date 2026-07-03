import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

/**
 * Stdin consumption semantics - Real Bash Comparison
 *
 * Verifies that stdin behaves like a shared file descriptor: reading
 * consumes it for every holder (loop bodies, subshells, functions),
 * pipeline stages get their own stdin, and redirects scope correctly.
 */
describe("Stdin consumption - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const threeLines = "a\nb\nc\n";

  it("cat in while-read body drains the loop's redirected stdin", async () => {
    const env = await setupFiles(testDir, { "f.txt": threeLines });
    await compareOutputs(
      env,
      testDir,
      `while read l; do echo "L:$l"; cat; done < f.txt`,
    );
  });

  it("grep in while-read body drains the loop's redirected stdin", async () => {
    const env = await setupFiles(testDir, { "f.txt": threeLines });
    await compareOutputs(
      env,
      testDir,
      `while read l; do echo "L:$l"; grep b; done < f.txt`,
    );
  });

  it("tr in group body consumes the rest after read", async () => {
    const env = await setupFiles(testDir, { "f.txt": threeLines });
    await compareOutputs(
      env,
      testDir,
      `{ read x; echo "x=$x"; tr a-z A-Z; } < f.txt`,
    );
  });

  it("subshell read shares the stdin offset with the parent", async () => {
    const env = await setupFiles(testDir, { "f.txt": threeLines });
    await compareOutputs(
      env,
      testDir,
      `{ (read x; echo "sub=$x"); read y; echo "y=$y"; } < f.txt`,
    );
  });

  it("read consumption inside a pipeline stage survives the subshell", async () => {
    const env = await setupFiles(testDir, { "f.txt": threeLines });
    await compareOutputs(
      env,
      testDir,
      `while read l; do echo "$l" | tr a-z A-Z; done < f.txt`,
    );
  });

  it("piped while loop with a command pipeline in the body keeps position", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `printf 'a\\nb\\nc\\n' | while read l; do echo "$l" | cat; done`,
    );
  });

  it("function definition redirect wins over piped stdin", async () => {
    const env = await setupFiles(testDir, { "f.txt": threeLines });
    await compareOutputs(
      env,
      testDir,
      `f() { cat; } < f.txt
printf 'PIPE\\n' | f`,
    );
  });

  it("function definition redirect with missing file errors without running body", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `f() { echo ran; } < missing.txt
f
echo "rc=$?"`,
    );
  });

  it("consecutive reads in a group each take one line", async () => {
    const env = await setupFiles(testDir, { "f.txt": threeLines });
    await compareOutputs(
      env,
      testDir,
      `{ read a; read b; echo "$b:$a"; } < f.txt`,
    );
  });

  it("cat - - reads stdin only once", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, `printf 'x\\ny\\n' | cat - -`);
  });

  it("diff - - compares stdin against itself", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `printf 'x\\ny\\n' | diff - -
echo "rc=$?"`,
    );
  });

  it("empty pipeline output does not fall back to outer stdin", async () => {
    const env = await setupFiles(testDir, { "f.txt": threeLines });
    await compareOutputs(
      env,
      testDir,
      `{ printf '' | cat; echo "after:$(cat)"; } < f.txt`,
    );
  });

  it("nested while loops each consume their own redirect", async () => {
    const env = await setupFiles(testDir, {
      "outer.txt": "1\n2\n",
      "inner.txt": "x\ny\n",
    });
    await compareOutputs(
      env,
      testDir,
      `while read o; do
  while read i; do echo "$o-$i"; done < inner.txt
done < outer.txt`,
    );
  });

  it("read after a body cat sees exhausted stdin and ends the loop", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `printf 'a\\nb\\nc\\n' | { while read l; do echo "L:$l"; cat > /dev/null; done; echo done; }`,
    );
  });

  it("eval body consumes the group's redirected stdin", async () => {
    const env = await setupFiles(testDir, { "f.txt": threeLines });
    await compareOutputs(
      env,
      testDir,
      `{ eval 'read x'; echo "x=$x"; read y; echo "y=$y"; } < f.txt`,
    );
  });
});

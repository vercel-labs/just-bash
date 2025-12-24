import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./test-helpers.js";

describe("Here Documents - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should require delimiter at start of line", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `cat <<EOF
hello
EOF`,
    );
  });

  it("should work inside if statement with proper formatting", async () => {
    const env = await setupFiles(testDir, {});
    // The delimiter must be at column 0, even inside if
    await compareOutputs(
      env,
      testDir,
      `if [[ 1 -eq 1 ]]; then
cat <<EOF
hello from if
EOF
fi`,
    );
  });

  it("should handle multiple lines in here document", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `cat <<EOF
line1
line2
line3
EOF`,
    );
  });

  it("should expand variables in here document", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `NAME=World; cat <<EOF
Hello, $NAME!
EOF`,
    );
  });

  it("should NOT expand variables when delimiter is quoted", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      `NAME=World; cat <<'EOF'
Hello, $NAME!
EOF`,
    );
  });
});

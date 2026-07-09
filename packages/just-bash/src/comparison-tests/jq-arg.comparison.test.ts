import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq named-argument flags - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("--arg", () => {
    it("binds $name as a string", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "echo '{}' | jq --arg name World '{greeting: (\"Hello \" + $name)}'",
      );
    });

    it("always binds a string even when numeric-looking", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "jq -n --arg x 5 '$x'");
    });
  });

  describe("multiple --arg", () => {
    it("populates $ARGS.named in order", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -cn --arg a foo --arg b bar --arg c baz '$ARGS.named'",
      );
    });

    it("binds each $name for use in a filter", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -n --arg first Ada --arg last Lovelace '$first + \" \" + $last'",
      );
    });
  });

  describe("--argjson", () => {
    it("binds a JSON number", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "jq -n --argjson x 5 '$x'");
    });

    it("binds a JSON object and navigates it", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -n --argjson x '{\"a\":1}' '$x.a'",
      );
    });

    it("errors non-zero on invalid JSON", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "jq -n --argjson x notjson '$x'");
    });
  });

  describe("--rawfile", () => {
    it("binds the whole file including newlines", async () => {
      const env = await setupFiles(testDir, {
        "rf.txt": "line1\nline2\n",
      });
      await compareOutputs(env, testDir, "jq -n --rawfile r rf.txt '$r'");
    });
  });

  describe("--slurpfile", () => {
    it("binds an array of the file's JSON values", async () => {
      const env = await setupFiles(testDir, {
        "sf.json": "1 2 3\n",
      });
      await compareOutputs(env, testDir, "jq -cn --slurpfile s sf.json '$s'");
    });
  });

  describe("$ARGS", () => {
    it("reflects named bindings", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -cn --arg a 1 --argjson b 2 '$ARGS.named'",
      );
    });

    it("orders positional before named", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "jq -cn --arg a 1 '$ARGS'");
    });

    it("is empty named when no args given", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "jq -cn '$ARGS.named'");
    });

    it("is empty positional array", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "jq -cn '$ARGS.positional'");
    });
  });

  describe("prototype-sensitive arg names", () => {
    it("keeps a __proto__ arg name in $ARGS.named", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -cn --arg __proto__ pwned '$ARGS.named'",
      );
    });

    it("reads through a __proto__ arg without inheriting", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        "jq -cn --argjson __proto__ '{\"pwned\":123}' '$ARGS.named.pwned'",
      );
    });
  });

  describe("errors", () => {
    it("errors non-zero on a missing operand", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "jq -n --arg x");
    });
  });
});

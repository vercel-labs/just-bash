/**
 * Tests for yq environment variable access (env, $ENV)
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yq environment variables", () => {
  it("env returns environment object", async () => {
    const bash = new Bash({
      env: { TEST_VAR: "test_value" },
    });
    const result = await bash.exec("echo 'null' | yq -o json 'env.TEST_VAR'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"test_value"\n');
  });

  it("$ENV returns environment object", async () => {
    const bash = new Bash({
      env: { MY_VAR: "my_value" },
    });
    const result = await bash.exec("echo 'null' | yq -o json '$ENV.MY_VAR'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('"my_value"\n');
  });

  it("env returns all env vars as object", async () => {
    const bash = new Bash({
      env: { A: "1", B: "2" },
    });
    const result = await bash.exec("echo 'null' | yq -o json 'env | keys'");
    expect(result.exitCode).toBe(0);
    // Should contain A and B (may have other vars too)
    expect(result.stdout).toContain('"A"');
    expect(result.stdout).toContain('"B"');
  });

  describe("edge cases", () => {
    it("missing env var returns null", async () => {
      const bash = new Bash({
        env: { A: "1" },
      });
      const result = await bash.exec(
        "echo 'null' | yq -o json 'env.NONEXISTENT'",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("null\n");
    });

    it("$ENV missing var returns null", async () => {
      const bash = new Bash({
        env: { A: "1" },
      });
      const result = await bash.exec(
        "echo 'null' | yq -o json '$ENV.NONEXISTENT'",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("null\n");
    });

    it("empty env var value", async () => {
      const bash = new Bash({
        env: { EMPTY: "" },
      });
      const result = await bash.exec("echo 'null' | yq -o json 'env.EMPTY'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('""\n');
    });

    it("env var with special characters", async () => {
      const bash = new Bash({
        env: { SPECIAL: "a=1&b=2" },
      });
      const result = await bash.exec("echo 'null' | yq -o json 'env.SPECIAL'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"a=1&b=2"\n');
    });

    it("env combined with other operations", async () => {
      const bash = new Bash({
        env: { NAME: "world" },
      });
      // Use env var in string interpolation would be nice, but test basic combination
      const result = await bash.exec(
        'echo \'{"greeting": "hello"}\' | yq -o json \'.greeting + " " + env.NAME\'',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"hello world"\n');
    });
  });
});

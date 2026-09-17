import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * Regression tests for nounset firing on a word that is exactly one
 * double-quoted part holding exactly one `${var<op>word}`. That shape is routed
 * through handleArrayDefaultValue(), which used to read the variable with
 * nounset still armed; anything with adjacent literal text took the general
 * path and behaved correctly.
 */
describe("nounset with a whole-word quoted parameter expansion", () => {
  it("does not fire for ${var:-word} as a whole double-quoted word", async () => {
    const env = new Bash();
    const result = await env.exec('set -u\necho "${JB_UNSET:-fallback}"');
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("fallback\n");
    expect(result.exitCode).toBe(0);
  });

  it("does not fire for ${var-word} as a whole double-quoted word", async () => {
    const env = new Bash();
    const result = await env.exec(
      'set -u\necho "${JB_UNSET-fallback}"\necho "[${JB_UNSET-}]"',
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("fallback\n[]\n");
    expect(result.exitCode).toBe(0);
  });

  it("does not fire for ${var:=word} and assigns the default", async () => {
    const env = new Bash();
    const result = await env.exec(
      'set -u\necho "${JB_UNSET:=assigned}"\necho "$JB_UNSET"',
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("assigned\nassigned\n");
    expect(result.exitCode).toBe(0);
  });

  it("does not fire for ${var=word} and assigns the default", async () => {
    const env = new Bash();
    const result = await env.exec(
      'set -u\necho "${JB_UNSET=assigned}"\necho "$JB_UNSET"',
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("assigned\nassigned\n");
    expect(result.exitCode).toBe(0);
  });

  it("does not fire for ${var:+word} as a whole double-quoted word", async () => {
    const env = new Bash();
    const result = await env.exec('set -u\necho "[${JB_UNSET:+alt}]"');
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("[]\n");
    expect(result.exitCode).toBe(0);
  });

  it("does not fire for ${var+word} as a whole double-quoted word", async () => {
    const env = new Bash();
    const result = await env.exec('set -u\necho "[${JB_UNSET+alt}]"');
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("[]\n");
    expect(result.exitCode).toBe(0);
  });

  it("still expands a set variable through the same shape", async () => {
    const env = new Bash();
    const result = await env.exec(
      'set -u\nJB_SET=value\nJB_EMPTY=\necho "${JB_SET:-fallback}"\necho "[${JB_EMPTY:-fallback}]"\necho "[${JB_EMPTY-fallback}]"\necho "[${JB_SET:+alt}]"',
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("value\n[fallback]\n[]\n[alt]\n");
    expect(result.exitCode).toBe(0);
  });

  it('runs the `[ -n "${VAR:-}" ]` guard under set -euo pipefail', async () => {
    const env = new Bash();
    const result = await env.exec(
      [
        "set -euo pipefail",
        'if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "writing to $GITHUB_STEP_SUMMARY"; else echo "no step summary"; fi',
        "GITHUB_STEP_SUMMARY=/tmp/summary.md",
        'if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "report" >> "$GITHUB_STEP_SUMMARY"; fi',
        "cat /tmp/summary.md",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("no step summary\nreport\n");
    expect(result.exitCode).toBe(0);
  });

  it("still fires for ${#var} as a whole double-quoted word", async () => {
    const env = new Bash();
    const result = await env.exec('set -u\necho "${#JB_UNSET}"\necho reached');
    expect(result.stderr).toBe("bash: JB_UNSET: unbound variable\n");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("still fires for a bare ${var} as a whole double-quoted word", async () => {
    const env = new Bash();
    const result = await env.exec('set -u\necho "${JB_UNSET}"\necho reached');
    expect(result.stderr).toBe("bash: JB_UNSET: unbound variable\n");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("does not fire for an unset array default as a whole double-quoted word", async () => {
    const env = new Bash();
    const result = await env.exec(
      'set -u\necho "${JB_ARR[@]:-fallback}"\necho "[${JB_ARR[@]:+alt}]"',
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("fallback\n[]\n");
    expect(result.exitCode).toBe(0);
  });
});

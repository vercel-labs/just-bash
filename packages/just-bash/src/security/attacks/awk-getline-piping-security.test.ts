import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("AWK getline piping security", () => {
  it("keeps getline command side effects inside sandboxed filesystem", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      rm -f /tmp/awk_getline_marker
      awk 'BEGIN {
        "echo sandboxed > /tmp/awk_getline_marker && cat /tmp/awk_getline_marker" | getline line
        print "line:", line
      }'
      if [ -f /tmp/awk_getline_marker ]; then
        echo MARKER_PRESENT
      else
        echo MARKER_ABSENT
      fi
      cat /tmp/awk_getline_marker
    `);

    expect(result.stdout).toBe("line: sandboxed\nMARKER_PRESENT\nsandboxed\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("returns EOF when getline command produces no stdout", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `awk 'BEGIN { ret = ("cat /tmp/awk_missing_getline_12345 2>/dev/null" | getline line); print "ret:", ret }'`,
    );

    expect(result.stdout).toBe("ret: 0\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("treats getline command output as data and does not execute payload text", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      rm -f /tmp/awk_getline_inject
      printf '%s\\n' 'safe; echo BAD > /tmp/awk_getline_inject' > /tmp/awk_getline_payload
      awk 'BEGIN { "cat /tmp/awk_getline_payload" | getline line; print line }'
      if [ -f /tmp/awk_getline_inject ]; then
        echo MARKER_PRESENT
      else
        echo MARKER_ABSENT
      fi
    `);

    expect(result.stdout).toBe(
      "safe; echo BAD > /tmp/awk_getline_inject\nMARKER_ABSENT\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps getline command pipes working with defense-in-depth enabled", async () => {
    const bash = new Bash({ defenseInDepth: true });
    const result = await bash.exec(`
      awk 'BEGIN {
        r1 = ("echo first" | getline a)
        r2 = ("echo second" | getline b)
        print r1, a
        print r2, b
      }'
    `);

    expect(result.stdout).toBe("1 first\n1 second\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

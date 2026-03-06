import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("find -exec quoting and argument boundary safety", () => {
  it("filename with embedded quote does not break -exec command boundaries", async () => {
    const bash = new Bash();

    const result = await bash.exec(`
      rm -f /tmp/find-exec-injected-marker
      mkdir -p /tmp/find-exec-injection
      touch '/tmp/find-exec-injection/a" ; echo FIND_EXEC_INJECTED > /tmp/find-exec-injected-marker ; #.txt'
      find /tmp/find-exec-injection -type f -exec echo {} \\;
      if [ -f /tmp/find-exec-injected-marker ]; then
        echo INJECTED_PRESENT
      else
        echo INJECTED_ABSENT
      fi
    `);

    expect(result.stdout).toBe(
      [
        '/tmp/find-exec-injection/a" ; echo FIND_EXEC_INJECTED > /tmp/find-exec-injected-marker ; #.txt',
        "INJECTED_ABSENT",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

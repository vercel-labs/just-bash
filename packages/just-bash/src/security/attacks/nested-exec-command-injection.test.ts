import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("nested exec command injection resistance", () => {
  it("external help command argument is treated as literal data", async () => {
    const bash = new Bash();

    const result = await bash.exec(`
      rm -f /tmp/help-injection-marker
      /usr/bin/help 'echo HELP_INJECTED > /tmp/help-injection-marker ; #' 2>/dev/null
      if [ -f /tmp/help-injection-marker ]; then
        echo MARKER_PRESENT
      else
        echo MARKER_ABSENT
      fi
    `);

    expect(result.stdout).toBe("MARKER_ABSENT\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("time command preserves quoted arguments without reparsing", async () => {
    const bash = new Bash();

    const result = await bash.exec(`
      rm -f /tmp/time-injection-marker
      /usr/bin/time -o /tmp/time.out echo 'safe; echo TIME_INJECTED > /tmp/time-injection-marker'
      echo "TIME_EXIT=$?"
      if [ -f /tmp/time-injection-marker ]; then
        echo MARKER_PRESENT
      else
        echo MARKER_ABSENT
      fi
    `);

    expect(result.stdout).toBe(
      "safe; echo TIME_INJECTED > /tmp/time-injection-marker\nTIME_EXIT=0\nMARKER_ABSENT\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("env command name is treated as a literal executable name", async () => {
    const bash = new Bash();

    const result = await bash.exec(`
      rm -f /tmp/env-injection-marker
      env 'echo ENV_INJECTED > /tmp/env-injection-marker ; #' 2>/dev/null
      echo "ENV_EXIT=$?"
      if [ -f /tmp/env-injection-marker ]; then
        echo MARKER_PRESENT
      else
        echo MARKER_ABSENT
      fi
    `);

    expect(result.stdout).toBe("ENV_EXIT=127\nMARKER_ABSENT\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("rg --pre passes quoted filenames as literal arguments", async () => {
    const bash = new Bash();

    const result = await bash.exec(`
      rm -f /tmp/rg-pre-injection-marker /tmp/rg-pre.out
      mkdir -p /tmp/rg-pre-injection
      printf "needle\\n" > '/tmp/rg-pre-injection/a" ; echo RG_PRE_INJECTED > /tmp/rg-pre-injection-marker ; #.txt'
      rg --pre cat needle /tmp/rg-pre-injection > /tmp/rg-pre.out
      echo "RG_EXIT=$?"
      if [ -f /tmp/rg-pre-injection-marker ]; then
        echo MARKER_PRESENT
      else
        echo MARKER_ABSENT
      fi
    `);

    expect(result.stdout).toBe("RG_EXIT=0\nMARKER_ABSENT\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("timeout command does not reparse metacharacters in wrapped argv", async () => {
    const bash = new Bash();

    const result = await bash.exec(`
      rm -f /tmp/timeout-injection-marker
      timeout 1 echo 'safe; echo TIMEOUT_INJECTED > /tmp/timeout-injection-marker'
      echo "TIMEOUT_EXIT=$?"
      if [ -f /tmp/timeout-injection-marker ]; then
        echo MARKER_PRESENT
      else
        echo MARKER_ABSENT
      fi
    `);

    expect(result.stdout).toBe(
      "safe; echo TIMEOUT_INJECTED > /tmp/timeout-injection-marker\nTIMEOUT_EXIT=0\nMARKER_ABSENT\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("timeout signal propagation gaps (investigation evidence)", () => {
  it("env sub-execution is canceled with timeout signal", async () => {
    const bash = new Bash();

    const result = await bash.exec(`
      rm -f /tmp/timeout-env-gap-marker
      timeout 0.01 env bash -c 'sleep 0.05; echo ENV_LATE > /tmp/timeout-env-gap-marker'
      echo "TIMEOUT_EXIT=$?"
      if [ -f /tmp/timeout-env-gap-marker ]; then
        echo NOW_PRESENT
      else
        echo NOW_ABSENT
      fi
      sleep 0.15
      if [ -f /tmp/timeout-env-gap-marker ]; then
        echo LATE_PRESENT
        cat /tmp/timeout-env-gap-marker
      else
        echo LATE_ABSENT
      fi
    `);

    expect(result.stdout).toBe(
      ["TIMEOUT_EXIT=124", "NOW_ABSENT", "LATE_ABSENT", ""].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("arithmetic command substitution executes before timeout command (bash semantics)", async () => {
    const bash = new Bash();

    const result = await bash.exec(`
      rm -f /tmp/timeout-arith-gap-marker
      timeout 0.01 echo $(( $(bash -c 'sleep 0.05; echo 7; echo ARITH_LATE > /tmp/timeout-arith-gap-marker') ))
      echo "TIMEOUT_EXIT=$?"
      if [ -f /tmp/timeout-arith-gap-marker ]; then
        echo NOW_PRESENT
      else
        echo NOW_ABSENT
      fi
      sleep 0.15
      if [ -f /tmp/timeout-arith-gap-marker ]; then
        echo LATE_PRESENT
        cat /tmp/timeout-arith-gap-marker
      else
        echo LATE_ABSENT
      fi
    `);

    expect(result.stdout).toBe(
      [
        "7",
        "TIMEOUT_EXIT=0",
        "NOW_PRESENT",
        "LATE_PRESENT",
        "ARITH_LATE",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

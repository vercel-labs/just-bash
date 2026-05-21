import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * Regression tests for DST-aware TZ parsing in `parseBareISOInTimezone`.
 *
 * Background: a single-pass offset shift uses the TZ offset at the requested
 * components-as-UTC, which is on the wrong side of the DST transition for
 * March 10 / November 3 in America/New_York. The fix iterates until the TZ
 * clock at the candidate equals the requested components.
 */
describe("date -d DST handling (America/New_York)", () => {
  it("spring-forward: 2024-03-10T03:30:00 NY -> 2024-03-10T07:30:00Z (epoch 1710055800)", async () => {
    // 03:30 local on the spring-forward day is unambiguously EDT (UTC-4),
    // since the clock has already jumped past 02:00 -> 03:00. EDT 03:30 = 07:30 UTC.
    const env = new Bash();
    const result = await env.exec(
      "export TZ=America/New_York && date -d '2024-03-10T03:30:00' +%s",
    );
    expect(result.stdout).toBe("1710055800\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("fall-back: 2024-11-03T01:30:00 NY resolves deterministically to the EDT instant (epoch 1730611800)", async () => {
    // 01:30 local on the fall-back day occurs twice: once at 05:30 UTC (EDT)
    // and again at 06:30 UTC (EST). The iterative resolve seeds with the
    // offset at the requested components-as-UTC (01:30Z), which is before
    // 06:00Z when DST ends, so it picks the EDT (earlier) instant. Both are
    // valid; we deterministically prefer the earlier one and document it here.
    const env = new Bash();
    const result = await env.exec(
      "export TZ=America/New_York && date -d '2024-11-03T01:30:00' +%s",
    );
    expect(result.stdout).toBe("1730611800\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("non-DST winter day still resolves correctly (regression for the original behaviour)", async () => {
    const env = new Bash();
    const result = await env.exec(
      "export TZ=America/New_York && date -d '2024-01-15T00:00:00' +%s",
    );
    // 2024-01-15T00:00 EST = 2024-01-15T05:00:00Z = 1705294800
    expect(result.stdout).toBe("1705294800\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("explicit Z suffix is not shifted even on a DST day", async () => {
    const env = new Bash();
    const result = await env.exec(
      "export TZ=America/New_York && date -d '2024-03-10T03:30:00Z' +%s",
    );
    // Z means UTC, regardless of TZ. 2024-03-10T03:30:00Z = 1710041400
    expect(result.stdout).toBe("1710041400\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

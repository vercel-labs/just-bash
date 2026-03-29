/**
 * Integration tests for the network approval workflow.
 *
 * Scenario: A sandboxed Bash has no network access — curl isn't even registered.
 * A curl command fails with "command not found". The workflow suspends via a hook,
 * waiting for human approval. After approval with specific allowed hosts, the
 * command is re-run with network configured. The allow-list now permits the host.
 *
 * Note: The step environment doesn't have real outbound network. We verify:
 * - First attempt: "command not found" (no network config → curl not registered)
 * - After approval: curl IS registered and the allow-list permits the host
 *   (the actual fetch may fail with a connection error, but that's expected —
 *    the important thing is it got past the allow-list)
 * - Rejection: no retry attempted
 * - No-approval-needed: command that doesn't need network succeeds directly
 */
import { describe, expect, it } from "vitest";
import { start, resumeHook } from "workflow/api";
import { waitForHook } from "@workflow/vitest";
import { networkApprovalWorkflow } from "./network-approval.js";

const HOST = "https://api.github.com";
const SCRIPT = `curl ${HOST}/zen`;

describe("network approval workflow", () => {
  it("grants access after approval — curl gets past the allow-list", async () => {
    const run = await start(networkApprovalWorkflow, [SCRIPT, HOST]);

    // Workflow should suspend at the hook
    await waitForHook(run, { token: `network-approval:${HOST}` });

    // Human approves with the requested host
    await resumeHook(`network-approval:${HOST}`, {
      granted: true,
      allowedHosts: [HOST],
    });

    const result = await run.returnValue;

    // First attempt: curl not found (no network config)
    expect(result.status).toBe("approved");
    expect(result.firstAttempt.exitCode).toBe(127);
    expect(result.firstAttempt.stderr).toContain("command not found");

    // Second attempt: curl is registered and the allow-list permits the host.
    // The actual HTTP request may fail (no real network in test env), but
    // the key assertion is that we did NOT get "command not found" or
    // "Network access denied" — the allow-list accepted the host.
    expect(result.secondAttempt).not.toBeNull();
    expect(result.secondAttempt!.stderr).not.toContain("command not found");
    expect(result.secondAttempt!.stderr).not.toContain("Network access denied");
    expect(result.grantedHosts).toEqual([HOST]);
  });

  it("blocks unapproved hosts even after approval", async () => {
    const WRONG_HOST = "https://evil.example.com";
    const WRONG_SCRIPT = `curl ${WRONG_HOST}/steal`;

    const run = await start(networkApprovalWorkflow, [WRONG_SCRIPT, WRONG_HOST]);

    await waitForHook(run, { token: `network-approval:${WRONG_HOST}` });

    // Approve only github.com — not the host the script is trying to reach
    await resumeHook(`network-approval:${WRONG_HOST}`, {
      granted: true,
      allowedHosts: [HOST], // github.com, not evil.example.com
    });

    const result = await run.returnValue;

    expect(result.status).toBe("approved");
    // Second attempt should be blocked by the allow-list
    expect(result.secondAttempt!.stderr).toContain("Network access denied");
    expect(result.secondAttempt!.exitCode).not.toBe(0);
  });

  it("rejects access — no retry attempted", async () => {
    const run = await start(networkApprovalWorkflow, [SCRIPT, HOST]);

    await waitForHook(run, { token: `network-approval:${HOST}` });

    await resumeHook(`network-approval:${HOST}`, {
      granted: false,
      allowedHosts: [],
    });

    const result = await run.returnValue;

    expect(result.status).toBe("rejected");
    expect(result.firstAttempt.exitCode).toBe(127);
    expect(result.secondAttempt).toBeNull();
    expect(result.grantedHosts).toEqual([]);
  });

  it("no approval needed when command succeeds without network", async () => {
    const run = await start(networkApprovalWorkflow, [
      "echo hello",
      "none",
    ]);

    const result = await run.returnValue;

    expect(result.status).toBe("no-approval-needed");
    expect(result.firstAttempt.exitCode).toBe(0);
    expect(result.firstAttempt.stdout).toBe("hello\n");
    expect(result.secondAttempt).toBeNull();
  });
});

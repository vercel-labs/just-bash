/**
 * Network approval workflow — demonstrates human-in-the-loop permission granting.
 *
 * Scenario: An AI agent runs a curl command in a sandboxed Bash. The sandbox
 * has no network access by default — curl is not even registered. The command
 * fails with "command not found". The workflow suspends and waits for a human
 * to approve specific hosts. After approval, the workflow reconstructs the Bash
 * with network access configured for the approved hosts, and re-runs the command.
 *
 * Permission model (Option B): The workflow holds the permission set as plain data.
 * The Bash instance itself has no network config (it's not serializable). When
 * reconstructing Bash after approval, the step function applies the granted hosts
 * as a NetworkConfig.
 *
 * Note: The integration test verifies the complete hook-based approval flow and
 * that the allow-list correctly controls access. It does NOT make real HTTP
 * requests — the step environment doesn't have outbound network. Instead, we
 * verify that curl with an approved host gets past the allow-list check (the
 * actual fetch will fail with a connection error, which is expected).
 */
import { createHook } from "workflow";

// ---------------------------------------------------------------------------
// Step functions — full Node.js access, dynamic import to avoid sandbox issues
// ---------------------------------------------------------------------------

const PKG = "just-bash";

async function createBashAndExec(script: string) {
  "use step";
  // @banned-pattern-ignore: PKG is a constant string "just-bash", not user input
  const { Bash } = await import(/* @vite-ignore */ PKG);
  // No network config → curl is not registered → "command not found"
  const bash = new Bash();
  const result = await bash.exec(script);
  return {
    serialized: bash.toJSON(),
    result: {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    },
  };
}

async function execWithNetworkAllowList(
  serialized: Record<string, unknown>,
  script: string,
  allowedHosts: string[],
) {
  "use step";
  // @banned-pattern-ignore: PKG is a constant string "just-bash", not user input
  const { Bash, InMemoryFs } = await import(/* @vite-ignore */ PKG);
  // Reconstruct Bash from serialized data, adding network permissions.
  // We mirror Bash.fromJSON() but inject NetworkConfig — the serialized form
  // can't carry network config (functions aren't serializable). The orchestrator
  // controls which hosts are allowed; the sandbox never decides.
  const fs = InMemoryFs.fromJSON(serialized.fs);
  const bash = new Bash({
    fs,
    cwd: serialized.state.cwd,
    executionLimits: serialized.config.limits,
    processInfo: serialized.config.processInfo,
    network: {
      allowedUrlPrefixes: allowedHosts,
      allowedMethods: ["GET", "HEAD"],
    },
  });
  const result = await bash.exec(script);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

// ---------------------------------------------------------------------------
// Workflow function — orchestrates the approval flow
// ---------------------------------------------------------------------------

export async function networkApprovalWorkflow(
  script: string,
  requestedHost: string,
) {
  "use workflow";

  // 1. First attempt: run the script with no network access
  const first = await createBashAndExec(script);

  // 2. If the command failed, ask for permission
  if (first.result.exitCode !== 0) {
    const hook = createHook<{ granted: boolean; allowedHosts: string[] }>({
      token: `network-approval:${requestedHost}`,
    });

    const decision = await hook;

    if (decision.granted) {
      // 3. Re-run with the approved network permissions
      const second = await execWithNetworkAllowList(
        first.serialized,
        script,
        decision.allowedHosts,
      );
      return {
        status: "approved" as const,
        firstAttempt: first.result,
        secondAttempt: second,
        grantedHosts: decision.allowedHosts,
      };
    }

    return {
      status: "rejected" as const,
      firstAttempt: first.result,
      secondAttempt: null,
      grantedHosts: [] as string[],
    };
  }

  // Command succeeded without network — no approval needed
  return {
    status: "no-approval-needed" as const,
    firstAttempt: first.result,
    secondAttempt: null,
    grantedHosts: [] as string[],
  };
}

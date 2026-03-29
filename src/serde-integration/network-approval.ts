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
 * Bash instances flow directly between steps — the workflow runtime handles
 * WORKFLOW_SERIALIZE/WORKFLOW_DESERIALIZE at step boundaries automatically.
 * Network config (functions) can't be serialized, so the step that retries
 * reconstructs a new Bash from the original's filesystem and cwd, adding network.
 */
import { createHook } from "workflow";

// ---------------------------------------------------------------------------
// Step functions
// ---------------------------------------------------------------------------

const PKG = "just-bash";

function ensureSerdeRegistered(cls: { classId?: string }): void {
  if (!cls.classId) return;
  const registry: Map<string, unknown> =
    ((globalThis as Record<symbol, unknown>)[
      Symbol.for("workflow-class-registry")
    ] as Map<string, unknown>) ??
    (() => {
      const m = new Map<string, unknown>();
      (globalThis as Record<symbol, unknown>)[
        Symbol.for("workflow-class-registry")
      ] = m;
      return m;
    })();
  if (!registry.has(cls.classId)) {
    registry.set(cls.classId, cls);
  }
}

async function createBashAndExec(script: string) {
  "use step";
  // @banned-pattern-ignore: PKG is a constant string "just-bash", not user input
  const { Bash } = await import(/* @vite-ignore */ PKG);
  ensureSerdeRegistered(Bash);
  const bash = new Bash();
  const result = await bash.exec(script);
  return {
    bash,
    result: {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    },
  };
}

async function execWithNetwork(
  bash: unknown,
  script: string,
  allowedHosts: string[],
) {
  "use step";
  // @banned-pattern-ignore: PKG is a constant string "just-bash", not user input
  const { Bash, InMemoryFs } = await import(/* @vite-ignore */ PKG);
  ensureSerdeRegistered(Bash);
  ensureSerdeRegistered(InMemoryFs);
  // Bash arrives deserialized but without network config (functions aren't
  // serializable). Reconstruct a new Bash from the original's filesystem
  // and cwd, adding the approved network permissions.
  const b = bash as { fs: InstanceType<typeof InMemoryFs>; cwd: string };
  const networkBash = new Bash({
    fs: b.fs,
    cwd: b.cwd,
    network: {
      allowedUrlPrefixes: allowedHosts,
      allowedMethods: ["GET", "HEAD"],
    },
  });
  const result = await networkBash.exec(script);
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
      // first.bash is passed directly — serde handles serialization
      const second = await execWithNetwork(
        first.bash,
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

  return {
    status: "no-approval-needed" as const,
    firstAttempt: first.result,
    secondAttempt: null,
    grantedHosts: [] as string[],
  };
}

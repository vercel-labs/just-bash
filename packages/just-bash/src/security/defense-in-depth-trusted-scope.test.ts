import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefenseInDepthBox } from "./defense-in-depth-box.js";

/**
 * Trusted scopes are tracked per execution and suspend global blocking for
 * every statement in that execution. A scope opened for work that is abandoned
 * (for example, a cancelled lazy import) must not outlive its execution and
 * leave later work unblocked.
 */
function trustedScopeActive(executionId: string | undefined): boolean {
  const box = DefenseInDepthBox as unknown as {
    isTrustedScopeActive(id: string | undefined): boolean;
  };
  return box.isTrustedScopeActive(executionId);
}

describe("defense-in-depth trusted scope lifetime", () => {
  beforeEach(() => DefenseInDepthBox.resetInstance());
  afterEach(() => DefenseInDepthBox.resetInstance());

  it("releases a trusted scope that is still open when the execution ends", async () => {
    const box = DefenseInDepthBox.getInstance(true);
    const handle = box.activate();

    // Trusted work that never settles, like an import abandoned by cancellation.
    const abandoned = handle.run(() =>
      DefenseInDepthBox.runTrustedAsync(() => new Promise<never>(() => {})),
    );
    await Promise.race([abandoned, Promise.resolve()]);
    expect(trustedScopeActive(handle.executionId)).toBe(true);

    handle.deactivate();
    expect(trustedScopeActive(handle.executionId)).toBe(false);
  });
});

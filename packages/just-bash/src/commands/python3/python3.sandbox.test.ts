import { describe, expect, it } from "vitest";
import { Sandbox } from "../../sandbox/Sandbox.js";

// End-to-end proof that the `python` capability flag forwarded through
// `SandboxOptions` reaches the underlying `Bash` and actually registers the
// python3 command. Without forwarding, python3 stays unavailable even though
// the CPython runtime ships in the package (see vercel/eve#431).
describe("Sandbox.create({ python: true })", () => {
  it(
    "registers python3 when the capability is enabled",
    { timeout: 60000 },
    async () => {
      const sandbox = await Sandbox.create({ python: true });
      const cmd = await sandbox.runCommand("python3 --version");
      expect(await cmd.stdout()).toContain("Python 3.");
    },
  );

  it("leaves python3 unavailable by default", async () => {
    const sandbox = await Sandbox.create();
    const cmd = await sandbox.runCommand("python3 --version");
    // Either "not found" or "not available" depending on the bundle context.
    expect(await cmd.stderr()).toMatch(/command not (found|available)/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { awkCommand2 } from "../../commands/awk/awk2.js";
import { jqCommand } from "../../commands/jq/jq.js";
import { sedCommand } from "../../commands/sed/sed.js";
import { yqCommand } from "../../commands/yq/yq.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { createDefenseAwareCommandContext } from "../../interpreter/defense-aware-command-context.js";
import type { CommandContext } from "../../types.js";
import { awaitWithDefenseContext } from "../defense-context.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../defense-in-depth-box.js";

function createCommandContext(
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: "/",
    env: new Map([["PATH", "/usr/bin:/bin"]]),
    stdin: "",
    requireDefenseContext: true,
    ...overrides,
  };
}

describe("Defense context invariant", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    DefenseInDepthBox.resetInstance();
  });

  it("fails closed when defense expects sandbox context but none is active", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext").mockReturnValue(false);

    const bash = new Bash({ defenseInDepth: true });
    const result = await bash.exec("echo should-not-run");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: security violation: interpreter execution attempted outside defense context\n\nThis is a defense-in-depth measure and indicates a bug in just-bash. Please report this at security@vercel.com\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("does not enforce sandbox context invariant when defense is disabled", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext").mockReturnValue(false);

    const bash = new Bash({ defenseInDepth: false });
    const result = await bash.exec("echo ok");

    expect(result.stdout).toBe("ok\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("fails closed when sandbox context is lost after entering execution", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext")
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const bash = new Bash({ defenseInDepth: true });
    const result = await bash.exec("echo should-not-run");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: security violation: interpreter statement attempted outside defense context\n\nThis is a defense-in-depth measure and indicates a bug in just-bash. Please report this at security@vercel.com\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("fails closed in command dispatch when context drifts after command await", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext")
      // interpreter checks
      .mockReturnValueOnce(true) // executeScript
      .mockReturnValueOnce(true) // executeStatement
      .mockReturnValueOnce(true) // executeCommand
      // command dispatch wrapper checks
      .mockReturnValueOnce(true) // pre-await
      .mockReturnValueOnce(false); // post-await

    const bash = new Bash({ defenseInDepth: true });
    const result = await bash.exec("echo should-not-run");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: security violation: command echo execution (post-await) attempted outside defense context\n\nThis is a defense-in-depth measure and indicates a bug in just-bash. Please report this at security@vercel.com\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("fails closed for awk command when defense context is missing", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext").mockReturnValue(false);

    await expect(
      awkCommand2.execute(
        ["{ print $0 }"],
        createCommandContext({ stdin: "x\n" }),
      ),
    ).rejects.toBeInstanceOf(SecurityViolationError);
  });

  it("fails closed for sed command when defense context is missing", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext").mockReturnValue(false);

    await expect(
      sedCommand.execute(["s/a/b/"], createCommandContext({ stdin: "a\n" })),
    ).rejects.toBeInstanceOf(SecurityViolationError);
  });

  it("fails closed for jq/query-engine when defense context is missing", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext").mockReturnValue(false);

    await expect(
      jqCommand.execute(["."], createCommandContext({ stdin: "{}\n" })),
    ).rejects.toBeInstanceOf(SecurityViolationError);
  });

  it("fails closed for yq/query-engine when defense context is missing", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext").mockReturnValue(false);

    await expect(
      yqCommand.execute(["."], createCommandContext({ stdin: "x: 1\n" })),
    ).rejects.toBeInstanceOf(SecurityViolationError);
  });

  it("fails closed after async boundary when context is lost", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/input.txt", "a\n");

    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext")
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await expect(
      sedCommand.execute(
        ["s/a/b/", "/input.txt"],
        createCommandContext({
          fs,
        }),
      ),
    ).rejects.toThrow(
      "sed input file read (post-await) attempted outside defense context",
    );
  });

  it("awaitWithDefenseContext throws when context drifts after await", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext")
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    await expect(
      awaitWithDefenseContext(
        true,
        "test-component",
        "async boundary",
        async () => Promise.resolve("ok"),
      ),
    ).rejects.toThrow(
      "test-component async boundary (post-await) attempted outside defense context",
    );
  });

  it("fails closed for generic command context async APIs when context drifts", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/input.txt", "x\n");

    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext")
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const wrappedCtx = createDefenseAwareCommandContext(
      createCommandContext({ fs }),
      "cat",
    );

    await expect(wrappedCtx.fs.exists("/input.txt")).rejects.toThrow(
      "command:cat fs.exists post-await attempted outside defense context",
    );
  });
});

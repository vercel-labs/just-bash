import { afterEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { awkCommand2 } from "../../commands/awk/awk2.js";
import { jqCommand } from "../../commands/jq/jq.js";
import { sedCommand } from "../../commands/sed/sed.js";
import { yqCommand } from "../../commands/yq/yq.js";
import { EMPTY_BYTES, unsafeBytesFromLatin1 } from "../../encoding.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "../../fs/interface.js";
import { createDefenseAwareCommandContext } from "../../interpreter/defense-aware-command-context.js";
import { resolveLimits } from "../../limits.js";
import type { RuntimeCommandContext } from "../../types.js";
import { awaitWithDefenseContext } from "../defense-context.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "../defense-in-depth-box.js";

function createCommandContext(
  overrides: Partial<RuntimeCommandContext> = {},
): RuntimeCommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: "/",
    env: new Map([["PATH", "/usr/bin:/bin"]]),
    stdin: EMPTY_BYTES,
    requireDefenseContext: true,
    ...overrides,
    limits: overrides.limits ?? resolveLimits(),
  };
}

const describeDefense =
  typeof nodeModule.registerHooks === "function" ? describe : describe.skip;

describeDefense("Defense context invariant", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    DefenseInDepthBox.resetInstance();
  });

  it("exposes every IFileSystem method, including the optional ones", () => {
    // The wrapper builds an explicit allowlist, so an optional IFileSystem
    // method that nobody adds there is silently dropped. That is dangerous
    // rather than merely incomplete: callers treat absence as "backend does
    // not support this" and fall back to a weaker path, so a missing entry
    // disables a hardening feature precisely under defense-in-depth.
    //
    // Record<keyof IFileSystem, true> makes this exhaustive at compile time:
    // adding a method to the interface fails typecheck until it is listed
    // here, and the assertion below then proves the wrapper forwards it.
    const IFILESYSTEM_METHODS: Record<keyof IFileSystem, true> = {
      appendFile: true,
      chmod: true,
      cp: true,
      createExclusive: true,
      exists: true,
      getAllPaths: true,
      link: true,
      lstat: true,
      mkdir: true,
      mv: true,
      readFile: true,
      readFileBuffer: true,
      readFileBytes: true,
      readdir: true,
      readdirWithFileTypes: true,
      readlink: true,
      realpath: true,
      resolvePath: true,
      rm: true,
      stat: true,
      symlink: true,
      utimes: true,
      writeFile: true,
    };

    const fs = new InMemoryFs();
    const wrapped = createDefenseAwareCommandContext(
      createCommandContext({ fs }),
      "probe",
    ).fs;

    const missing = Object.keys(IFILESYSTEM_METHODS).filter(
      (name) =>
        typeof (fs as unknown as Record<string, unknown>)[name] ===
          "function" &&
        typeof (wrapped as unknown as Record<string, unknown>)[name] !==
          "function",
    );
    expect(missing).toEqual([]);
  });

  it("routes mktemp through the atomic exclusive create under defense", async () => {
    // Regression: createExclusive was absent from the wrapper's allowlist, so
    // mktemp silently used the non-atomic writeFile+chmod fallback whenever
    // defense-in-depth was active.
    const fs = new InMemoryFs();
    await fs.mkdir("/tmp", { recursive: true });
    const exclusive = vi.spyOn(fs, "createExclusive");
    const write = vi.spyOn(fs, "writeFile");

    const env = new Bash({ fs, defenseInDepth: { enabled: true } });
    const result = await env.exec("mktemp");

    expect(result.exitCode).toBe(0);
    expect(exclusive).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
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
        createCommandContext({ stdin: unsafeBytesFromLatin1("x\n") }),
      ),
    ).rejects.toBeInstanceOf(SecurityViolationError);
  });

  it("fails closed for sed command when defense context is missing", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext").mockReturnValue(false);

    await expect(
      sedCommand.execute(
        ["s/a/b/"],
        createCommandContext({ stdin: unsafeBytesFromLatin1("a\n") }),
      ),
    ).rejects.toBeInstanceOf(SecurityViolationError);
  });

  it("fails closed for jq/query-engine when defense context is missing", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext").mockReturnValue(false);

    await expect(
      jqCommand.execute(
        ["."],
        createCommandContext({ stdin: unsafeBytesFromLatin1("{}\n") }),
      ),
    ).rejects.toBeInstanceOf(SecurityViolationError);
  });

  it("fails closed for yq/query-engine when defense context is missing", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext").mockReturnValue(false);

    await expect(
      yqCommand.execute(
        ["."],
        createCommandContext({ stdin: unsafeBytesFromLatin1("x: 1\n") }),
      ),
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

import * as nodeModule from "node:module";

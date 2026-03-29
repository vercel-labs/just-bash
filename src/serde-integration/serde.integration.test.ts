/**
 * Integration tests for Bash/InMemoryFs serialization through the
 * Workflow DevKit runtime. These tests use the @workflow/vitest plugin
 * to run real workflows in-process, exercising the WORKFLOW_SERIALIZE
 * and WORKFLOW_DESERIALIZE symbols across step boundaries.
 *
 * Run: pnpm test:integration
 */
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import {
  basicSerdeWorkflow,
  binaryContentWorkflow,
  cwdPreservedWorkflow,
  envVarsSurviveStepBoundaryWorkflow,
  executionLimitsSurviveWorkflow,
  filesystemSurvivesStepBoundaryWorkflow,
  inMemoryFsStandaloneWorkflow,
  multipleStepBoundariesWorkflow,
  processInfoPreservedWorkflow,
  systemFilesRecreatedWorkflow,
} from "./workflows.js";

describe("Bash workflow serde integration", () => {
  it("basic: Bash instance survives step boundary", async () => {
    const run = await start(basicSerdeWorkflow);
    const result = await run.returnValue;

    expect(result.stdout).toBe("hello from workflow");
    expect(result.exitCode).toBe(0);
  });

  it("filesystem writes survive step boundaries", async () => {
    const run = await start(filesystemSurvivesStepBoundaryWorkflow);
    const result = await run.returnValue;

    expect(result.stdout).toBe("step-written-content\n");
    expect(result.exitCode).toBe(0);
  });

  it("environment variables survive step boundaries", async () => {
    const run = await start(envVarsSurviveStepBoundaryWorkflow);
    const result = await run.returnValue;

    expect(result.foo).toBe("bar");
    expect(result.special).toBe('hello "world" & <baz>');
  });

  it("execution limits preserved through serde", async () => {
    const run = await start(executionLimitsSurviveWorkflow);
    const result = await run.returnValue;

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("too many commands executed");
  });

  it("cwd preserved across step boundary", async () => {
    const run = await start(cwdPreservedWorkflow);
    const result = await run.returnValue;

    expect(result.stdout).toBe("/tmp\n");
  });

  it("processInfo preserved across step boundary", async () => {
    const run = await start(processInfoPreservedWorkflow);
    const result = await run.returnValue;

    expect(result.pid).toBe("42\n");
    expect(result.uid).toBe("500\n");
  });

  it("system files (lazy entries) recreated after serde", async () => {
    const run = await start(systemFilesRecreatedWorkflow);
    const result = await run.returnValue;

    expect(result.stdout).toBe("ok\n");
    expect(result.exitCode).toBe(0);
  });

  it("InMemoryFs standalone serde through workflow", async () => {
    const run = await start(inMemoryFsStandaloneWorkflow);
    const result = await run.returnValue;

    expect(result.config).toBe('{"key": "value"}');
    expect(result.readme).toBe("Hello, world!");
  });

  it("Bash survives multiple consecutive step boundaries", async () => {
    const run = await start(multipleStepBoundariesWorkflow);
    const result = await run.returnValue;

    expect(result.stdout).toBe("one\n---\ntwo\n");
    expect(result.exitCode).toBe(0);
  });

  it("binary content survives InMemoryFs workflow serde", async () => {
    const run = await start(binaryContentWorkflow);
    const result = await run.returnValue;

    expect(result.content).toBeDefined();
  });
});

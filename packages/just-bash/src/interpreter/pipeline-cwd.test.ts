import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { parse } from "../parser/parser.js";
import { executePipeline } from "./pipeline-execution.js";
import type { InterpreterContext } from "./types.js";

function createBash() {
  return new Bash({
    cwd: "/work",
    files: {
      "/work/marker.txt": "parent\n",
      "/work/child/marker.txt": "child\n",
    },
  });
}

describe("pipeline working directory isolation", () => {
  it.each([
    "cd child | cat",
    "echo input | cd child",
    "echo input | cd child | cat",
    "{ cd child; } | cat",
    "{ cd child; exit 7; } | cat",
    "{ cd child; echo inner | cat; } | cat",
    "shopt -s lastpipe; cd child | cat",
  ])("restores cwd and PWD after %s", async (pipeline) => {
    const bash = createBash();
    const result = await bash.exec(
      `${pipeline}; printf 'PWD=%s\n' "$PWD"; pwd; cat marker.txt; echo saved > result.txt`,
    );
    expect(result).toMatchObject({
      stdout: `${pipeline.includes("echo inner") ? "inner\n" : ""}PWD=/work\n/work\nparent\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.fs.readFile("/work/result.txt")).toBe("saved\n");
    expect(await bash.fs.exists("/work/child/result.txt")).toBe(false);
  });

  it("starts later pipeline stages in the parent's cwd", async () => {
    const result = await createBash().exec("cd child | cat marker.txt");
    expect(result).toMatchObject({
      stdout: "parent\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([
    "cd child",
    "{ cd child; }",
    "shopt -s lastpipe; true | cd child",
  ])("retains cwd changes in the current shell: %s", async (command) => {
    const result = await createBash().exec(
      `${command}; printf 'PWD=%s\n' "$PWD"; pwd; cat marker.txt`,
    );
    expect(result).toMatchObject({
      stdout: "PWD=/work/child\n/work/child\nchild\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("restores cwd when a pipeline stage throws an unhandled error", async () => {
    const ctx = {
      state: {
        cwd: "/work",
        env: new Map([["PWD", "/work"]]),
        arrays: new Map(),
        shoptOptions: { lastpipe: false },
      },
      executionScope: { outputBytesUsed: 0, chargeCommand: () => 1 },
    } as unknown as InterpreterContext;
    const pipeline = parse("cd child | cat").statements[0].pipelines[0];
    const failure = new Error("stage failed");

    await expect(
      executePipeline(ctx, pipeline, async () => {
        ctx.state.cwd = "/work/child";
        ctx.state.env.set("PWD", "/work/child");
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(ctx.state.cwd).toBe("/work");
    expect(ctx.state.env.get("PWD")).toBe("/work");
  });
});

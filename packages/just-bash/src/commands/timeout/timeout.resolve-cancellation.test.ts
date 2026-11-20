import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { withUnhandledRejectionsTracked } from "../../test-utils/unhandled-rejections.js";

describe("timeout cancellation while a command resolves", () => {
  it("keeps the caller running when the command never finishes loading", async () => {
    const bash = new Bash({
      customCommands: [
        {
          name: "pending-import",
          load: () => new Promise<never>(() => {}),
        },
      ],
    });

    const { result, rejections } = await withUnhandledRejectionsTracked(() =>
      bash.exec(`
        timeout 0.01 pending-import
        echo "TIMEOUT_EXIT=$?"
        echo AFTER
      `),
    );

    expect(result.stdout).toBe("TIMEOUT_EXIT=124\nAFTER\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(rejections).toEqual([]);
  });

  it("does not start a cancelled command when its module finishes loading later", async () => {
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    let bodyRuns = 0;
    const bash = new Bash({
      customCommands: [
        {
          name: "late-import",
          load: async () => {
            await loadGate;
            return {
              name: "late-import",
              async execute(_args, ctx) {
                bodyRuns += 1;
                await ctx.fs.writeFile("/late-import-ran", "ran");
                return { stdout: "LATE_BODY\n", stderr: "", exitCode: 0 };
              },
            };
          },
        },
      ],
    });

    const { result, rejections } = await withUnhandledRejectionsTracked(
      async () => {
        const cancelled = await bash.exec(`
          timeout 0.01 late-import
          echo "TIMEOUT_EXIT=$?"
          echo AFTER
        `);
        releaseLoad();
        // Running the command again waits for the completed load, so it is the
        // signal that the abandoned load settled; no fixed sleep is needed.
        const later = await bash.exec("timeout 1 late-import");
        return { cancelled, later };
      },
    );

    expect(result.cancelled.stdout).toBe("TIMEOUT_EXIT=124\nAFTER\n");
    expect(result.cancelled.stderr).toBe("");
    expect(result.cancelled.exitCode).toBe(0);
    // The completed load is still usable by a later invocation.
    expect(result.later.stdout).toBe("LATE_BODY\n");
    expect(result.later.stderr).toBe("");
    expect(result.later.exitCode).toBe(0);
    // Only the later invocation entered the body, even though the load finished
    // after the cancelled one gave up.
    expect(bodyRuns).toBe(1);
    expect(rejections).toEqual([]);
  });
});

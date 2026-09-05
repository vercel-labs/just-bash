import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec synchronous run bridge", () => {
  it("keeps filesystem state live across shell and guest boundaries", async () => {
    const bash = new Bash({ javascript: true });
    await bash.exec("printf shell > /tmp/state");

    const result = await bash.exec(
      `js-exec -c "const before = fs.readFileSync('/tmp/state', 'utf8'); fs.writeFileSync('/tmp/state', before + '-guest'); console.log(fs.readFileSync('/tmp/state', 'utf8'))"`,
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: "shell-guest\n" });
    await expect(bash.fs.readFile("/tmp/state")).resolves.toBe("shell-guest");
  });

  it("observes synchronous filesystem updates after an awaited tool", async () => {
    const bash = new Bash({
      javascript: {
        async invokeTool(path) {
          if (path !== "state.ready") throw new Error(`Unknown tool: ${path}`);
          await Promise.resolve();
          return JSON.stringify({ value: "tool-result" });
        },
      },
    });

    const result = await bash.exec(
      `js-exec -c "const result = await tools.state.ready(); fs.writeFileSync('/tmp/tool-state', result.value); console.log(fs.readFileSync('/tmp/tool-state', 'utf8'))"`,
    );

    expect(result).toMatchObject({ exitCode: 0, stdout: "tool-result\n" });
    await expect(bash.fs.readFile("/tmp/tool-state")).resolves.toBe(
      "tool-result",
    );
  });

  it("uses native ESM parsing for aliases, cycles, strings, and comments", async () => {
    const bash = new Bash({
      javascript: true,
      files: {
        "/app/a.mjs":
          "import { getB } from './b.mjs'; export const getA = () => 'a' + getB();",
        "/app/b.mjs":
          "import { getA } from './a.mjs'; export const getB = () => 'b'; export const cycle = () => getA();",
        "/app/main.mjs": `
          import { getA as aliased } from './a.mjs';
          import { cycle } from './b.mjs';
          const text = "fs.readFileSync() tools.fake() import('./not-real.mjs')";
          // fs.writeFileSync('/tmp/should-not-exist', 'x')
          console.log(aliased(), cycle(), text.includes("import"));
        `,
      },
    });

    const result = await bash.exec("js-exec /app/main.mjs");

    expect(result).toMatchObject({ exitCode: 0, stdout: "ab ab true\n" });
    await expect(bash.fs.exists("/tmp/should-not-exist")).resolves.toBe(false);
  });
});

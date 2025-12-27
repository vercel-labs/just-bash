import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Code Review Scenario
 * An AI agent reviewing a TypeScript web application for code quality issues.
 */
describe("Agent Scenario: Code Review", () => {
  const createEnv = () =>
    new Bash({
      files: {
        "/project/package.json": `{
  "name": "my-app",
  "version": "1.0.0"
}`,
        "/project/src/index.ts": `import express from 'express';
// TODO: Add error handling
// FIXME: Port should be from env
const app = express();
app.listen(3000);
`,
        "/project/src/user.ts": `// TODO: Add validation
export function createUser(data: any) {
  return { id: 1, ...data };
}
`,
        "/project/README.md": `# My App
A simple Express API.
`,
      },
      cwd: "/project",
    });

  it("should list project structure", async () => {
    const env = createEnv();
    const result = await env.exec("ls /project");
    expect(result.stdout).toBe("README.md\npackage.json\nsrc\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should read package.json", async () => {
    const env = createEnv();
    const result = await env.exec("cat /project/package.json");
    expect(result.stdout).toBe(`{
  "name": "my-app",
  "version": "1.0.0"
}`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find TypeScript files in src", async () => {
    const env = createEnv();
    const result = await env.exec("ls /project/src");
    expect(result.stdout).toBe("index.ts\nuser.ts\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find TODO comments", async () => {
    const env = createEnv();
    const result = await env.exec("grep -r TODO /project/src");
    expect(
      result.stdout,
    ).toBe(`/project/src/index.ts:// TODO: Add error handling
/project/src/user.ts:// TODO: Add validation
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find FIXME comments", async () => {
    const env = createEnv();
    const result = await env.exec("grep -r FIXME /project/src");
    expect(result.stdout).toBe(
      "/project/src/index.ts:// FIXME: Port should be from env\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should review the main entry point", async () => {
    const env = createEnv();
    const result = await env.exec("cat /project/src/index.ts");
    expect(result.stdout).toBe(`import express from 'express';
// TODO: Add error handling
// FIXME: Port should be from env
const app = express();
app.listen(3000);
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should check for hardcoded port", async () => {
    const env = createEnv();
    const result = await env.exec("grep -n 3000 /project/src/index.ts");
    expect(result.stdout).toBe("5:app.listen(3000);\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find all exported functions", async () => {
    const env = createEnv();
    const result = await env.exec('grep "^export" /project/src/user.ts');
    expect(result.stdout).toBe("export function createUser(data: any) {\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should count lines of code", async () => {
    const env = createEnv();
    const result = await env.exec("wc -l /project/src/index.ts");
    expect(result.stdout).toBe("5 /project/src/index.ts\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should count TODO items", async () => {
    const env = createEnv();
    const result = await env.exec("grep -r -c TODO /project/src");
    expect(result.stdout).toBe(`/project/src/index.ts:1
/project/src/user.ts:1
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

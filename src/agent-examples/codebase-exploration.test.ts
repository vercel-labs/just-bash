import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Codebase Exploration Scenario
 * An AI agent exploring a monorepo structure to understand the architecture.
 */
describe("Agent Scenario: Codebase Exploration", () => {
  const createEnv = () =>
    new Bash({
      files: {
        "/repo/package.json": `{
  "name": "monorepo",
  "workspaces": ["packages/*"]
}`,
        "/repo/packages/core/package.json": `{
  "name": "@app/core",
  "version": "1.0.0"
}`,
        "/repo/packages/core/src/index.ts": `export { Database } from './db';
export { Logger } from './logger';
`,
        "/repo/packages/core/src/db.ts": `export class Database {
  connect() {}
  query() {}
}
`,
        "/repo/packages/core/src/logger.ts": `export class Logger {
  info(msg: string) {}
  error(msg: string) {}
}
`,
        "/repo/packages/api/package.json": `{
  "name": "@app/api",
  "dependencies": {
    "@app/core": "1.0.0"
  }
}`,
        "/repo/packages/api/src/index.ts": `import { Database } from '@app/core';
const db = new Database();
`,
        "/repo/packages/web/package.json": `{
  "name": "@app/web",
  "dependencies": {
    "@app/api": "1.0.0"
  }
}`,
        "/repo/packages/web/src/App.tsx": `export function App() {
  return <div>Hello</div>;
}
`,
      },
      cwd: "/repo",
    });

  it("should list root directory", async () => {
    const env = createEnv();
    const result = await env.exec("ls /repo");
    expect(result.stdout).toBe("package.json\npackages\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should read root package.json for workspaces", async () => {
    const env = createEnv();
    const result = await env.exec("cat /repo/package.json");
    expect(result.stdout).toBe(`{
  "name": "monorepo",
  "workspaces": ["packages/*"]
}`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should list all packages", async () => {
    const env = createEnv();
    const result = await env.exec("ls /repo/packages");
    expect(result.stdout).toBe("api\ncore\nweb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should explore core package structure", async () => {
    const env = createEnv();
    const result = await env.exec("ls /repo/packages/core");
    expect(result.stdout).toBe("package.json\nsrc\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should list core source files", async () => {
    const env = createEnv();
    const result = await env.exec("ls /repo/packages/core/src");
    expect(result.stdout).toBe("db.ts\nindex.ts\nlogger.ts\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should read core exports", async () => {
    const env = createEnv();
    const result = await env.exec("cat /repo/packages/core/src/index.ts");
    expect(result.stdout).toBe(`export { Database } from './db';
export { Logger } from './logger';
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find all class definitions", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -r "^export class" /repo/packages/core/src',
    );
    expect(
      result.stdout,
    ).toBe(`/repo/packages/core/src/db.ts:export class Database {
/repo/packages/core/src/logger.ts:export class Logger {
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find package dependencies on core", async () => {
    const env = createEnv();
    const result = await env.exec('grep -r "@app/core" /repo/packages');
    expect(
      result.stdout,
    ).toBe(`/repo/packages/api/package.json:    "@app/core": "1.0.0"
/repo/packages/api/src/index.ts:import { Database } from '@app/core';
/repo/packages/core/package.json:  "name": "@app/core",
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should check api package dependencies", async () => {
    const env = createEnv();
    const result = await env.exec("cat /repo/packages/api/package.json");
    expect(result.stdout).toBe(`{
  "name": "@app/api",
  "dependencies": {
    "@app/core": "1.0.0"
  }
}`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find all imports of Database", async () => {
    const env = createEnv();
    const result = await env.exec('grep -r "Database" /repo/packages');
    expect(
      result.stdout,
    ).toBe(`/repo/packages/api/src/index.ts:import { Database } from '@app/core';
/repo/packages/api/src/index.ts:const db = new Database();
/repo/packages/core/src/db.ts:export class Database {
/repo/packages/core/src/index.ts:export { Database } from './db';
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find React components", async () => {
    const env = createEnv();
    const result = await env.exec('grep -r "function App" /repo/packages/web');
    expect(result.stdout).toBe(
      "/repo/packages/web/src/App.tsx:export function App() {\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should count files in each package", async () => {
    const env = createEnv();
    const result = await env.exec("ls /repo/packages/core/src | wc -l");
    expect(result.stdout).toBe("3\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("Agent Scenario: Disk Usage Analysis with ls -h and du -h", () => {
  const createDiskEnv = () =>
    new Bash({
      files: {
        // Small config files
        "/project/package.json": { content: '{"name": "app"}', mode: 0o644 },
        "/project/tsconfig.json": {
          content: '{"target": "es2020"}',
          mode: 0o644,
        },
        // Source files of varying sizes
        "/project/src/index.ts": { content: "a".repeat(500), mode: 0o644 },
        "/project/src/utils.ts": { content: "b".repeat(2 * 1024), mode: 0o644 }, // 2K
        "/project/src/api.ts": { content: "c".repeat(5 * 1024), mode: 0o644 }, // 5K
        // Large build artifacts
        "/project/dist/bundle.js": {
          content: "d".repeat(150 * 1024),
          mode: 0o644,
        }, // 150K
        "/project/dist/bundle.js.map": {
          content: "e".repeat(300 * 1024),
          mode: 0o644,
        }, // 300K
        // Node modules simulation
        "/project/node_modules/lodash/index.js": {
          content: "f".repeat(500 * 1024),
          mode: 0o644,
        }, // 500K
        "/project/node_modules/lodash/package.json": {
          content: '{"name": "lodash"}',
          mode: 0o644,
        },
        "/project/node_modules/express/index.js": {
          content: "g".repeat(200 * 1024),
          mode: 0o644,
        }, // 200K
        // Log files
        "/project/logs/app.log": {
          content: "h".repeat(1024 * 1024),
          mode: 0o644,
        }, // 1M
        "/project/logs/error.log": {
          content: "i".repeat(50 * 1024),
          mode: 0o644,
        }, // 50K
      },
      cwd: "/project",
    });

  describe("Human-readable file sizes with ls -lh", () => {
    it("should display file sizes in human-readable format", async () => {
      const env = createDiskEnv();
      const result = await env.exec("ls -lh /project/dist");
      expect(result.stdout).toMatch(/150K.*bundle\.js/);
      expect(result.stdout).toMatch(/300K.*bundle\.js\.map/);
      expect(result.exitCode).toBe(0);
    });

    it("should show large node_modules with -h flag", async () => {
      const env = createDiskEnv();
      const result = await env.exec("ls -lh /project/node_modules/lodash");
      expect(result.stdout).toMatch(/500K.*index\.js/);
      expect(result.exitCode).toBe(0);
    });

    it("should display megabyte-sized log files", async () => {
      const env = createDiskEnv();
      const result = await env.exec("ls -lh /project/logs");
      expect(result.stdout).toMatch(/1\.0M.*app\.log/);
      expect(result.stdout).toMatch(/50K.*error\.log/);
      expect(result.exitCode).toBe(0);
    });

    it("should show small source files in bytes", async () => {
      const env = createDiskEnv();
      const result = await env.exec("ls -lh /project/src");
      expect(result.stdout).toContain("500"); // 500 bytes
      expect(result.stdout).toContain("2.0K"); // 2K file
      expect(result.stdout).toContain("5.0K"); // 5K file
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Directory size analysis with du -h", () => {
    it("should show directory sizes in human-readable format", async () => {
      const env = createDiskEnv();
      const result = await env.exec("du -h /project/dist");
      expect(result.stdout).toMatch(/K.*\/project\/dist/);
      expect(result.exitCode).toBe(0);
    });

    it("should summarize node_modules size", async () => {
      const env = createDiskEnv();
      const result = await env.exec("du -sh /project/node_modules");
      // Should show total size of node_modules
      expect(result.stdout).toContain("/project/node_modules");
      expect(result.exitCode).toBe(0);
    });

    it("should show all file sizes with du -ah", async () => {
      const env = createDiskEnv();
      const result = await env.exec("du -ah /project/logs");
      expect(result.stdout).toContain("app.log");
      expect(result.stdout).toContain("error.log");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Disk usage workflow for agents", () => {
    it("should identify largest files in build output", async () => {
      const env = createDiskEnv();
      // Agent checking build artifacts
      const result = await env.exec("ls -lhS /project/dist");
      // -S sorts by size (largest first)
      expect(result.stdout).toContain("bundle.js.map");
      expect(result.stdout).toContain("bundle.js");
      expect(result.exitCode).toBe(0);
    });

    it("should check log file sizes for rotation needs", async () => {
      const env = createDiskEnv();
      const result = await env.exec("ls -lh /project/logs/app.log");
      expect(result.stdout).toMatch(/1\.0M/);
      expect(result.exitCode).toBe(0);
    });

    it("should compare source vs build sizes", async () => {
      const env = createDiskEnv();
      const srcSize = await env.exec("du -sh /project/src");
      const distSize = await env.exec("du -sh /project/dist");

      expect(srcSize.stdout).toContain("/project/src");
      expect(distSize.stdout).toContain("/project/dist");
      // Both should have human-readable sizes
      expect(srcSize.exitCode).toBe(0);
      expect(distSize.exitCode).toBe(0);
    });

    it("should audit disk usage by directory", async () => {
      const env = createDiskEnv();
      const result = await env.exec("du -h --max-depth=1 /project");
      expect(result.stdout).toContain("/project/src");
      expect(result.stdout).toContain("/project/dist");
      expect(result.stdout).toContain("/project/node_modules");
      expect(result.stdout).toContain("/project/logs");
      expect(result.exitCode).toBe(0);
    });
  });
});

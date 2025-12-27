import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Agent Scenario: Feature Implementation Workflow
 *
 * Simulates an AI agent's workflow when implementing new features:
 * 1. Find skipped/failing tests to understand requirements
 * 2. Read existing implementations for patterns
 * 3. Understand the codebase structure
 * 4. Make targeted changes
 * 5. Verify with tests
 *
 * Based on real workflow: adding . and .. support, fixing ls -R format,
 * adding true/false commands.
 */

function createEnv(): Bash {
  return new Bash({
    files: {
      // Main BashEnv implementation
      "/project/src/BashEnv.ts": `import { VirtualFs } from './fs.js';
import { Command, CommandContext, ExecResult } from './types.js';
import { lsCommand } from './commands/ls/ls.js';
import { findCommand } from './commands/find/find.js';
import { grepCommand } from './commands/grep/grep.js';

export class BashEnv {
  private fs: VirtualFs;
  private cwd: string;
  private commands: Map<string, Command> = new Map();

  constructor(options: BashOptions = {}) {
    this.fs = new VirtualFs(options.files);
    this.cwd = options.cwd || '/';

    // Register built-in commands
    this.registerCommand(lsCommand);
    this.registerCommand(findCommand);
    this.registerCommand(grepCommand);
    // TODO: Add true and false commands
  }

  registerCommand(command: Command): void {
    this.commands.set(command.name, command);
  }

  async exec(command: string): Promise<ExecResult> {
    // Command execution logic
    return { stdout: '', stderr: '', exitCode: 0 };
  }
}
`,

      // Virtual filesystem
      "/project/src/fs.ts": `export interface FsEntry {
  type: 'file' | 'directory';
  content?: string;
  mode: number;
}

export class VirtualFs {
  private data: Map<string, FsEntry> = new Map();

  constructor(initialFiles?: Record<string, string>) {
    this.data.set('/', { type: 'directory', mode: 0o755 });
    if (initialFiles) {
      for (const [path, content] of Object.entries(initialFiles)) {
        this.writeFileSync(path, content);
      }
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    // Implementation
  }

  // TODO: Add mkdirSync for synchronous directory creation

  async readdir(path: string): Promise<string[]> {
    // Returns entries without . and ..
    return [];
  }
}
`,

      // ls command implementation
      "/project/src/commands/ls/ls.ts": `import { Command, CommandContext, ExecResult } from '../../types.js';

export const lsCommand: Command = {
  name: 'ls',

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    let showAll = false;
    let showAlmostAll = false;
    let longFormat = false;
    let recursive = false;

    // Parse arguments
    for (const arg of args) {
      if (arg.startsWith('-')) {
        for (const flag of arg.slice(1)) {
          if (flag === 'a') showAll = true;
          else if (flag === 'A') showAlmostAll = true;
          else if (flag === 'l') longFormat = true;
          else if (flag === 'R') recursive = true;
        }
      }
    }

    const showHidden = showAll || showAlmostAll;
    // TODO: Add . and .. entries when showAll is true (but not showAlmostAll)
    // TODO: Fix recursive listing format to match real bash

    try {
      let entries = await ctx.fs.readdir(ctx.cwd);
      if (!showHidden) {
        entries = entries.filter(e => !e.startsWith('.'));
      }
      return { stdout: entries.join('\\n') + '\\n', stderr: '', exitCode: 0 };
    } catch {
      return { stdout: '', stderr: 'ls: error\\n', exitCode: 1 };
    }
  },
};
`,

      // ls unit tests
      "/project/src/commands/ls/ls.test.ts": `import { describe, it, expect } from 'vitest';
import { Bash } from '../../BashEnv.js';

describe('ls command', () => {
  it('should list directory contents', async () => {
    const env = new Bash({
      files: { '/dir/file.txt': '' },
    });
    const result = await env.exec('ls /dir');
    expect(result.stdout).toContain('file.txt');
  });

  it('should hide hidden files by default', async () => {
    const env = new Bash({
      files: {
        '/dir/.hidden': '',
        '/dir/visible.txt': '',
      },
    });
    const result = await env.exec('ls /dir');
    expect(result.stdout).not.toContain('.hidden');
    expect(result.stdout).toContain('visible.txt');
  });

  it('should show hidden files with -a', async () => {
    const env = new Bash({
      files: {
        '/dir/.hidden': '',
        '/dir/visible.txt': '',
      },
    });
    const result = await env.exec('ls -a /dir');
    expect(result.stdout).toContain('.hidden');
  });

  // Test expects -a to include . and ..
  it.skip('should include . and .. with -a flag', async () => {
    const env = new Bash({
      files: { '/dir/file.txt': '' },
    });
    const result = await env.exec('ls -a /dir');
    expect(result.stdout).toContain('.');
    expect(result.stdout).toContain('..');
  });

  // Test expects -A to NOT include . and ..
  it('should show hidden files with -A but not . and ..', async () => {
    const env = new Bash({
      files: {
        '/dir/.hidden': '',
        '/dir/visible.txt': '',
      },
    });
    const result = await env.exec('ls -A /dir');
    expect(result.stdout).toContain('.hidden');
  });
});
`,

      // find command
      "/project/src/commands/find/find.ts": `import { Command, CommandContext, ExecResult } from '../../types.js';

export const findCommand: Command = {
  name: 'find',

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    let searchPath = '.';
    let namePattern: string | null = null;

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-name' && args[i + 1]) {
        namePattern = args[++i];
      } else if (!args[i].startsWith('-')) {
        searchPath = args[i];
      }
    }

    // TODO: When searching from '.', the name should be '.' for matching
    // Currently fails: find . -name ".*" doesn't match '.'

    return { stdout: '', stderr: '', exitCode: 0 };
  },
};
`,

      // Comparison tests
      "/project/src/comparison-tests/ls.comparison.test.ts": `import { describe, it, beforeEach, afterEach } from 'vitest';
import { createTestDir, cleanupTestDir, setupFiles, compareOutputs } from './test-helpers.js';

describe('ls command - Real Bash Comparison', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should match directory listing', async () => {
    const env = await setupFiles(testDir, {
      'file1.txt': 'content',
      'file2.txt': 'content',
    });
    await compareOutputs(env, testDir, 'ls');
  });

  // TODO: ls -a includes . and .. which BashEnv doesn't have
  it.skip('should match -a (show hidden)', async () => {
    const env = await setupFiles(testDir, {
      '.hidden': '',
      'visible.txt': '',
    });
    await compareOutputs(env, testDir, 'ls -a');
  });

  // TODO: ls -A output order differs between BashEnv and real bash
  it.skip('should match -A (show hidden except . and ..)', async () => {
    const env = await setupFiles(testDir, {
      '.hidden': '',
      'visible.txt': '',
    });
    await compareOutputs(env, testDir, 'ls -A');
  });

  // TODO: ls -R output format differs between BashEnv and real bash
  it.skip('should match -R (recursive)', async () => {
    const env = await setupFiles(testDir, {
      'file.txt': '',
      'dir/file1.txt': '',
      'dir/sub/file2.txt': '',
    });
    await compareOutputs(env, testDir, 'ls -R');
  });
});
`,

      // grep comparison tests
      "/project/src/comparison-tests/grep.comparison.test.ts": `import { describe, it, beforeEach, afterEach } from 'vitest';
import { createTestDir, cleanupTestDir, setupFiles, compareOutputs } from './test-helpers.js';

describe('grep command - Real Bash Comparison', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it('should match basic grep', async () => {
    const env = await setupFiles(testDir, {
      'test.txt': 'hello world\\n',
    });
    await compareOutputs(env, testDir, 'grep hello test.txt');
  });

  // TODO: grep exit code behavior differs from real bash
  it.skip('should match with no results', async () => {
    const env = await setupFiles(testDir, {
      'test.txt': 'hello world\\n',
    });
    await compareOutputs(env, testDir, 'grep notfound test.txt || true');
  });
});
`,

      // Test helpers
      "/project/src/comparison-tests/test-helpers.ts": `import { Bash } from '../BashEnv.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

export const execAsync = promisify(exec);

export async function createTestDir(): Promise<string> {
  const testDir = path.join('/tmp', 'bashenv-test-' + Date.now());
  await fs.mkdir(testDir, { recursive: true });
  return testDir;
}

export async function cleanupTestDir(testDir: string): Promise<void> {
  await fs.rm(testDir, { recursive: true, force: true });
}

export async function setupFiles(
  testDir: string,
  files: Record<string, string>
): Promise<Bash> {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(testDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  const bashEnvFiles: Record<string, string> = {};
  for (const [filePath, content] of Object.entries(files)) {
    bashEnvFiles[path.join(testDir, filePath)] = content;
  }

  return new Bash({
    files: bashEnvFiles,
    cwd: testDir,
  });
}

export async function compareOutputs(
  env: Bash,
  testDir: string,
  command: string
): Promise<void> {
  const [bashEnvResult, realBashResult] = await Promise.all([
    env.exec(command),
    runRealBash(command, testDir),
  ]);

  if (bashEnvResult.stdout !== realBashResult.stdout) {
    throw new Error('stdout mismatch');
  }
}

async function runRealBash(command: string, cwd: string) {
  const { stdout, stderr } = await execAsync(command, { cwd, shell: '/bin/bash' });
  return { stdout, stderr, exitCode: 0 };
}
`,

      // Types
      "/project/src/types.ts": `export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Command {
  name: string;
  execute(args: string[], ctx: CommandContext): Promise<ExecResult>;
}

export interface CommandContext {
  cwd: string;
  fs: VirtualFs;
  stdin: string;
  env: Record<string, string>;
}
`,

      // Package.json
      "/project/package.json": JSON.stringify(
        {
          name: "bash-env",
          version: "1.0.0",
          type: "module",
          scripts: {
            test: "vitest",
            "test:run": "vitest run",
          },
          devDependencies: {
            vitest: "^4.0.0",
            typescript: "^5.0.0",
          },
        },
        null,
        2,
      ),
    },
    cwd: "/project",
  });
}

describe("Agent Scenario: Feature Implementation", () => {
  describe("Step 1: Find skipped tests to understand requirements", () => {
    it("should find all skipped tests", async () => {
      const env = createEnv();
      const result = await env.exec('grep -rn "it.skip" /project/src');
      expect(result.stdout).toContain("it.skip");
      expect(result.stdout).toContain("ls.comparison.test.ts");
      expect(result.stdout).toContain("ls.test.ts");
    });

    it("should identify specific issues from skip comments", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -B1 "it.skip" /project/src/comparison-tests/ls.comparison.test.ts',
      );
      expect(result.stdout).toContain("TODO");
      expect(result.stdout).toContain(". and ..");
    });
  });

  describe("Step 2: Read skipped test to understand requirements", () => {
    it("should read the comparison test file", async () => {
      const env = createEnv();
      const result = await env.exec(
        "cat /project/src/comparison-tests/ls.comparison.test.ts",
      );
      expect(result.stdout).toContain("ls -a");
      expect(result.stdout).toContain("ls -A");
      expect(result.stdout).toContain("ls -R");
    });

    it("should understand what compareOutputs does", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -A5 "compareOutputs" /project/src/comparison-tests/test-helpers.ts',
      );
      expect(result.stdout).toContain("bashEnvResult");
      expect(result.stdout).toContain("realBashResult");
    });
  });

  describe("Step 3: Understand current implementation", () => {
    it("should read the ls command implementation", async () => {
      const env = createEnv();
      const result = await env.exec("cat /project/src/commands/ls/ls.ts");
      expect(result.stdout).toContain("showAll");
      expect(result.stdout).toContain("showAlmostAll");
      expect(result.stdout).toContain("recursive");
    });

    it("should find relevant flags handling", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -n "showAll\\|showHidden" /project/src/commands/ls/ls.ts',
      );
      expect(result.stdout).toContain("showAll");
      expect(result.stdout).toContain("showHidden");
    });

    it("should find TODO comments in implementation", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -n "TODO" /project/src/commands/ls/ls.ts',
      );
      expect(result.stdout).toContain("TODO");
      expect(result.stdout).toContain(". and ..");
    });
  });

  describe("Step 4: Find where commands are registered", () => {
    it("should locate command registration", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -n "registerCommand" /project/src/BashEnv.ts',
      );
      expect(result.stdout).toContain("registerCommand");
      expect(result.stdout).toContain("lsCommand");
    });

    it("should find TODO for missing commands", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -n "TODO.*command" /project/src/BashEnv.ts',
      );
      expect(result.stdout).toContain("true");
      expect(result.stdout).toContain("false");
    });
  });

  describe("Step 5: Explore related files", () => {
    it("should find files that use ls flags", async () => {
      const env = createEnv();
      const result = await env.exec('grep -rl "ls -a\\|ls -A" /project/src');
      expect(result.stdout).toContain("ls.comparison.test.ts");
      expect(result.stdout).toContain("ls.test.ts");
    });

    it("should find unit tests to update", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -n "should.*-a" /project/src/commands/ls/ls.test.ts',
      );
      expect(result.stdout).toContain("should");
      expect(result.stdout).toContain("-a");
    });
  });

  describe("Step 6: Understand filesystem implementation", () => {
    it("should read the fs implementation", async () => {
      const env = createEnv();
      const result = await env.exec("cat /project/src/fs.ts");
      expect(result.stdout).toContain("VirtualFs");
      expect(result.stdout).toContain("readdir");
    });

    it("should find TODO for missing methods", async () => {
      const env = createEnv();
      const result = await env.exec('grep -n "TODO" /project/src/fs.ts');
      expect(result.stdout).toContain("mkdirSync");
    });
  });

  describe("Step 7: Verify test patterns", () => {
    it("should understand test structure", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -n "describe\\|it(" /project/src/commands/ls/ls.test.ts | head -10',
      );
      expect(result.stdout).toContain("describe");
      expect(result.stdout).toContain("it(");
    });

    it("should find assertions in tests", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -n "expect" /project/src/commands/ls/ls.test.ts',
      );
      expect(result.stdout).toContain("expect");
      expect(result.stdout).toContain("toContain");
    });
  });

  describe("Step 8: Comprehensive exploration workflow", () => {
    it("should trace the full implementation path", async () => {
      const env = createEnv();

      // Find skipped tests
      const skipped = await env.exec(
        'grep -c "it.skip" /project/src/comparison-tests/ls.comparison.test.ts',
      );
      expect(parseInt(skipped.stdout.trim(), 10)).toBeGreaterThan(0);

      // Find the implementation
      const impl = await env.exec(
        'find /project/src/commands -name "ls.ts" | grep -v test',
      );
      expect(impl.stdout).toContain("ls.ts");

      // Check for TODOs in implementation
      const todos = await env.exec(
        'grep -c "TODO" /project/src/commands/ls/ls.ts',
      );
      expect(parseInt(todos.stdout.trim(), 10)).toBeGreaterThan(0);

      // Find related tests
      const tests = await env.exec(
        'find /project/src -name "*.test.ts" | grep ls',
      );
      expect(tests.stdout).toContain("ls.test.ts");
      expect(tests.stdout).toContain("ls.comparison.test.ts");
    });

    it("should find all files needing modification", async () => {
      const env = createEnv();

      // Files with skipped tests
      const skippedFiles = await env.exec('grep -rl "it.skip" /project/src');
      expect(skippedFiles.stdout).toContain("ls.comparison.test.ts");
      expect(skippedFiles.stdout).toContain("ls.test.ts");
      expect(skippedFiles.stdout).toContain("grep.comparison.test.ts");

      // Files with TODOs
      const todoFiles = await env.exec('grep -rl "TODO" /project/src');
      expect(todoFiles.stdout).toContain("ls.ts");
      expect(todoFiles.stdout).toContain("fs.ts");
      expect(todoFiles.stdout).toContain("BashEnv.ts");
    });
  });

  describe("Step 9: Search for patterns to replicate", () => {
    it("should find async execute pattern", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -rn "async execute" /project/src/commands',
      );
      expect(result.stdout).toContain("async execute");
    });

    it("should find Command interface implementations", async () => {
      const env = createEnv();
      const result = await env.exec(
        'grep -rn "Command = {" /project/src/commands',
      );
      expect(result.stdout).toContain("lsCommand");
      expect(result.stdout).toContain("findCommand");
    });

    it("should find error handling patterns", async () => {
      const env = createEnv();
      const result = await env.exec('grep -rn "catch" /project/src/commands');
      expect(result.stdout).toContain("catch");
    });
  });
});

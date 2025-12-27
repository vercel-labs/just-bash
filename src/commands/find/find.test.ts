import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("find command", () => {
  const createEnv = () =>
    new Bash({
      files: {
        "/project/README.md": "# Project",
        "/project/src/index.ts": "export {}",
        "/project/src/utils/helpers.ts": "export function helper() {}",
        "/project/src/utils/format.ts": "export function format() {}",
        "/project/tests/index.test.ts": 'test("works", () => {})',
        "/project/package.json": "{}",
        "/project/tsconfig.json": "{}",
      },
      cwd: "/project",
    });

  it("should find all files and directories from path", async () => {
    const env = createEnv();
    const result = await env.exec("find /project");
    expect(result.stdout).toBe(`/project
/project/README.md
/project/package.json
/project/src
/project/src/index.ts
/project/src/utils
/project/src/utils/format.ts
/project/src/utils/helpers.ts
/project/tests
/project/tests/index.test.ts
/project/tsconfig.json
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find files by name pattern", async () => {
    const env = createEnv();
    const result = await env.exec('find /project -name "*.ts"');
    expect(result.stdout).toBe(`/project/src/index.ts
/project/src/utils/format.ts
/project/src/utils/helpers.ts
/project/tests/index.test.ts
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find files only with -type f", async () => {
    const env = createEnv();
    const result = await env.exec("find /project -type f");
    expect(result.stdout).toBe(`/project/README.md
/project/package.json
/project/src/index.ts
/project/src/utils/format.ts
/project/src/utils/helpers.ts
/project/tests/index.test.ts
/project/tsconfig.json
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find directories only with -type d", async () => {
    const env = createEnv();
    const result = await env.exec("find /project -type d");
    expect(result.stdout).toBe(`/project
/project/src
/project/src/utils
/project/tests
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find files matching JSON pattern", async () => {
    const env = createEnv();
    const result = await env.exec('find /project -name "*.json"');
    expect(result.stdout).toBe(`/project/package.json
/project/tsconfig.json
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find from current directory with .", async () => {
    const env = createEnv();
    const result = await env.exec('find . -name "*.md"');
    expect(result.stdout).toBe("./README.md\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should combine -name and -type", async () => {
    const env = createEnv();
    const result = await env.exec('find /project -name "*.ts" -type f');
    expect(result.stdout).toBe(`/project/src/index.ts
/project/src/utils/format.ts
/project/src/utils/helpers.ts
/project/tests/index.test.ts
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find specific filename", async () => {
    const env = createEnv();
    const result = await env.exec('find /project -name "index.ts"');
    expect(result.stdout).toBe("/project/src/index.ts\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should return error for non-existent path", async () => {
    const env = createEnv();
    const result = await env.exec("find /nonexistent");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "find: /nonexistent: No such file or directory\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("should find test files", async () => {
    const env = createEnv();
    const result = await env.exec('find /project -name "*.test.ts"');
    expect(result.stdout).toBe("/project/tests/index.test.ts\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should handle ? wildcard in name pattern", async () => {
    const env = createEnv();
    const result = await env.exec('find /project -name "???*.json"');
    expect(result.stdout).toBe(`/project/package.json
/project/tsconfig.json
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  // OR operator tests
  describe("-o flag (OR)", () => {
    it("should find files matching either pattern with -o", async () => {
      const env = createEnv();
      const result = await env.exec(
        'find /project -name "*.md" -o -name "*.json"',
      );
      expect(result.stdout).toBe(`/project/README.md
/project/package.json
/project/tsconfig.json
`);
      expect(result.exitCode).toBe(0);
    });

    it("should support -or as alias for -o", async () => {
      const env = createEnv();
      const result = await env.exec(
        'find /project -name "*.md" -or -name "*.json"',
      );
      expect(result.stdout).toBe(`/project/README.md
/project/package.json
/project/tsconfig.json
`);
      expect(result.exitCode).toBe(0);
    });

    it("should give AND higher precedence than OR", async () => {
      const env = createEnv();
      // This should find: (files named *.md) OR (files named *.json)
      // NOT: files named (*.md OR *.json) - which would be the same in this case
      const result = await env.exec(
        'find /project -type f -name "*.md" -o -type f -name "*.json"',
      );
      expect(result.stdout).toBe(`/project/README.md
/project/package.json
/project/tsconfig.json
`);
      expect(result.exitCode).toBe(0);
    });

    it("should work with multiple OR conditions", async () => {
      const env = new Bash({
        files: {
          "/dir/a.txt": "",
          "/dir/b.md": "",
          "/dir/c.json": "",
          "/dir/d.ts": "",
        },
      });
      const result = await env.exec(
        'find /dir -name "*.txt" -o -name "*.md" -o -name "*.json"',
      );
      expect(result.stdout).toBe(`/dir/a.txt
/dir/b.md
/dir/c.json
`);
      expect(result.exitCode).toBe(0);
    });

    it("should combine type and name with OR correctly", async () => {
      const env = createEnv();
      // Find TypeScript files OR any directory
      const result = await env.exec(
        'find /project -type f -name "*.ts" -o -type d',
      );
      // All .ts files plus all directories
      expect(result.stdout).toContain("/project/src/index.ts");
      expect(result.stdout).toContain("/project\n");
      expect(result.stdout).toContain("/project/src\n");
      expect(result.exitCode).toBe(0);
    });

    it("should find auth-related files", async () => {
      const env = new Bash({
        files: {
          "/app/src/auth/login.ts": "",
          "/app/src/auth/jwt.ts": "",
          "/app/src/api/users.ts": "",
        },
      });
      const result = await env.exec(
        'find /app/src -type f -name "*auth*" -o -type f -name "*login*" -o -type f -name "*jwt*"',
      );
      expect(result.stdout).toBe(`/app/src/auth/jwt.ts
/app/src/auth/login.ts
`);
      expect(result.exitCode).toBe(0);
    });
  });

  // AND operator tests
  describe("-a flag (AND)", () => {
    it("should work with explicit -a flag", async () => {
      const env = createEnv();
      const result = await env.exec('find /project -type f -a -name "*.ts"');
      expect(result.stdout).toBe(`/project/src/index.ts
/project/src/utils/format.ts
/project/src/utils/helpers.ts
/project/tests/index.test.ts
`);
      expect(result.exitCode).toBe(0);
    });

    it("should support -and as alias", async () => {
      const env = createEnv();
      const result = await env.exec(
        'find /project -type f -and -name "*.json"',
      );
      expect(result.stdout).toBe(`/project/package.json
/project/tsconfig.json
`);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-maxdepth option", () => {
    it("should limit depth to 0 (only starting point)", async () => {
      const env = createEnv();
      const result = await env.exec("find /project -maxdepth 0");
      expect(result.stdout).toBe("/project\n");
      expect(result.exitCode).toBe(0);
    });

    it("should limit depth to 1 (immediate children)", async () => {
      const env = createEnv();
      const result = await env.exec("find /project -maxdepth 1");
      expect(result.stdout).toBe(`/project
/project/README.md
/project/package.json
/project/src
/project/tests
/project/tsconfig.json
`);
      expect(result.exitCode).toBe(0);
    });

    it("should limit depth to 2", async () => {
      const env = createEnv();
      const result = await env.exec('find /project -maxdepth 2 -name "*.ts"');
      expect(result.stdout).toBe(`/project/src/index.ts
/project/tests/index.test.ts
`);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-mindepth option", () => {
    it("should skip results at depth 0", async () => {
      const env = createEnv();
      const result = await env.exec("find /project -mindepth 1 -type d");
      expect(result.stdout).toBe(`/project/src
/project/src/utils
/project/tests
`);
      expect(result.exitCode).toBe(0);
    });

    it("should skip results at depth 0 and 1", async () => {
      const env = createEnv();
      const result = await env.exec(
        'find /project -mindepth 2 -type f -name "*.ts"',
      );
      expect(result.stdout).toBe(`/project/src/index.ts
/project/src/utils/format.ts
/project/src/utils/helpers.ts
/project/tests/index.test.ts
`);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("combined -maxdepth and -mindepth", () => {
    it("should find only at specific depth", async () => {
      const env = createEnv();
      const result = await env.exec(
        "find /project -mindepth 1 -maxdepth 1 -type f",
      );
      expect(result.stdout).toBe(`/project/README.md
/project/package.json
/project/tsconfig.json
`);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--help option", () => {
    it("should show help text", async () => {
      const env = createEnv();
      const result = await env.exec("find --help");
      expect(result.stdout).toContain("find");
      expect(result.stdout).toContain("-name");
      expect(result.stdout).toContain("-maxdepth");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-iname (case insensitive)", () => {
    it("should find files case insensitively", async () => {
      const env = new Bash({
        files: {
          "/dir/README.md": "",
          "/dir/readme.txt": "",
          "/dir/Readme.rst": "",
          "/dir/other.txt": "",
        },
      });
      const result = await env.exec('find /dir -iname "readme*"');
      expect(result.stdout).toContain("README.md");
      expect(result.stdout).toContain("readme.txt");
      expect(result.stdout).toContain("Readme.rst");
      expect(result.stdout).not.toContain("other.txt");
      expect(result.exitCode).toBe(0);
    });

    it("should match uppercase pattern to lowercase file", async () => {
      const env = new Bash({
        files: {
          "/dir/config.json": "",
        },
      });
      const result = await env.exec('find /dir -iname "CONFIG.JSON"');
      expect(result.stdout).toContain("config.json");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-path option", () => {
    it("should match against full path", async () => {
      const env = createEnv();
      const result = await env.exec('find /project -path "*/utils/*"');
      expect(result.stdout).toContain("/project/src/utils/helpers.ts");
      expect(result.stdout).toContain("/project/src/utils/format.ts");
      expect(result.stdout).not.toContain("/project/src/index.ts");
      expect(result.exitCode).toBe(0);
    });

    it("should match path pattern with extension", async () => {
      const env = createEnv();
      const result = await env.exec('find /project -path "*tests*"');
      expect(result.stdout).toContain("/project/tests");
      expect(result.stdout).toContain("/project/tests/index.test.ts");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-ipath option", () => {
    it("should match path case insensitively", async () => {
      const env = new Bash({
        files: {
          "/Project/SRC/file.ts": "",
          "/Project/src/other.ts": "",
        },
      });
      const result = await env.exec('find /Project -ipath "*src*"');
      expect(result.stdout).toContain("SRC");
      expect(result.stdout).toContain("src");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-empty option", () => {
    it("should find empty files", async () => {
      const env = new Bash({
        files: {
          "/dir/empty.txt": "",
          "/dir/notempty.txt": "content",
        },
      });
      const result = await env.exec("find /dir -empty -type f");
      expect(result.stdout).toContain("empty.txt");
      expect(result.stdout).not.toContain("notempty.txt");
      expect(result.exitCode).toBe(0);
    });

    it("should find empty directories", async () => {
      const _env = new Bash({
        files: {
          "/dir/emptydir/.keep": "", // Create then we'll remove the file conceptually
          "/dir/notempty/file.txt": "content",
        },
      });
      // The emptydir has a file so it's not empty, notempty has a file
      // Let's create a truly empty directory scenario
      const env2 = new Bash({
        files: {
          "/dir/notempty/file.txt": "content",
        },
      });
      // Add empty directory manually via mkdir
      await env2.exec("mkdir /dir/emptydir");
      const result = await env2.exec("find /dir -empty -type d");
      expect(result.stdout).toContain("emptydir");
      expect(result.stdout).not.toContain("notempty");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-not and ! (negation)", () => {
    it("should negate name pattern with -not", async () => {
      const env = createEnv();
      const result = await env.exec('find /project -type f -not -name "*.ts"');
      expect(result.stdout).toContain("README.md");
      expect(result.stdout).toContain("package.json");
      expect(result.stdout).toContain("tsconfig.json");
      expect(result.stdout).not.toContain("index.ts");
      expect(result.exitCode).toBe(0);
    });

    it("should negate with multiple -not", async () => {
      const env = createEnv();
      // Exclude both .json and .md files
      const result = await env.exec(
        'find /project -type f -not -name "*.json" -not -name "*.md"',
      );
      expect(result.stdout).toContain("index.ts");
      expect(result.stdout).toContain("helpers.ts");
      expect(result.stdout).not.toContain("package.json");
      expect(result.stdout).not.toContain("README.md");
      expect(result.exitCode).toBe(0);
    });

    it("should negate type", async () => {
      const env = createEnv();
      const result = await env.exec("find /project -maxdepth 1 -not -type d");
      expect(result.stdout).toContain("README.md");
      expect(result.stdout).toContain("package.json");
      expect(result.stdout).not.toContain("/project\n");
      expect(result.exitCode).toBe(0);
    });

    it("should combine negation with OR", async () => {
      const env = new Bash({
        files: {
          "/dir/a.txt": "",
          "/dir/b.md": "",
          "/dir/c.json": "",
        },
      });
      // Find files that are NOT .txt
      const result = await env.exec('find /dir -type f -not -name "*.txt"');
      expect(result.stdout).toContain("b.md");
      expect(result.stdout).toContain("c.json");
      expect(result.stdout).not.toContain("a.txt");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("unknown option handling", () => {
    it("should error on unknown predicate", async () => {
      const env = createEnv();
      const result = await env.exec("find /project -unknown");
      expect(result.stderr).toContain("find: unknown predicate '-unknown'");
      expect(result.exitCode).toBe(1);
    });

    it("should error on unknown long option", async () => {
      const env = createEnv();
      const result = await env.exec("find /project --badoption");
      expect(result.stderr).toContain("find: unknown predicate '--badoption'");
      expect(result.exitCode).toBe(1);
    });

    it("should error on invalid -type argument", async () => {
      const env = createEnv();
      const result = await env.exec("find /project -type x");
      expect(result.stderr).toContain("Unknown argument to -type");
      expect(result.exitCode).toBe(1);
    });
  });
});

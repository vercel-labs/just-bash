import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Advanced Agent Scenario: Refactoring Workflow
 *
 * Simulates an AI agent performing a complex refactoring task:
 * - Renaming a function across multiple files
 * - Updating imports and exports
 * - Verifying no broken references remain
 */
describe("Agent Scenario: Refactoring Workflow", () => {
  const createEnv = () =>
    new Bash({
      files: {
        "/project/src/utils/string.ts": `export function formatUserName(first: string, last: string): string {
  return \`\${first} \${last}\`;
}

export function formatUserName_deprecated(name: string): string {
  return name.trim();
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
`,
        "/project/src/utils/index.ts": `export { formatUserName, capitalize } from './string';
export { validateEmail } from './validation';
`,
        "/project/src/utils/validation.ts": `export function validateEmail(email: string): boolean {
  return email.includes('@') && email.includes('.');
}
`,
        "/project/src/components/UserCard.tsx": `import { formatUserName, capitalize } from '../utils';

interface UserCardProps {
  firstName: string;
  lastName: string;
}

export function UserCard({ firstName, lastName }: UserCardProps) {
  const displayName = formatUserName(firstName, lastName);
  return <div>{capitalize(displayName)}</div>;
}
`,
        "/project/src/components/UserList.tsx": `import { formatUserName } from '../utils/string';

export function UserList({ users }) {
  return users.map(u => formatUserName(u.first, u.last));
}
`,
        "/project/src/services/user.ts": `import { formatUserName } from '../utils/string';
import { validateEmail } from '../utils/validation';

export class UserService {
  formatDisplay(user: { first: string; last: string }) {
    return formatUserName(user.first, user.last);
  }
}
`,
        "/project/src/tests/string.test.ts": `import { formatUserName, capitalize } from '../utils/string';

describe('formatUserName', () => {
  it('formats full name', () => {
    expect(formatUserName('John', 'Doe')).toBe('John Doe');
  });
});

describe('capitalize', () => {
  it('capitalizes first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
  });
});
`,
      },
      cwd: "/project",
    });

  it("should find all files containing the function to rename", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -r "formatUserName" /project/src --include="*.ts" --include="*.tsx"',
    );
    expect(
      result.stdout,
    ).toBe(`/project/src/components/UserCard.tsx:import { formatUserName, capitalize } from '../utils';
/project/src/components/UserCard.tsx:  const displayName = formatUserName(firstName, lastName);
/project/src/components/UserList.tsx:import { formatUserName } from '../utils/string';
/project/src/components/UserList.tsx:  return users.map(u => formatUserName(u.first, u.last));
/project/src/services/user.ts:import { formatUserName } from '../utils/string';
/project/src/services/user.ts:    return formatUserName(user.first, user.last);
/project/src/tests/string.test.ts:import { formatUserName, capitalize } from '../utils/string';
/project/src/tests/string.test.ts:describe('formatUserName', () => {
/project/src/tests/string.test.ts:    expect(formatUserName('John', 'Doe')).toBe('John Doe');
/project/src/utils/index.ts:export { formatUserName, capitalize } from './string';
/project/src/utils/string.ts:export function formatUserName(first: string, last: string): string {
/project/src/utils/string.ts:export function formatUserName_deprecated(name: string): string {
`);
    expect(result.exitCode).toBe(0);
  });

  it("should count occurrences per file", async () => {
    const env = createEnv();
    const result = await env.exec('grep -r -c "formatUserName" /project/src');
    expect(result.stdout).toBe(`/project/src/components/UserCard.tsx:2
/project/src/components/UserList.tsx:2
/project/src/services/user.ts:2
/project/src/tests/string.test.ts:3
/project/src/utils/index.ts:1
/project/src/utils/string.ts:2
/project/src/utils/validation.ts:0
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find export statements to update", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -r "export.*formatUserName" /project/src',
    );
    expect(
      result.stdout,
    ).toBe(`/project/src/utils/index.ts:export { formatUserName, capitalize } from './string';
/project/src/utils/string.ts:export function formatUserName(first: string, last: string): string {
/project/src/utils/string.ts:export function formatUserName_deprecated(name: string): string {
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find import statements to update", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -r "import.*formatUserName" /project/src',
    );
    expect(
      result.stdout,
    ).toBe(`/project/src/components/UserCard.tsx:import { formatUserName, capitalize } from '../utils';
/project/src/components/UserList.tsx:import { formatUserName } from '../utils/string';
/project/src/services/user.ts:import { formatUserName } from '../utils/string';
/project/src/tests/string.test.ts:import { formatUserName, capitalize } from '../utils/string';
`);
    expect(result.exitCode).toBe(0);
  });

  it("should perform the rename using sed", async () => {
    const env = createEnv();

    // Rename in the source file
    await env.exec(
      "sed 's/formatUserName/formatFullName/g' /project/src/utils/string.ts > /project/src/utils/string.ts.new",
    );
    await env.exec(
      "mv /project/src/utils/string.ts.new /project/src/utils/string.ts",
    );

    // Verify the change
    const result = await env.exec(
      'grep "formatFullName" /project/src/utils/string.ts',
    );
    expect(
      result.stdout,
    ).toBe(`export function formatFullName(first: string, last: string): string {
export function formatFullName_deprecated(name: string): string {
`);
    expect(result.exitCode).toBe(0);
  });

  it("should verify no orphaned references after full rename", async () => {
    const env = createEnv();

    // Simulate full rename across all files
    const files = [
      "/project/src/utils/string.ts",
      "/project/src/utils/index.ts",
      "/project/src/components/UserCard.tsx",
      "/project/src/components/UserList.tsx",
      "/project/src/services/user.ts",
      "/project/src/tests/string.test.ts",
    ];

    for (const file of files) {
      await env.exec(
        `sed 's/formatUserName/formatFullName/g' ${file} > ${file}.new`,
      );
      await env.exec(`mv ${file}.new ${file}`);
    }

    // Verify old name no longer exists (except in _deprecated suffix)
    const result = await env.exec(
      'grep -r "formatUserName[^_]" /project/src || echo "No orphaned references"',
    );
    expect(result.stdout).toBe("No orphaned references\n");
    expect(result.exitCode).toBe(0);
  });

  it("should find deprecated functions for cleanup", async () => {
    const env = createEnv();
    const result = await env.exec('grep -rn "_deprecated" /project/src');
    expect(result.stdout).toBe(
      "/project/src/utils/string.ts:5:export function formatUserName_deprecated(name: string): string {\n",
    );
    expect(result.exitCode).toBe(0);
  });

  it("should analyze function usage patterns", async () => {
    const env = createEnv();

    // Find all function calls (simplified pattern)
    const result = await env.exec('grep -r "formatUserName(" /project/src');
    expect(
      result.stdout,
    ).toBe(`/project/src/components/UserCard.tsx:  const displayName = formatUserName(firstName, lastName);
/project/src/components/UserList.tsx:  return users.map(u => formatUserName(u.first, u.last));
/project/src/services/user.ts:    return formatUserName(user.first, user.last);
/project/src/tests/string.test.ts:    expect(formatUserName('John', 'Doe')).toBe('John Doe');
/project/src/utils/string.ts:export function formatUserName(first: string, last: string): string {
`);
    expect(result.exitCode).toBe(0);
  });

  it("should list all TypeScript/TSX files in project", async () => {
    const env = createEnv();
    const result = await env.exec(
      'find /project/src -name "*.ts" -o -name "*.tsx" | sort',
    );
    expect(result.stdout).toBe(`/project/src/components/UserCard.tsx
/project/src/components/UserList.tsx
/project/src/services/user.ts
/project/src/tests/string.test.ts
/project/src/utils/index.ts
/project/src/utils/string.ts
/project/src/utils/validation.ts
`);
    expect(result.exitCode).toBe(0);
  });

  it("should count total lines of code to refactor", async () => {
    const env = createEnv();
    const result = await env.exec(
      "cat /project/src/utils/string.ts /project/src/components/UserCard.tsx /project/src/components/UserList.tsx | wc -l",
    );
    expect(result.stdout).toBe("27\n");
    expect(result.exitCode).toBe(0);
  });
});

describe("Agent Scenario: Advanced sed for Code Transformations", () => {
  const createAdvancedEnv = () =>
    new Bash({
      files: {
        "/code/imports.ts": `import { foo } from './foo';
import { bar } from './bar';
import { baz } from './baz';
import { qux } from './qux';`,
        "/code/multiline.ts": `const config = {
  name: "app",
  version: "1.0.0"
};

const settings = {
  debug: true,
  port: 3000
};`,
        "/code/deprecated.ts": `// @deprecated Use newFunc instead
function oldFunc() {
  return 1;
}

// @deprecated Will be removed in v2
function anotherOldFunc() {
  return 2;
}

function activeFunc() {
  return 3;
}`,
        "/code/css-vars.css": `body {
  color: #333333;
  background: #ffffff;
  border: 1px solid #cccccc;
}`,
        "/code/case-conv.txt": `userId
userName
userEmail
accountId`,
        "/code/numbered.txt": `first line
second line
third line
fourth line
fifth line`,
      },
      cwd: "/code",
    });

  describe("Using sed N for multiline operations", () => {
    it("should join consecutive import lines", async () => {
      const env = createAdvancedEnv();
      // N appends next line to pattern space, allowing multiline matching
      const result = await env.exec(
        "sed 'N;s/\\n/, /' /code/imports.ts | head -2",
      );
      expect(result.stdout).toContain("foo");
      expect(result.stdout).toContain("bar");
      expect(result.exitCode).toBe(0);
    });

    it("should combine object properties on single line", async () => {
      const env = createAdvancedEnv();
      // Use grep -A1 to show name with following line
      const result = await env.exec("grep -A1 'name:' /code/multiline.ts");
      expect(result.stdout).toContain("name:");
      expect(result.stdout).toContain("version:");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Using sed y for character transliteration", () => {
    it("should convert hex colors to uppercase", async () => {
      const env = createAdvancedEnv();
      const result = await env.exec(
        "sed 'y/abcdef/ABCDEF/' /code/css-vars.css",
      );
      expect(result.stdout).toContain("#333333");
      expect(result.stdout).toContain("#FFFFFF");
      expect(result.stdout).toContain("#CCCCCC");
      expect(result.exitCode).toBe(0);
    });

    it("should convert camelCase to snake_case style markers", async () => {
      const env = createAdvancedEnv();
      // Replace capital letters with markers for further processing
      const result = await env.exec(
        "sed 'y/ABCDEFGHIJKLMNOPQRSTUVWXYZ/abcdefghijklmnopqrstuvwxyz/' /code/case-conv.txt",
      );
      expect(result.stdout).toContain("userid");
      expect(result.stdout).toContain("username");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Using sed = for line numbering", () => {
    it("should add line numbers to code", async () => {
      const env = createAdvancedEnv();
      const result = await env.exec("sed '=' /code/numbered.txt | head -6");
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("first line");
      expect(result.stdout).toContain("2");
      expect(result.stdout).toContain("second line");
      expect(result.exitCode).toBe(0);
    });

    it("should number only lines matching a pattern", async () => {
      const env = createAdvancedEnv();
      // Use grep -n to show line numbers for matching lines
      const result = await env.exec("grep -n 'deprecated' /code/deprecated.ts");
      // Should show line numbers for deprecated comments
      expect(result.stdout).toContain("@deprecated");
      expect(result.stdout).toMatch(/^\d+:/m); // line number prefix
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Finding active vs deprecated code", () => {
    it("should find active functions (not deprecated)", async () => {
      const env = createAdvancedEnv();
      // Use grep to find functions, then filter out those near @deprecated
      const result = await env.exec(
        "grep 'function activeFunc' /code/deprecated.ts",
      );
      expect(result.stdout).toContain("function activeFunc");
      expect(result.exitCode).toBe(0);
    });

    it("should identify deprecated functions", async () => {
      const env = createAdvancedEnv();
      // Show deprecated functions with context
      const result = await env.exec(
        "grep -A2 '@deprecated' /code/deprecated.ts",
      );
      expect(result.stdout).toContain("@deprecated");
      expect(result.stdout).toContain("function oldFunc");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Complex refactoring workflows with sed", () => {
    it("should convert single imports to barrel export", async () => {
      const env = createAdvancedEnv();
      // Transform import to export (simpler pattern)
      const result = await env.exec("sed 's/import/export/' /code/imports.ts");
      expect(result.stdout).toContain("export { foo }");
      expect(result.stdout).toContain("export { bar }");
      expect(result.exitCode).toBe(0);
    });

    it("should find functions that need documentation", async () => {
      const env = createAdvancedEnv();
      // Find function declarations that could use JSDoc
      const result = await env.exec("grep -n '^function' /code/deprecated.ts");
      expect(result.stdout).toContain("function oldFunc");
      expect(result.stdout).toContain("function activeFunc");
      expect(result.exitCode).toBe(0);
    });

    it("should indent code blocks", async () => {
      const env = createAdvancedEnv();
      // Add two spaces indent to all lines
      const result = await env.exec("sed 's/^/  /' /code/numbered.txt");
      expect(result.stdout).toBe(
        "  first line\n  second line\n  third line\n  fourth line\n  fifth line\n",
      );
      expect(result.exitCode).toBe(0);
    });
  });
});

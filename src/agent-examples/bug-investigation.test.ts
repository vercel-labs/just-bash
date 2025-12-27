import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Bug Investigation Scenario
 * An AI agent investigating a reported bug by examining code and tests.
 */
describe("Agent Scenario: Bug Investigation", () => {
  const createEnv = () =>
    new Bash({
      files: {
        "/project/src/utils/format.ts": `export function formatPrice(price: number): string {
  return '$' + price.toFixed(2);
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function formatPercent(value: number): string {
  // BUG: Should multiply by 100
  return value.toFixed(1) + '%';
}
`,
        "/project/src/utils/validate.ts": `export function validateEmail(email: string): boolean {
  return email.includes('@');
}

export function validatePrice(price: number): boolean {
  // BUG: Should check for negative
  return typeof price === 'number';
}
`,
        "/project/tests/format.test.ts": `import { formatPrice, formatPercent } from '../src/utils/format';

test('formatPrice formats correctly', () => {
  expect(formatPrice(10)).toBe('$10.00');
});

test('formatPercent formats correctly', () => {
  // This test passes but is wrong!
  expect(formatPercent(0.5)).toBe('0.5%');
  // Should be: expect(formatPercent(0.5)).toBe('50.0%');
});
`,
        "/project/tests/validate.test.ts": `import { validateEmail, validatePrice } from '../src/utils/validate';

test('validateEmail works', () => {
  expect(validateEmail('test@example.com')).toBe(true);
});

test('validatePrice works', () => {
  expect(validatePrice(10)).toBe(true);
  // Missing test for negative prices!
});
`,
        "/project/BUGS.md": `# Known Bugs

## BUG-001: Percentage formatting incorrect
- Reporter: user@example.com
- Status: Open
- Description: formatPercent(0.5) returns "0.5%" instead of "50.0%"

## BUG-002: Negative prices accepted
- Reporter: admin@example.com
- Status: Open
- Description: validatePrice(-10) returns true
`,
      },
      cwd: "/project",
    });

  it("should list project structure", async () => {
    const env = createEnv();
    const result = await env.exec("ls /project");
    expect(result.stdout).toBe("BUGS.md\nsrc\ntests\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should read bug report", async () => {
    const env = createEnv();
    const result = await env.exec("cat /project/BUGS.md");
    expect(result.stdout).toBe(`# Known Bugs

## BUG-001: Percentage formatting incorrect
- Reporter: user@example.com
- Status: Open
- Description: formatPercent(0.5) returns "0.5%" instead of "50.0%"

## BUG-002: Negative prices accepted
- Reporter: admin@example.com
- Status: Open
- Description: validatePrice(-10) returns true
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find formatPercent function", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -n "formatPercent" /project/src/utils/format.ts',
    );
    expect(result.stdout).toBe(
      "9:export function formatPercent(value: number): string {\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should read the format utils file", async () => {
    const env = createEnv();
    const result = await env.exec("cat /project/src/utils/format.ts");
    expect(
      result.stdout,
    ).toBe(`export function formatPrice(price: number): string {
  return '$' + price.toFixed(2);
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function formatPercent(value: number): string {
  // BUG: Should multiply by 100
  return value.toFixed(1) + '%';
}
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find BUG comments in code", async () => {
    const env = createEnv();
    const result = await env.exec('grep -r "BUG:" /project/src');
    expect(
      result.stdout,
    ).toBe(`/project/src/utils/format.ts:  // BUG: Should multiply by 100
/project/src/utils/validate.ts:  // BUG: Should check for negative
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find validatePrice function", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -n "validatePrice" /project/src/utils/validate.ts',
    );
    expect(result.stdout).toBe(
      "5:export function validatePrice(price: number): boolean {\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should read the validation utils file", async () => {
    const env = createEnv();
    const result = await env.exec("cat /project/src/utils/validate.ts");
    expect(
      result.stdout,
    ).toBe(`export function validateEmail(email: string): boolean {
  return email.includes('@');
}

export function validatePrice(price: number): boolean {
  // BUG: Should check for negative
  return typeof price === 'number';
}
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find related test file", async () => {
    const env = createEnv();
    const result = await env.exec("ls /project/tests");
    expect(result.stdout).toBe("format.test.ts\nvalidate.test.ts\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should read format tests", async () => {
    const env = createEnv();
    const result = await env.exec("cat /project/tests/format.test.ts");
    expect(
      result.stdout,
    ).toBe(`import { formatPrice, formatPercent } from '../src/utils/format';

test('formatPrice formats correctly', () => {
  expect(formatPrice(10)).toBe('$10.00');
});

test('formatPercent formats correctly', () => {
  // This test passes but is wrong!
  expect(formatPercent(0.5)).toBe('0.5%');
  // Should be: expect(formatPercent(0.5)).toBe('50.0%');
});
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find test for formatPercent", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -n "formatPercent" /project/tests/format.test.ts',
    );
    expect(
      result.stdout,
    ).toBe(`1:import { formatPrice, formatPercent } from '../src/utils/format';
7:test('formatPercent formats correctly', () => {
9:  expect(formatPercent(0.5)).toBe('0.5%');
10:  // Should be: expect(formatPercent(0.5)).toBe('50.0%');
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should read validate tests", async () => {
    const env = createEnv();
    const result = await env.exec("cat /project/tests/validate.test.ts");
    expect(
      result.stdout,
    ).toBe(`import { validateEmail, validatePrice } from '../src/utils/validate';

test('validateEmail works', () => {
  expect(validateEmail('test@example.com')).toBe(true);
});

test('validatePrice works', () => {
  expect(validatePrice(10)).toBe(true);
  // Missing test for negative prices!
});
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should count BUG comments", async () => {
    const env = createEnv();
    const result = await env.exec('grep -r -c "BUG:" /project/src');
    expect(result.stdout).toBe(`/project/src/utils/format.ts:1
/project/src/utils/validate.ts:1
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should find all Open bugs in report", async () => {
    const env = createEnv();
    const result = await env.exec('grep "Status: Open" /project/BUGS.md');
    expect(result.stdout).toBe(`- Status: Open
- Status: Open
`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should count open bugs", async () => {
    const env = createEnv();
    const result = await env.exec('grep -c "Status: Open" /project/BUGS.md');
    expect(result.stdout).toBe("2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

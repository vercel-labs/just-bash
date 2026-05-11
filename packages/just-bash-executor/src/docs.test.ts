/**
 * Documentation validation for README.md and SKILL.md.
 *
 * Goals:
 *   1. Both files exist and have substantive content.
 *   2. SKILL.md has the expected agent-facing structure (frontmatter, sections).
 *   3. Every fenced TypeScript code block in either file parses as valid TS
 *      syntax. We do NOT type-check (many snippets reference undeclared
 *      identifiers like INTROSPECTION_JSON or `tools.foo.bar` proxy access);
 *      syntax-only catches typos that would mislead readers.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const README_PATH = path.join(import.meta.dirname, "..", "README.md");
const SKILL_PATH = path.join(import.meta.dirname, "..", "SKILL.md");

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Pull every ```ts / ```typescript code block out of a markdown file.
 */
function extractTsBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const pattern = /```(?:ts|typescript)\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(pattern)) {
    blocks.push(match[1]);
  }
  return blocks;
}

/**
 * Parse a TS source string and return any syntactic diagnostics. We use
 * `createSourceFile` rather than a full Program so we don't pay for
 * cross-file type checking — these snippets aren't meant to be standalone.
 */
function syntaxDiagnostics(source: string): ts.Diagnostic[] {
  const sourceFile = ts.createSourceFile(
    "snippet.ts",
    source,
    ts.ScriptTarget.ES2022,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS,
  );
  // `parseDiagnostics` is internal but stable; cast through unknown to access.
  return (sourceFile as unknown as { parseDiagnostics: ts.Diagnostic[] })
    .parseDiagnostics;
}

function formatDiagnostics(
  diagnostics: ts.Diagnostic[],
  source: string,
): string {
  return diagnostics
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      if (d.file && d.start !== undefined) {
        const { line, character } = d.file.getLineAndCharacterOfPosition(
          d.start,
        );
        const lines = source.split("\n");
        const ctx = lines[line] ?? "";
        return `  line ${line + 1}:${character + 1}: ${message}\n    | ${ctx}`;
      }
      return `  ${message}`;
    })
    .join("\n");
}

describe("README.md", () => {
  it("exists and has substantive content", () => {
    const content = read(README_PATH);
    expect(content.length).toBeGreaterThan(2000);
    expect(content).toContain("@just-bash/executor");
    expect(content).toContain("createExecutor");
  });

  it("links to SKILL.md", () => {
    const content = read(README_PATH);
    expect(content).toContain("SKILL.md");
  });

  it("has TypeScript code blocks", () => {
    const blocks = extractTsBlocks(read(README_PATH));
    expect(blocks.length).toBeGreaterThan(3);
  });

  it("all TypeScript code blocks parse without syntax errors", () => {
    const blocks = extractTsBlocks(read(README_PATH));
    const failures: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const diagnostics = syntaxDiagnostics(blocks[i]);
      if (diagnostics.length > 0) {
        failures.push(
          `README.md block #${i + 1}:\n${formatDiagnostics(diagnostics, blocks[i])}`,
        );
      }
    }
    if (failures.length > 0) {
      expect.fail(
        `TypeScript syntax errors in README.md code blocks:\n\n${failures.join("\n\n")}`,
      );
    }
  });
});

describe("SKILL.md", () => {
  it("exists and has substantive content", () => {
    const content = read(SKILL_PATH);
    expect(content.length).toBeGreaterThan(2000);
  });

  it("has YAML frontmatter with name and description", () => {
    const content = read(SKILL_PATH);
    expect(content.startsWith("---\n")).toBe(true);
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    expect(frontmatterMatch).not.toBeNull();
    const frontmatter = frontmatterMatch?.[1] ?? "";
    expect(frontmatter).toMatch(/^name:\s*just-bash-executor\s*$/m);
    expect(frontmatter).toMatch(/^description:\s*\S/m);
  });

  it("covers all source kinds (OpenAPI, GraphQL, MCP, Inline)", () => {
    const content = read(SKILL_PATH);
    expect(content).toMatch(/§3.*OpenAPI/i);
    expect(content).toMatch(/§4.*GraphQL/i);
    expect(content).toMatch(/§5.*MCP/i);
    expect(content).toMatch(/§2.*Inline/i);
  });

  it("includes the JS API and bash CLI reference tables", () => {
    const content = read(SKILL_PATH);
    expect(content).toContain("await tools");
    expect(content).toContain("--json");
    expect(content).toContain("Mode precedence");
  });

  it("has TypeScript code blocks", () => {
    const blocks = extractTsBlocks(read(SKILL_PATH));
    expect(blocks.length).toBeGreaterThan(3);
  });

  it("all TypeScript code blocks parse without syntax errors", () => {
    const blocks = extractTsBlocks(read(SKILL_PATH));
    const failures: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const diagnostics = syntaxDiagnostics(blocks[i]);
      if (diagnostics.length > 0) {
        failures.push(
          `SKILL.md block #${i + 1}:\n${formatDiagnostics(diagnostics, blocks[i])}`,
        );
      }
    }
    if (failures.length > 0) {
      expect.fail(
        `TypeScript syntax errors in SKILL.md code blocks:\n\n${failures.join("\n\n")}`,
      );
    }
  });
});

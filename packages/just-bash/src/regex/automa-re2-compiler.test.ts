// Automa modification: retain the complete original RE2 compiler differential
// at its dependency boundary, independent of minified just-bash bundle names.

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const patterns = [
  "",
  "x",
  "^$",
  "(?:)",
  "a|b|c",
  "(a|b)(c|d)",
  "((a)?)(b*)",
  "(a|ab)+",
  "(ab|a)+?",
  "a*?",
  "a+?",
  "a??",
  "(?:a?)*",
  "(?:a?)+",
  "(?:(a)|())*?",
  "^a.{0,900}$",
  "records\\[.{0,900}",
  "(x){0,900}",
  "(x){1,900}",
  "(a|b){0,90}",
  "(a|ab){4,15}",
  "((a)?b){2,12}?",
  "(?:a?){0,90}",
  "(a){0,0}",
  "(a){1,1}",
  "(a){2,}",
  "(a){0,}",
  "(a){1,}",
  "(?i:[a-z]+)",
  "(?s:.){0,900}",
  "(?m:^a$)",
  "\\bword\\B",
  "(猫|🐈){2,20}",
  "[^\\n]{0,900}",
  "(?P<name>a|ab)(?P<tail>b*)",
  "(x){1000}",
  "(x){0,1000}",
  "(x){0,1000}?",
  "(x){999,1000}",
  "[]",
  "a{1001}",
  "(a)\\1",
  "(?=a)",
  "[z-a]",
  "(",
  "a**",
];

interface CompilerApi {
  Parser: { parse(pattern: string, flags: number): unknown };
  Simplify: { simplify(ast: unknown): unknown };
  RE2Flags: { PERL: number };
  Compiler: {
    compileRegexp(ast: unknown): {
      inst: unknown;
      start: number;
      numCap: number;
    };
    prototype: {
      compile: (ast: unknown) => unknown;
      compileLeaf: (ast: unknown) => unknown;
    };
  };
}

function records(api: CompilerApi) {
  return patterns.map((pattern) => {
    try {
      const ast = api.Simplify.simplify(
        api.Parser.parse(pattern, api.RE2Flags.PERL),
      );
      const program = api.Compiler.compileRegexp(ast);
      return {
        pattern,
        program: JSON.parse(
          JSON.stringify({
            inst: program.inst,
            start: program.start,
            numCap: program.numCap,
          }),
        ),
      };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return { pattern, error: { name: error.name, message: error.message } };
    }
  });
}

describe("Automa RE2 compiler", () => {
  it("preserves full instruction/capture ordering, rejection and low-stack behavior", async () => {
    const require = createRequire(import.meta.url);
    const source = await readFile(
      path.join(path.dirname(require.resolve("re2js")), "index.esm.js"),
      "utf8",
    );
    const scratch = await mkdtemp(path.join(tmpdir(), "automa-re2-audit-"));
    try {
      const target = path.join(scratch, "audit.mjs");
      await writeFile(
        target,
        `${source}\nexport { Compiler, Parser, Simplify, RE2Flags };\n`,
      );
      const api: CompilerApi = await import(
        /* @vite-ignore */ pathToFileURL(target).href
      );
      const iterative = api.Compiler.prototype.compile;
      const recursive = api.Compiler.prototype.compileLeaf;
      expect(typeof recursive).toBe("function");
      let expected: ReturnType<typeof records>;
      api.Compiler.prototype.compile = recursive;
      try {
        expected = records(api);
      } finally {
        api.Compiler.prototype.compile = iterative;
      }
      expect(expected.filter((item) => item.program)).toHaveLength(39);
      expect(expected.filter((item) => item.error)).toHaveLength(7);
      expect(records(api)).toEqual(expected);
      const child = spawnSync(
        process.execPath,
        ["--stack_size=256", "--input-type=module"],
        {
          input: `import * as api from ${JSON.stringify(pathToFileURL(target).href)}; const patterns = ${JSON.stringify(patterns)}; console.log(JSON.stringify(patterns.map(pattern => { try { const ast = api.Simplify.simplify(api.Parser.parse(pattern, api.RE2Flags.PERL)); const p = api.Compiler.compileRegexp(ast); return { pattern, program: { inst: p.inst, start: p.start, numCap: p.numCap } }; } catch (e) { return { pattern, error: { name:e.name, message:e.message } }; } })));`,
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 32 * 1024 * 1024,
        },
      );
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual(expected);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

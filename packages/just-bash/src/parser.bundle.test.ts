import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(__dirname, "..");
let consumer: string;

beforeAll(async () => {
  consumer = await mkdtemp(join(tmpdir(), "just-bash-parser-consumer-"));
  const tarball = join(consumer, "just-bash.tgz");
  await execFileAsync("pnpm", ["pack", "--out", tarball], {
    cwd: packageRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
  const installed = join(consumer, "node_modules/just-bash");
  await mkdir(installed, { recursive: true });
  await execFileAsync("tar", [
    "-xzf",
    tarball,
    "-C",
    installed,
    "--strip-components=1",
  ]);
}, 30_000);

afterAll(async () => {
  if (consumer) await rm(consumer, { recursive: true, force: true });
});

const exerciseParser = `
  for (const ErrorClass of [ParseException, LexerError, ArithmeticError]) {
    assert.equal(typeof ErrorClass, 'function');
  }
  const ast = parse('echo hello | cat');
  assert.equal(ast.type, 'Script');
  assert.deepEqual(
    ast.statements[0].pipelines[0].commands.map(command => command.name.parts[0].value),
    ['echo', 'cat'],
  );
  assert.throws(() => parse('if true; then'), ParseException);
  assert.throws(() => parse("echo 'unterminated"), LexerError);
  assert.throws(
    () => parse('cat <<EOF\\n1234\\nEOF', { maxHeredocSize: 3 }),
    LexerError,
  );
  assert.throws(() => parse('echo $((1.2))'), ArithmeticError);
  assert.doesNotThrow(() => parse('#' + 'é'.repeat(999_999)));
  for (const body of ['x'.repeat(1_000_000), 'é'.repeat(1_000_000), '😀'.repeat(500_000)]) {
    assert.throws(
      () => parse('#' + body),
      error => error instanceof ParseException &&
        error.message === 'Parse error at 1:1: Input too large: 1000001 UTF-16 code units exceed limit of 1000000',
    );
  }
`;

describe("published parser subpath", () => {
  it.each([
    "esm",
    "cjs",
  ])("exports matching errors from the root %s bundle", async (kind) => {
    const entry = resolve(
      packageRoot,
      kind === "esm" ? "dist/bundle/index.js" : "dist/bundle/index.cjs",
    );
    const imports =
      kind === "esm"
        ? `import assert from 'node:assert/strict';
           const { parse, ParseException, LexerError, ArithmeticError } = await import(${JSON.stringify(pathToFileURL(entry).href)});`
        : `const assert = require('node:assert/strict');
           const { parse, ParseException, LexerError, ArithmeticError } = require(${JSON.stringify(entry)});`;
    const result = await execFileAsync(process.execPath, [
      `--input-type=${kind === "esm" ? "module" : "commonjs"}`,
      "-e",
      imports + exerciseParser,
    ]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it.each([
    "module",
    "commonjs",
  ])("parses through %s resolution", async (kind) => {
    const imports =
      kind === "module"
        ? `import assert from 'node:assert/strict';
           import { parse, ParseException, LexerError, ArithmeticError } from 'just-bash/parser';`
        : `const assert = require('node:assert/strict');
           const { parse, ParseException, LexerError, ArithmeticError } = require('just-bash/parser');`;
    const result = await execFileAsync(
      process.execPath,
      [`--input-type=${kind}`, "-e", imports + exerciseParser],
      { cwd: consumer },
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("bundles and parses without Node globals or external modules", async () => {
    const result = await build({
      stdin: {
        contents: `export { parse, ParseException, LexerError, ArithmeticError } from 'just-bash/parser';`,
        resolveDir: consumer,
      },
      bundle: true,
      platform: "browser",
      format: "iife",
      globalName: "parser",
      metafile: true,
      write: false,
    });
    for (const output of Object.values(result.metafile.outputs)) {
      expect(output.imports).toEqual([]);
    }
    const commands = runInNewContext(
      `
      ${result.outputFiles[0].text}
      const cases = [
        ["echo 'unterminated", parser.LexerError],
        ['cat <<EOF\\n1234\\nEOF', parser.LexerError, { maxHeredocSize: 3 }],
        ['echo $((1.2))', parser.ArithmeticError],
        ['if true; then', parser.ParseException],
      ];
      for (const [input, ErrorClass, options] of cases) {
        let thrown;
        try { parser.parse(input, options); } catch (error) { thrown = error; }
        if (!(thrown instanceof ErrorClass)) throw new Error('Wrong parser error');
      }
      let oversized;
      try { parser.parse('#' + 'é'.repeat(1_000_000)); } catch (error) { oversized = error; }
      if (!(oversized instanceof parser.ParseException) ||
          oversized.message !== 'Parse error at 1:1: Input too large: 1000001 UTF-16 code units exceed limit of 1000000') {
        throw new Error('Missing parser input limit');
      }
      parser.parse('echo hello | cat').statements[0].pipelines[0].commands
        .map(command => command.name.parts[0].value).join(',');
    `,
      { TextDecoder, TextEncoder },
    );
    expect(commands).toBe("echo,cat");
  });

  it("does not include execution, filesystem, network or security modules", async () => {
    const result = await build({
      absWorkingDir: packageRoot,
      entryPoints: ["src/parser.ts"],
      bundle: true,
      platform: "browser",
      format: "esm",
      metafile: true,
      write: false,
    });
    const forbidden = Object.keys(result.metafile.inputs).filter((input) =>
      /(?:^|\/)(?:Bash\.ts|commands|fs|network|security|sandbox|node_modules)(?:\/|$)|\/interpreter\/(?!errors\.ts$)/.test(
        input.replaceAll("\\", "/"),
      ),
    );
    expect(forbidden).toEqual([]);
  });

  it.each([
    "mts",
    "cts",
  ])("resolves parser and AST types from .%s", async (extension) => {
    const entry = join(consumer, `consumer.${extension}`);
    await writeFile(
      entry,
      `import { parse, ParseException, LexerError, ArithmeticError, type ParseError, type LexerOptions,
        type ScriptNode, type CommandNode, type SimpleCommandNode,
        type StatementNode, type PipelineNode, type WordNode, type WordPart,
      } from 'just-bash/parser';
      const options: LexerOptions = { maxHeredocSize: 100 };
      const script: ScriptNode = parse('echo hello', options);
      const statement: StatementNode = script.statements[0];
      const pipeline: PipelineNode = statement.pipelines[0];
      const command: CommandNode = pipeline.commands[0];
      if (command.type === 'SimpleCommand') {
        const simple: SimpleCommandNode = command;
        const word: WordNode = simple.args[0];
        const part: WordPart = word.parts[0];
        void part;
      }
      const error: ParseError = new ParseException('invalid', 1, 1);
      // @ts-expect-error the AST must retain its declared type
      const invalid: number = script;
      // @ts-expect-error lexer options must retain their declared type
      parse('echo hello', { maxHeredocSize: '100' });
      const lexerError: LexerError = new LexerError('invalid', 1, 1);
      const arithmeticError: ArithmeticError = new ArithmeticError('invalid');
      void error; void invalid; void lexerError; void arithmeticError;`,
    );
    await execFileAsync(process.execPath, [
      resolve(packageRoot, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      entry,
    ]);
  });
});

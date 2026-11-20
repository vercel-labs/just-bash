// Automa modifications: N00b source regression port of jqInputMetadata.test.ts.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import fixtures from "./automa-metadata-fixtures.json";

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;
describe("jq source metadata", () => {
  for (const fixture of fixtures.cases) {
    it(fixture.id, async () => {
      const files: Record<string, string> = Object.create(null);
      for (const [key, value] of Object.entries(fixture.files)) {
        if (value !== undefined) files[`/workspace/${key}`] = value;
      }
      const shell = new Bash({ cwd: "/workspace", files });
      const result = await shell.exec(
        ["jq", ...fixture.args].map(quote).join(" "),
        { stdin: fixture.stdin },
      );
      expect(result).toMatchObject(fixture.expected);
    });
  }
  it("isolates simultaneous invocations and retains lexical metadata", async () => {
    const shell = new Bash({
      cwd: "/workspace",
      files: {
        "/workspace/甲.json": "{}\n{}\n",
        "/workspace/b.json": "\n{}\n",
      },
    });
    const results = await Promise.all([
      shell.exec(`jq -c '[input_filename,input_line_number]' ./甲.json`),
      shell.exec(`jq -c '. as $x|[input_filename,input_line_number]' b.json`),
      shell.exec(`jq -nc '[input_filename,input_line_number]'`),
    ]);
    expect(results.map((result) => result.stdout)).toEqual([
      '["./甲.json",1]\n["./甲.json",2]\n',
      '["b.json",2]\n',
      "[null,0]\n",
    ]);
    const piped = await shell.exec(
      `jq -c '[input_filename,input_line_number]' b.json | jq -c '[input_filename,input_line_number,.]'`,
    );
    expect(piped.stdout).toBe('["<stdin>",1,["b.json",2]]\n');
    const result = await new Bash({
      executionLimits: { maxQueryElements: 2 },
    }).exec(`jq -c input_filename; printf UNEXPECTED_SUCCESS`, {
      stdin: "1\n2\n3\n",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/query result element limit exceeded/);
    expect(result.stdout).not.toContain("UNEXPECTED_SUCCESS");
  });
});

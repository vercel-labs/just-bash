import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("tr delete/squeeze and binary preservation", () => {
  it.each([
    ["tr -ds a b", "aaabbb", "b"],
    ["tr -ds a b", "bababccbb", "bccb"],
    ["tr -cds b b", "babab", "b"],
    ["tr -ds a ''", "aabbb", "bbb"],
    ["tr -ds a é", "éaaéé", "é"],
  ])("deletes before squeezing in %s", async (command, stdin, stdout) => {
    const result = await new Bash().exec(command, { stdin });
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("requires SET2 when deleting and squeezing", async () => {
    const result = await new Bash().exec("tr -ds a", { stdin: "aaa" });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("tr: missing operand after SET1\n");
    expect(result.exitCode).toBe(1);
  });

  it.each([
    ["tr -d '\\000-\\037'", [255, 1, 192, 0, 128], [255, 192, 128]],
    ["tr '\\001' A", [255, 1, 128], [255, 65, 128]],
    ["tr -ds '\\001' '\\377'", [255, 1, 255], [255]],
    ["tr -s '\\001'", [255, 1, 1, 128], [255, 1, 128]],
    ["tr -cd '\\000-\\037'", [255, 1, 128], [1]],
    ["tr -d '\\001'", [195, 169, 255, 1], [195, 169, 255]],
  ])("preserves raw bytes in %s", async (command, input, expected) => {
    const env = new Bash({ files: { "/in": new Uint8Array(input) } });
    const result = await env.exec(`${command} < /in > /out`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Array.from(await env.fs.readFileBuffer("/out"))).toEqual(expected);
  });

  it.each([
    ["tr -d é", [255, 99, 97, 102, 195, 169], [255, 99, 97, 102]],
    ["tr é x", [255, 195, 169], [255, 120, 120]],
    ["tr -s é", [255, 195, 169, 169], [255, 195, 169]],
  ])("matches a literal SET character by its UTF-8 bytes in %s", async (command, input, expected) => {
    const env = new Bash({ files: { "/in": new Uint8Array(input) } });
    const result = await env.exec(`${command} < /in > /out`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Array.from(await env.fs.readFileBuffer("/out"))).toEqual(expected);
  });
});

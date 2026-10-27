import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { parse } from "../parser/parser.js";

const commandLeadingContexts = [
  {
    name: "at top level",
    script: (word: string) => `${word}; echo trailing-payload`,
    line: 1,
    column: 1,
  },
  {
    name: "after a pipe",
    script: (word: string) => `echo input | ${word}; echo trailing-payload`,
    line: 1,
    column: 14,
  },
  {
    name: "after pipeline negation",
    script: (word: string) => `! ${word}; echo trailing-payload`,
    line: 1,
    column: 3,
  },
  {
    name: "inside a group",
    script: (word: string) => `{ ${word}; echo trailing-payload; }`,
    line: 1,
    column: 3,
  },
  {
    name: "inside command substitution",
    script: (word: string) => `echo "$(${word}; echo trailing-payload)"`,
    line: 1,
    column: 1,
  },
];

describe("unsupported reserved words", () => {
  for (const word of ["select", "coproc", "in"]) {
    for (const context of commandLeadingContexts) {
      it(`rejects ${word} ${context.name} without executing trailing payloads`, async () => {
        const result = await new Bash().exec(context.script(word));

        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          `bash: line ${context.line}: syntax error near unexpected token \`${word}'\n`,
        );
        expect(result.exitCode).toBe(2);
      });
    }
  }

  it("parses a bare descriptor-variable redirection", () => {
    const command = parse("{fd}>file").statements[0].pipelines[0].commands[0];

    expect(command).toMatchObject({
      type: "SimpleCommand",
      name: null,
      redirections: [{ fdVariable: "fd", operator: ">" }],
    });
  });

  it("rejects pipeline negation after a pipe", async () => {
    const result = await new Bash().exec(
      "echo input | ! cat; echo trailing-payload",
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: line 1: syntax error near unexpected token `!'\n",
    );
    expect(result.exitCode).toBe(2);
  });

  it("keeps time as the command after leading pipeline negation", () => {
    const pipeline = parse("! time true").statements[0].pipelines[0];

    expect(pipeline.negated).toBe(true);
    expect(pipeline.timed).toBe(false);
    expect(pipeline.commands[0]).toMatchObject({
      type: "SimpleCommand",
      name: { parts: [{ type: "Literal", value: "time" }] },
      args: [{ parts: [{ type: "Literal", value: "true" }] }],
    });
  });

  it("keeps a second time as the timed command", () => {
    const pipeline = parse("time time true").statements[0].pipelines[0];

    expect(pipeline.timed).toBe(true);
    expect(pipeline.commands[0]).toMatchObject({
      type: "SimpleCommand",
      name: { parts: [{ type: "Literal", value: "time" }] },
      args: [{ parts: [{ type: "Literal", value: "true" }] }],
    });
  });

  it("keeps -- as the command after time -p", () => {
    const pipeline = parse("time -p -- true").statements[0].pipelines[0];

    expect(pipeline.timed).toBe(true);
    expect(pipeline.timePosix).toBe(true);
    expect(pipeline.commands[0]).toMatchObject({
      type: "SimpleCommand",
      name: { parts: [{ type: "Literal", value: "--" }] },
      args: [{ parts: [{ type: "Literal", value: "true" }] }],
    });
  });

  it("treats bare -- as the command after time", () => {
    const pipeline = parse("time -- select").statements[0].pipelines[0];

    expect(pipeline.timed).toBe(true);
    expect(pipeline.commands[0]).toMatchObject({
      type: "SimpleCommand",
      name: {
        parts: [{ type: "Literal", value: "--" }],
      },
      args: [
        {
          parts: [{ type: "Literal", value: "select" }],
        },
      ],
    });
  });

  it("keeps time as a command after leading negation and an inner !", () => {
    const pipeline = parse("! time ! false").statements[0].pipelines[0];

    expect(pipeline.negated).toBe(true);
    expect(pipeline.timed).toBe(false);
    expect(pipeline.commands[0]).toMatchObject({
      type: "SimpleCommand",
      name: { parts: [{ type: "Literal", value: "time" }] },
      args: [
        { parts: [{ type: "Literal", value: "!" }] },
        { parts: [{ type: "Literal", value: "false" }] },
      ],
    });
  });

  it("preserves repeated pipeline negation", () => {
    const pipeline = parse("! ! true").statements[0].pipelines[0];

    expect(pipeline.negated).toBe(false);
    expect(pipeline.timed).toBe(false);
    expect(pipeline.commands[0]).toMatchObject({
      type: "SimpleCommand",
      name: { parts: [{ type: "Literal", value: "true" }] },
    });
  });

  it("preserves reserved words in argument position", async () => {
    const result = await new Bash().exec("echo select coproc");

    expect(result.stdout).toBe("select coproc\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves quoted reserved words", async () => {
    const result = await new Bash().exec(`echo "select" 'coproc'`);

    expect(result.stdout).toBe("select coproc\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

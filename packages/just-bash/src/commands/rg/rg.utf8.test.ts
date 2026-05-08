import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

function toLatin1BinaryString(text: string): string {
  return Buffer.from(text, "utf8").toString("latin1");
}

describe("rg utf8 decoding", () => {
  it("matches Korean pattern read from latin1-encoded stdin (-f-)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/input.txt": "앞 한국 뒤\n",
      },
    });

    const result = await bash.exec("rg -f- input.txt", {
      stdin: toLatin1BinaryString("한국\n"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("앞 한국 뒤\n");
    expect(result.stderr).toBe("");
  });

  it("counts Korean matches from latin1-encoded file content", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/input.txt": toLatin1BinaryString(
          "한국\n영어\n한국\n한국어\n",
        ),
      },
    });

    const result = await bash.exec("rg -c 한국 input.txt");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("3\n");
    expect(result.stderr).toBe("");
  });

  it("reports character-aware match positions in json output", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/input.txt": toLatin1BinaryString("가나다한국라마바사\n"),
      },
    });

    const result = await bash.exec("rg --json 한국 input.txt");

    expect(result.exitCode).toBe(0);
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    const matchMessage = lines.find((line) => line.type === "match") as {
      type: "match";
      data: {
        lines: { text: string };
        absolute_offset: number;
        submatches: Array<{ start: number; end: number; match: { text: string } }>;
      };
    };

    expect(matchMessage.data.lines.text).toBe("가나다한국라마바사\n");
    expect(matchMessage.data.absolute_offset).toBe(0);
    expect(matchMessage.data.submatches[0]).toEqual({
      start: 3,
      end: 5,
      match: { text: "한국" },
    });
  });
});

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const UTF8_TEXT = "한글 café 東京 😀";

function toLatin1BinaryString(input: string): string {
  return Buffer.from(input, "utf8").toString("latin1");
}

describe("xan utf8 csv input handling", () => {
  it("preserves UTF-8 CSV cells from stdin", async () => {
    const csv = `id,message\n1,${UTF8_TEXT}\n`;
    const binaryCsv = toLatin1BinaryString(csv);

    const bash = new Bash({ files: { "/in.csv": binaryCsv } });
    const result = await bash.exec("cat /in.csv | xan select message");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(UTF8_TEXT);
  });

  it("preserves UTF-8 CSV cells from file input", async () => {
    const csv = `id,message\n1,${UTF8_TEXT}\n`;
    const binaryCsv = toLatin1BinaryString(csv);

    const bash = new Bash({ files: { "/in.csv": binaryCsv } });
    const result = await bash.exec("xan select message /in.csv");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(UTF8_TEXT);
  });

  it("preserves UTF-8 CSV cells through xan cat (file input)", async () => {
    const csv = `id,message\n1,${UTF8_TEXT}\n`;
    const binaryCsv = toLatin1BinaryString(csv);

    const bash = new Bash({ files: { "/a.csv": binaryCsv } });
    const result = await bash.exec("xan cat /a.csv");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(UTF8_TEXT);
  });
});

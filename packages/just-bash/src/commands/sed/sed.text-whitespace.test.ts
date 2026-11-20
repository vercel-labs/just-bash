import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Expected output recorded from GNU sed 4.10.
describe("sed a/i/c text whitespace", () => {
  const run = (script: string) =>
    new Bash({ files: { "/test.txt": "a\nb\n" } }).exec(
      `sed '${script}' /test.txt`,
    );

  it("keeps every blank after a\\", async () => {
    const result = await run("1a\\ \t two");
    expect(result.stdout).toBe("a\n \t two\nb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps text that is only a blank", async () => {
    const result = await run("1a\\ ");
    expect(result.stdout).toBe("a\n \nb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("skips blanks before the backslash but keeps the ones after it", async () => {
    const result = await run("1a \\  spaced");
    expect(result.stdout).toBe("a\n  spaced\nb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("strips every leading blank in the one-line form", async () => {
    const result = await run("1a\t\tplain");
    expect(result.stdout).toBe("a\nplain\nb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps the indentation of text on the line after a\\", async () => {
    const result = await run("1a\\\n  next");
    expect(result.stdout).toBe("a\n  next\nb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("skips blanks before an a\\ that ends the line", async () => {
    const result = await run("1a  \\\n  next");
    expect(result.stdout).toBe("a\n  next\nb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("turns blanks escaped with a backslash into blanks", async () => {
    const result = await run("1a\\ \\ \\\ttext");
    expect(result.stdout).toBe("a\n  \ttext\nb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("turns escaped blanks on the line after a\\ into blanks", async () => {
    const result = await run("1a\\\n\\  next");
    expect(result.stdout).toBe("a\n  next\nb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps YAML indentation when editing in place", async () => {
    const env = new Bash({ files: { "/f.yaml": "Order:\n  type: object\n" } });
    const result = await env.exec(
      "sed -i '1a\\  example: 1' /f.yaml && cat /f.yaml",
    );
    expect(result.stdout).toBe("Order:\n  example: 1\n  type: object\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

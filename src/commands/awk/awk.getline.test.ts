import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("awk getline", () => {
  it("reads next line into $0", async () => {
    const env = new Bash({
      files: {
        "/test/data.txt": `header
value1
value2
value3`,
      },
    });
    const result = await env.exec(
      "awk '/header/ { getline; print }' /test/data.txt",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("value1\n");
  });

  it("reads next line into variable", async () => {
    const env = new Bash({
      files: {
        "/test/data.txt": `name: Alice
age: 30
name: Bob
age: 25`,
      },
    });
    const result = await env.exec(
      "awk '/^name:/ { getline age_line; print $2, age_line }' /test/data.txt",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Alice age: 30\nBob age: 25\n");
  });

  it("updates NR when reading next line", async () => {
    const env = new Bash({
      files: {
        "/test/data.txt": `line1
line2
line3`,
      },
    });
    const result = await env.exec(
      "awk '{ print NR; getline; print NR }' /test/data.txt",
    );
    expect(result.exitCode).toBe(0);
    // First iteration: NR=1, after getline NR=2
    // Second iteration: NR=3, after getline would go past end
    expect(result.stdout).toBe("1\n2\n3\n3\n");
  });

  it("skips lines when used in pattern match", async () => {
    const env = new Bash({
      files: {
        "/test/data.txt": `header1
data1
header2
data2
header3
data3`,
      },
    });
    const result = await env.exec(
      "awk '/^header/ { print; getline; print \"  ->\" $0 }' /test/data.txt",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "header1\n  ->data1\nheader2\n  ->data2\nheader3\n  ->data3\n",
    );
  });

  it("handles getline at end of file gracefully", async () => {
    const env = new Bash({
      files: {
        "/test/data.txt": `only line`,
      },
    });
    const result = await env.exec(
      "awk '{ print $0; getline; print \"after: \" $0 }' /test/data.txt",
    );
    expect(result.exitCode).toBe(0);
    // getline at EOF doesn't change $0
    expect(result.stdout).toBe("only line\nafter: only line\n");
  });

  it("combines lines using getline", async () => {
    const env = new Bash({
      files: {
        "/test/data.txt": `key1
value1
key2
value2`,
      },
    });
    const result = await env.exec(
      "awk 'NR % 2 == 1 { key = $0; getline; print key \": \" $0 }' /test/data.txt",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("key1: value1\nkey2: value2\n");
  });
});

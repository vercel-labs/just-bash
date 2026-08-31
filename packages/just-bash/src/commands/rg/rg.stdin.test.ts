import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg searches stdin when no paths are given", () => {
  it("searches piped stdin instead of cwd", async () => {
    const env = new Bash({
      files: {
        // File exists but should NOT be searched — only stdin should be
        "/decoy.txt": "decoy line\n",
      },
    });
    const result = await env.exec(
      'printf "hello world\\ngoodbye\\n" | rg "hello"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello world");
    expect(result.stdout).not.toContain("decoy");
  });

  it("searches empty piped stdin instead of cwd", async () => {
    const env = new Bash({ files: { "/decoy.txt": "target line\n" } });
    const result = await env.exec('printf "" | rg "target"');

    expect(result).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
  });

  it("lets an empty input redirection override enclosing stdin", async () => {
    const env = new Bash({
      files: {
        "/empty.txt": "",
        "/outer.txt": "outer target\n",
      },
    });
    const result = await env.exec("{ rg target < /empty.txt; } < /outer.txt");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
  });

  it("treats an empty fd-0 here-doc as direct stdin", async () => {
    const env = new Bash({ files: { "/decoy.txt": "target line\n" } });
    const result = await env.exec("rg target <<EOF\nEOF");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
  });

  it("ignores an empty here-doc on a non-stdin descriptor", async () => {
    const env = new Bash({ files: { "/outer.txt": "outer target\n" } });
    const result = await env.exec(
      "{ rg target 2<<EOF\nEOF\n} < /outer.txt",
    );

    expect(result).toMatchObject({
      stdout: "1:outer target\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("ignores an empty input redirection on a non-stdin descriptor", async () => {
    const env = new Bash({
      files: {
        "/empty.txt": "",
        "/outer.txt": "outer target\n",
      },
    });
    const result = await env.exec("{ rg target 2< /empty.txt; } < /outer.txt");

    expect(result).toMatchObject({
      stdout: "1:outer target\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves inherited stdin through an fd-0 self-duplication", async () => {
    const env = new Bash({ files: { "/outer.txt": "outer target\n" } });
    const result = await env.exec("{ rg target <&0; } < /outer.txt");

    expect(result).toMatchObject({
      stdout: "1:outer target\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("still searches an explicit path when piped stdin is empty", async () => {
    const env = new Bash({ files: { "/data.txt": "target line\n" } });
    const result = await env.exec('printf "" | rg "target" /data.txt');

    expect(result).toMatchObject({
      stdout: "target line\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("does not treat wrapper-created empty stdin as direct input", async () => {
    const env = new Bash({ files: { "/decoy.txt": "target line\n" } });
    const result = await env.exec("bash -c 'rg target'");

    expect(result).toMatchObject({
      stdout: "decoy.txt:1:target line\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("returns exit code 1 when stdin has no match", async () => {
    const env = new Bash({ files: {} });
    const result = await env.exec('echo "hello" | rg "xyz"');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("supports case-insensitive search on stdin", async () => {
    const env = new Bash({ files: {} });
    const result = await env.exec('printf "Hello World\\n" | rg -i "hello"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello World");
  });

  it("supports inverted match on stdin", async () => {
    const env = new Bash({ files: {} });
    const result = await env.exec('printf "aaa\\nbbb\\nccc\\n" | rg -v "bbb"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("aaa");
    expect(result.stdout).toContain("ccc");
    expect(result.stdout).not.toContain("bbb");
  });

  it("supports count mode on stdin", async () => {
    const env = new Bash({ files: {} });
    const result = await env.exec('printf "foo\\nbar\\nfoo\\n" | rg -c "foo"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("2");
  });

  it("searches files when explicit path is given (not stdin)", async () => {
    const env = new Bash({
      files: { "/data.txt": "target line\n" },
    });
    const result = await env.exec(
      'echo "stdin content" | rg "target" /data.txt',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("target line");
  });

  it("does not double-consume stdin when -f - is used", async () => {
    const env = new Bash({
      files: { "/data.txt": "hello world\ngoodbye\n" },
    });
    // -f - reads patterns from stdin; rg should then search the explicit
    // path, not try to also search stdin as content
    const result = await env.exec('echo "hello" | rg -f - /data.txt');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello world");
  });

  it("supports multibyte UTF-8 patterns from piped stdin", async () => {
    const env = new Bash({ files: {} });
    const result = await env.exec("printf '한글 found\\nmiss\\n' | rg '한글'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("한글 found");
    expect(result.stdout).not.toContain("miss");
  });
});

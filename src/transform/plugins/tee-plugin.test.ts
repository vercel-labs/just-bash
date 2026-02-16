import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { TeePlugin, type TeePluginMetadata } from "./tee-plugin.js";

const FIXED_DATE = new Date("2024-01-15T10:30:45.123Z");

describe("TeePlugin exec", () => {
  it("captures stdout to file for single command", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("echo hello");
    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(1);
    expect(meta.teeFiles[0].commandName).toBe("echo");
    expect(meta.teeFiles[0].command).toBe("echo hello");

    const stdoutContent = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(stdoutContent).toBe("hello\n");

    const stderrContent = await bash.readFile(meta.teeFiles[0].stderrFile);
    expect(stderrContent).toBe("");
  });

  it("captures stdout for each command in pipeline", async () => {
    const bash = new Bash({
      files: { "/data/input.txt": "hello\nworld\nhello world\n" },
    });
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("cat /data/input.txt | grep hello");
    expect(result.stdout).toBe("hello\nhello world\n");
    expect(result.exitCode).toBe(0);

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(2);
    expect(meta.teeFiles[0].commandName).toBe("cat");
    expect(meta.teeFiles[0].command).toBe("cat /data/input.txt");
    expect(meta.teeFiles[1].commandName).toBe("grep");
    expect(meta.teeFiles[1].command).toBe("grep hello");

    const catStdout = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(catStdout).toBe("hello\nworld\nhello world\n");

    const grepStdout = await bash.readFile(meta.teeFiles[1].stdoutFile);
    expect(grepStdout).toBe("hello\nhello world\n");
  });

  it("captures stderr to separate file", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    // ls on a nonexistent path writes to stderr
    const result = await bash.exec("ls /nonexistent_path_xyz");

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(1);
    expect(meta.teeFiles[0].commandName).toBe("ls");
    expect(meta.teeFiles[0].command).toBe("ls /nonexistent_path_xyz");

    const stderrContent = await bash.readFile(meta.teeFiles[0].stderrFile);
    expect(stderrContent).toContain("No such file");
  });

  it("only captures targeted commands", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({
        outputDir: "/tmp/logs",
        timestamp: FIXED_DATE,
        targetCommandPattern: /^echo$/,
      }),
    );
    const result = await bash.exec("echo hello | cat");
    expect(result.stdout).toBe("hello\n");

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(1);
    expect(meta.teeFiles[0].commandName).toBe("echo");
    expect(meta.teeFiles[0].command).toBe("echo hello");

    const stdoutContent = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(stdoutContent).toBe("hello\n");
  });

  it("captures multi-statement output to separate files", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec('echo "line1"; echo "line2"; echo "line3"');
    expect(result.stdout).toBe("line1\nline2\nline3\n");

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(3);
    expect(meta.teeFiles[0].commandName).toBe("echo");
    expect(meta.teeFiles[0].command).toBe('echo "line1"');
    expect(meta.teeFiles[1].commandName).toBe("echo");
    expect(meta.teeFiles[1].command).toBe('echo "line2"');
    expect(meta.teeFiles[2].commandName).toBe("echo");
    expect(meta.teeFiles[2].command).toBe('echo "line3"');

    expect(await bash.readFile(meta.teeFiles[0].stdoutFile)).toBe("line1\n");
    expect(await bash.readFile(meta.teeFiles[1].stdoutFile)).toBe("line2\n");
    expect(await bash.readFile(meta.teeFiles[2].stdoutFile)).toBe("line3\n");
  });

  it("metadata contains correct command and arguments", async () => {
    const bash = new Bash({
      files: { "/data/file.txt": "content\n" },
    });
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("grep -i content /data/file.txt");
    expect(result.exitCode).toBe(0);

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles[0].commandName).toBe("grep");
    expect(meta.teeFiles[0].command).toBe("grep -i content /data/file.txt");
  });

  it("writes to nested output directory", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs/deep/dir", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("echo test");
    expect(result.exitCode).toBe(0);

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles[0].commandName).toBe("echo");
    expect(meta.teeFiles[0].command).toBe("echo test");
    const content = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(content).toBe("test\n");
  });

  it("preserves original stdout passthrough", async () => {
    const bash = new Bash();
    const bashWithTee = new Bash();
    bashWithTee.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );

    const script = 'echo "hello world"';
    const plain = await bash.exec(script);
    const withTee = await bashWithTee.exec(script);

    // tee passes stdout through, so output should be identical
    expect(withTee.stdout).toBe(plain.stdout);

    const meta = withTee.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles[0].commandName).toBe("echo");
    expect(meta.teeFiles[0].command).toBe('echo "hello world"');
  });

  it("captures output from pipeline with multiple stages", async () => {
    const bash = new Bash({
      files: {
        "/data/words.txt": "banana\napple\ncherry\napricot\navocado\n",
      },
    });
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("cat /data/words.txt | grep ^a | sort");
    expect(result.stdout).toBe("apple\napricot\navocado\n");

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(3);
    expect(meta.teeFiles[0].commandName).toBe("cat");
    expect(meta.teeFiles[0].command).toBe("cat /data/words.txt");
    expect(meta.teeFiles[1].commandName).toBe("grep");
    expect(meta.teeFiles[1].command).toBe("grep ^a");
    expect(meta.teeFiles[2].commandName).toBe("sort");
    expect(meta.teeFiles[2].command).toBe("sort");

    // cat sees the full file
    const catOut = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(catOut).toBe("banana\napple\ncherry\napricot\navocado\n");

    // grep filters to a-words
    const grepOut = await bash.readFile(meta.teeFiles[1].stdoutFile);
    expect(grepOut).toBe("apple\napricot\navocado\n");

    // sort produces final sorted output
    const sortOut = await bash.readFile(meta.teeFiles[2].stdoutFile);
    expect(sortOut).toBe("apple\napricot\navocado\n");
  });
});

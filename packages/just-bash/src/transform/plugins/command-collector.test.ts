import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { CommandCollectorPlugin } from "./command-collector.js";

describe("CommandCollectorPlugin exec", () => {
  it("collects commands from pipeline", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(new CommandCollectorPlugin());
    const result = await bash.exec("echo hello | cat | wc -l");
    expect(result.stdout).toBe("1\n");
    expect(result.metadata).toEqual({ commands: ["cat", "echo", "wc"] });
  });

  it("collects commands from if/else", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(new CommandCollectorPlugin());
    const result = await bash.exec(
      'if true; then echo "yes"; else echo "no"; fi',
    );
    expect(result.stdout).toBe("yes\n");
    expect(result.metadata).toEqual({ commands: ["echo", "true"] });
  });

  it("collects commands from for loop", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(new CommandCollectorPlugin());
    const result = await bash.exec("for i in a b c; do echo $i; done");
    expect(result.stdout).toBe("a\nb\nc\n");
    expect(result.metadata).toEqual({ commands: ["echo"] });
  });

  it("collects commands from command substitution", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(new CommandCollectorPlugin());
    const result = await bash.exec("echo $(echo inner)");
    expect(result.stdout).toBe("inner\n");
    expect(result.metadata).toEqual({ commands: ["echo"] });
  });

  it("collects commands from case statement", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(new CommandCollectorPlugin());
    const result = await bash.exec(
      "x=a; case $x in a) echo matched;; b) printf nope;; esac",
    );
    expect(result.stdout).toBe("matched\n");
    expect(result.metadata).toEqual({ commands: ["echo", "printf"] });
  });

  it("does not affect script output", async () => {
    const bash = new Bash();
    const bashWithPlugin = new Bash();
    bashWithPlugin.registerTransformPlugin(new CommandCollectorPlugin());

    const script = 'x=5; echo $((x * 2)); echo "done"';
    const plain = await bash.exec(script);
    const withPlugin = await bashWithPlugin.exec(script);

    expect(withPlugin.stdout).toBe(plain.stdout);
    expect(withPlugin.stderr).toBe(plain.stderr);
    expect(withPlugin.exitCode).toBe(plain.exitCode);
  });

  it("returns sorted unique command names", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(new CommandCollectorPlugin());
    const result = await bash.exec("echo a; echo b; cat /dev/null; echo c");
    expect(result.metadata).toEqual({ commands: ["cat", "echo"] });
  });

  it("collects commands from while loop", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(new CommandCollectorPlugin());
    const result = await bash.exec(
      'echo "a b c" | while read x y z; do echo "$x"; done',
    );
    expect(result.stdout).toBe("a\n");
    expect(result.metadata).toEqual({ commands: ["echo", "read"] });
  });
});

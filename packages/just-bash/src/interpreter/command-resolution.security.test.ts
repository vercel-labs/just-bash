import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("command resolution identity", () => {
  it("does not dispatch a registered command through an untrusted explicit path", async () => {
    const bash = new Bash();
    await bash.fs.writeFile("/tmp/echo", "printf 'user-script:%s\\n' \"$*\"");

    const denied = await bash.exec("/tmp/echo payload");
    expect(denied.stdout).toBe("");
    expect(denied.stderr).toBe("bash: /tmp/echo: Permission denied\n");
    expect(denied.exitCode).toBe(126);

    await bash.fs.chmod("/tmp/echo", 0o755);
    const executed = await bash.exec("/tmp/echo payload");
    expect(executed.stdout).toBe("user-script:payload\n");
    expect(executed.stderr).toBe("");
    expect(executed.exitCode).toBe(0);
  });

  it("evicts invalid hash aliases instead of dispatching by basename", async () => {
    const bash = new Bash();
    await bash.fs.writeFile("/tmp/not-echo", "untrusted");

    const result = await bash.exec("hash -p /tmp/not-echo echo; echo trusted");
    expect(result.stdout).toBe("trusted\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not report non-executable PATH entries through type variants", async () => {
    const bash = new Bash();
    await bash.fs.writeFile("/tmp/tool", "echo no");

    const result = await bash.exec(
      "PATH=/tmp; type -P tool; type -aP tool; command -v tool",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("continues to dispatch verified trusted system stubs", async () => {
    const bash = new Bash();
    const result = await bash.exec("/bin/echo trusted");
    expect(result.stdout).toBe("trusted\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";

class FailingWritesFs extends InMemoryFs {
  errorCode: string | undefined = "EROFS";
  override async writeFile(
    ...args: Parameters<InMemoryFs["writeFile"]>
  ): Promise<void> {
    if (args[0] === "/ok") return super.writeFile(...args);
    const error = new Error("host path must not be printed");
    if (this.errorCode) Object.assign(error, { code: this.errorCode });
    throw error;
  }
}

describe("file error messages", () => {
  it("preserves nl's virtual operand in missing-file errors", async () => {
    const result = await new Bash().exec("nl /tmp/t/missing.txt");
    expect(result).toMatchObject({
      stdout: "",
      stderr: "nl: /tmp/t/missing.txt: No such file or directory\n",
      exitCode: 1,
    });
  });

  it.each([
    ["tee /ro/f.txt /ok <<< hi", "tee", "hi\n"],
    ["sed -i 's/x/y/' /ro/f.txt", "sed", ""],
  ])("reports write refusal for %s", async (script, command, stdout) => {
    for (const [code, reason] of [
      ["EROFS", "Read-only file system"],
      ["EFBIG", "File too large"],
      ["EDQUOT", "Disk quota exceeded"],
      [undefined, "Input/output error"],
    ]) {
      const fs = new FailingWritesFs({ "/ro/f.txt": "x\n" });
      fs.errorCode = code;
      const result = await new Bash({ fs }).exec(script);
      expect(result).toMatchObject({
        stdout,
        stderr: `${command}: /ro/f.txt: ${reason}\n`,
        exitCode: 1,
      });
      expect(await fs.readFile("/ro/f.txt")).toBe("x\n");
      if (command === "tee") expect(await fs.readFile("/ok")).toBe("hi\n");
    }
  });
});

import { describe, it, expect } from "vitest";
import { Bash } from "./Bash.js";
import { InMemoryFs } from "./fs/in-memory-fs/in-memory-fs.js";
import { defineCommand } from "./custom-commands.js";

describe("UTF-8 encoding bug: Latin-1 range chars (128-255) corrupted on file write+read", () => {
  it("should preserve German umlauts through heredoc write + cat read", async () => {
    const fs = new InMemoryFs();
    const bash = new Bash({ fs, cwd: "/workspace" });

    await bash.exec(`cat > /workspace/test.txt << 'EOF'
Ü Ö Ä ü ö ä ß Grüße
EOF`);

    const result = await bash.exec("cat /workspace/test.txt");
    expect(result.stdout).toBe("Ü Ö Ä ü ö ä ß Grüße\n");
  });

  it("should preserve umlauts through echo redirect + cat read", async () => {
    const fs = new InMemoryFs();
    const bash = new Bash({ fs, cwd: "/workspace" });

    await bash.exec('echo "Ü Ö Ä ü ö ä ß Grüße" > /workspace/test.txt');
    const result = await bash.exec("cat /workspace/test.txt");
    expect(result.stdout).toBe("Ü Ö Ä ü ö ä ß Grüße\n");
  });

  it("should preserve French accented chars through echo redirect", async () => {
    const fs = new InMemoryFs();
    const bash = new Bash({ fs, cwd: "/workspace" });

    await bash.exec('echo "café résumé naïve" > /workspace/test.txt');
    const result = await bash.exec("cat /workspace/test.txt");
    expect(result.stdout).toBe("café résumé naïve\n");
  });

  it("custom command readFile should return correct UTF-8 after echo redirect", async () => {
    const readBack = defineCommand("readback", async (args, ctx) => {
      const content = await ctx.fs.readFile(args[0]);
      const encoder = new TextEncoder();
      const bytes = encoder.encode(content);
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
      return { stdout: `content:${content}hex:${hex}\n`, stderr: "", exitCode: 0 };
    });

    const fs = new InMemoryFs();
    const bash = new Bash({ fs, cwd: "/workspace", customCommands: [readBack] });

    await bash.exec('echo "Ü Ö Ä" > /workspace/test.txt');
    const result = await bash.exec("readback /workspace/test.txt");

    console.log("readback stdout:", JSON.stringify(result.stdout));

    // Ü should be c3 9c in UTF-8, not ef bf bd (replacement char)
    expect(result.stdout).toContain("content:Ü Ö Ä");
    expect(result.stdout).not.toContain("ef bf bd");
  });

  it("readFileBuffer should have correct UTF-8 bytes after echo redirect", async () => {
    const readBuf = defineCommand("readbuf", async (args, ctx) => {
      const buffer = await ctx.fs.readFileBuffer(args[0]);
      const hex = Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const decoded = new TextDecoder().decode(buffer);
      return { stdout: `hex:${hex}\ndecoded:${decoded}\n`, stderr: "", exitCode: 0 };
    });

    const fs = new InMemoryFs();
    const bash = new Bash({ fs, cwd: "/workspace", customCommands: [readBuf] });

    await bash.exec('echo "Ü Ö Ä" > /workspace/test.txt');
    const result = await bash.exec("readbuf /workspace/test.txt");

    console.log("readbuf stdout:", JSON.stringify(result.stdout));

    // Correct UTF-8: Ü=c3 9c, space=20, Ö=c3 96, space=20, Ä=c3 84
    // Corrupted binary: dc 20 d6 20 c4
    expect(result.stdout).toContain("decoded:Ü Ö Ä");
  });
});

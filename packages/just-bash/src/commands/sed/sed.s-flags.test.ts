import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Expected output recorded from GNU sed 4.9, except for the w, e, m and M
// cases, which GNU sed implements. GNU sed prefixes errors with
// "-e expression #1, char N:" where just-bash prints "invalid command:".
describe("sed s command flags", () => {
  const run = (script: string, options = "", input = "a\nb\n") =>
    new Bash({ files: { "/test.txt": input } }).exec(
      `sed ${options} '${script}' /test.txt`,
    );

  const error = (message: string) => `sed: invalid command: ${message}\n`;
  const unknownOption = error("unknown option to `s'");

  describe("text after the flags", () => {
    it("rejects a replacement that ends early instead of deleting the file", async () => {
      const env = new Bash({ files: { "/f": "a\nb\n" } });
      const result = await env.exec("sed -i '1s#a#x\\n# default#' /f");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(unknownOption);
      expect(result.exitCode).toBe(1);
      expect(await env.readFile("/f")).toBe("a\nb\n");
    });

    it("does not run a c command after the flags", async () => {
      const result = await run("1s#a#x\\n# c new#");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(unknownOption);
      expect(result.exitCode).toBe(1);
    });

    for (const script of [
      "s/a/b/x",
      "s/a/b/gx",
      "s/a/b/d",
      "s/a/b/ d",
      "s/a/b/\rp",
      "s/a/b/\r",
    ]) {
      it(`rejects ${JSON.stringify(script)}`, async () => {
        const result = await run(script);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(unknownOption);
        expect(result.exitCode).toBe(1);
      });
    }
  });

  describe("flags that just-bash does not implement", () => {
    for (const script of ["s/a/b/w out.txt", "s/a/b/e", "s/a/b/m", "s/a/b/M"]) {
      it(`rejects ${JSON.stringify(script)}`, async () => {
        const result = await run(script);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(unknownOption);
        expect(result.exitCode).toBe(1);
      });
    }
  });

  describe("closing delimiter", () => {
    for (const script of ["s/a/b", "s/a/b\nd"]) {
      it(`rejects ${JSON.stringify(script)}`, async () => {
        const result = await run(script);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(error("unterminated `s' command"));
        expect(result.exitCode).toBe(1);
      });
    }
  });

  describe("repeated and zero flags", () => {
    for (const [script, message] of [
      ["s/a/b/gg", "multiple `g' options to `s' command"],
      ["s/a/b/g g", "multiple `g' options to `s' command"],
      ["s/a/b/pp", "multiple `p' options to `s' command"],
      ["s/a/b/1g2", "multiple number options to `s' command"],
      ["s/a/b/2 3", "multiple number options to `s' command"],
      ["s/a/b/0", "number option to `s' command may not be zero"],
      ["s/a/b/00", "number option to `s' command may not be zero"],
      ["s/a/b/p0", "number option to `s' command may not be zero"],
    ]) {
      it(`rejects ${JSON.stringify(script)}`, async () => {
        const result = await run(script);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(error(message));
        expect(result.exitCode).toBe(1);
      });
    }

    it("accepts i and I together", async () => {
      const result = await run("s/A/x/iI");
      expect(result.stdout).toBe("x\nb\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("accepts a number with a leading zero", async () => {
      const result = await run("s/a/b/01", "", "aaa\nb\n");
      expect(result.stdout).toBe("baa\nb\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("blanks between flags", () => {
    it("reads g after a blank as a flag", async () => {
      const result = await run("s/a/b/ g", "", "aa\nb\n");
      expect(result.stdout).toBe("bb\nb\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("reads p after a blank as a flag", async () => {
      const result = await run("s/a/b/g p", "-n", "aa\nb\n");
      expect(result.stdout).toBe("bb\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("reads p after a tab as a flag", async () => {
      const result = await run("s/a/b/g\tp", "-n", "aa\nb\n");
      expect(result.stdout).toBe("bb\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("reads a number after a blank as a flag", async () => {
      const result = await run("s/a/b/ 2", "", "aaa\nb\n");
      expect(result.stdout).toBe("aba\nb\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("accepts blanks after the last flag", async () => {
      const result = await run("s/a/b/g \t");
      expect(result.stdout).toBe("b\nb\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("end of the s command", () => {
    for (const [script, stdout] of [
      ["s/a/b/g ; p", "b\nb\nb\nb\n"],
      ["s/a/b/ \np", "b\nb\nb\nb\n"],
      ["s/a/b/g\r\np", "b\nb\nb\nb\n"],
      ["s/a/b/ # comment", "b\nb\n"],
      ["s/a/b/g#comment", "b\nb\n"],
      ["/a/{s/a/x/ }", "x\nb\n"],
      ["/a/{s/a/x/g}", "x\nb\n"],
    ]) {
      it(`accepts ${JSON.stringify(script)}`, async () => {
        const result = await run(script);
        expect(result.stdout).toBe(stdout);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
      });
    }
  });

  // A script file line keeps its trailing blanks, as an -e script does.
  describe("script files", () => {
    const runFile = (script: string) =>
      new Bash({
        files: { "/test.txt": "a\nb\n", "/script.sed": script },
      }).exec("sed -f /script.sed /test.txt");

    for (const script of ["s a b \n", "s\ta\tb\t\n", "s a b \r\n"]) {
      it(`accepts a blank delimiter at the end of ${JSON.stringify(script)}`, async () => {
        const result = await runFile(script);
        expect(result.stdout).toBe("b\nb\n");
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
      });
    }

    it("accepts a blank delimiter at the end of a y command", async () => {
      const result = await runFile("y a b \n");
      expect(result.stdout).toBe("b\nb\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("keeps trailing blanks in a, i and c text", async () => {
      const result = await runFile("1i one \n1a two  \n2c three \n");
      expect(result.stdout).toBe("one \na\ntwo  \nthree \n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});

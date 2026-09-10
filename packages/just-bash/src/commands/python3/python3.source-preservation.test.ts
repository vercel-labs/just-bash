import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const cases = [
  {
    name: "multiline string contents",
    source: 'text = """alpha\nbeta\n"""\nprint(repr(text))',
    stdout: "'alpha\\nbeta\\n'\n",
  },
  {
    name: "Python source generated inside a multiline string",
    source:
      'source = """def answer():\n    return 42\nprint(answer())\n"""\nexec(source)',
    stdout: "42\n",
  },
  {
    name: "escaped physical newlines in strings",
    source: 'text = "first\\\nsecond"\nprint(repr(text))',
    stdout: "'firstsecond'\n",
  },
  {
    name: "tabs and intentional spaces inside a string",
    source: 'text = """first\n\tsecond\n  third"""\nprint(repr(text))',
    stdout: "'first\\n\\tsecond\\n  third'\n",
  },
  {
    name: "future imports at the beginning of the user module",
    source:
      'from __future__ import annotations\ndef identity(value: MissingType):\n    return value\nprint(identity.__annotations__["value"])',
    stdout: "MissingType\n",
  },
  {
    name: "module globals shared with functions",
    source:
      "value = 42\ndef answer():\n    return value\nprint(__name__, answer())",
    stdout: "__main__ 42\n",
  },
  {
    name: "SystemExit status",
    source: 'import sys\nprint("before exit")\nsys.exit(7)',
    stdout: "before exit\n",
    exitCode: 7,
  },
];

for (const mode of ["stdin", "-c", "file"] as const) {
  const filename =
    mode === "file" ? "/tmp/source.py" : mode === "-c" ? "<string>" : "<stdin>";

  async function execute(source: string) {
    const bash = new Bash({
      python: true,
      files: { "/tmp/source.py": source },
    });
    const command =
      mode === "stdin"
        ? `python3 - <<'PY'\n${source}\nPY`
        : mode === "-c"
          ? `python3 -c '${source.replace(/'/g, "'\\''")}'`
          : "python3 /tmp/source.py";
    return bash.exec(command);
  }

  describe(`python3 source preservation (${mode})`, () => {
    it.each(cases)("preserves $name", async ({ source, stdout, exitCode }) => {
      expect(await execute(source)).toMatchObject({
        stdout,
        stderr: "",
        exitCode: exitCode ?? 0,
      });
    });

    it("keeps user filenames, line numbers, and source text in tracebacks", async () => {
      const result = await execute(
        [
          "import linecache",
          "def fail():",
          "    return 1 / 0",
          "try:",
          "    fail()",
          "except ZeroDivisionError as error:",
          "    frame = error.__traceback__.tb_next",
          "    filename = frame.tb_frame.f_code.co_filename",
          "    print(filename, frame.tb_lineno)",
          "    print(repr(linecache.getline(filename, frame.tb_lineno)))",
        ].join("\n"),
      );
      expect(result).toMatchObject({
        stdout: `${filename} 3\n'    return 1 / 0\\n'\n`,
        stderr: "",
        exitCode: 0,
      });
    });

    it("reports an actual indentation error at the original user line", async () => {
      const result = await execute('print("before")\n  print("invalid")');
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(1);
      // The wrapper has its own traceback frame; check the complete user diagnostic.
      const stderr = stripVTControlCharacters(result.stderr);
      expect(stderr.slice(stderr.lastIndexOf("  File "))).toBe(
        `  File "${filename}", line 2\n    print("invalid")\nIndentationError: unexpected indent\n`,
      );
    });
  });
}

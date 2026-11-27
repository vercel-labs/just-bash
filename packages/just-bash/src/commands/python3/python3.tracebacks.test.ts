import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Note: These tests use CPython Emscripten which loads ~9MB WASM on first run.
// The first test will be slow, subsequent tests reuse the worker.

describe("python3 tracebacks and the program's namespace", () => {
  it(
    "names <string> and the program's own line for -c code",
    { timeout: 60000 },
    async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(`python3 -c "import json
x = 1
raise KeyError(2)"`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        'Traceback (most recent call last):\n  File "<string>", line 3, in <module>\nKeyError: 2\n',
      );
      expect(result.exitCode).toBe(1);
    },
  );

  it("names a script file by its absolute path and its own lines", async () => {
    const env = new Bash({ python: true });
    await env.exec(`cat > /tmp/report.py << 'EOF'
def fail():
    raise ValueError("boom")

fail()
EOF`);
    const result = await env.exec("cd /tmp && python3 report.py");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      [
        "Traceback (most recent call last):",
        '  File "/tmp/report.py", line 4, in <module>',
        "    fail()",
        "    ~~~~^^",
        '  File "/tmp/report.py", line 2, in fail',
        '    raise ValueError("boom")',
        "ValueError: boom",
        "",
      ].join("\n"),
    );
    expect(result.exitCode).toBe(1);
  });

  it("sets __file__ and puts the script's directory on sys.path", async () => {
    const env = new Bash({ python: true });
    await env.exec(
      "mkdir -p /tmp/app && echo 'ANSWER = 42' > /tmp/app/helper.py",
    );
    await env.exec(`cat > /tmp/app/main.py << 'EOF'
import helper
print(__file__, __name__, helper.ANSWER)
EOF`);
    const result = await env.exec("python3 /tmp/app/main.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("/tmp/app/main.py __main__ 42\n");
    expect(result.exitCode).toBe(0);
  });

  it("finds a relative script's source after the program changes directory", async () => {
    const env = new Bash({ python: true });
    await env.exec(`cat > /tmp/moves.py << 'EOF'
import os
os.chdir('/')
raise ValueError("moved")
EOF`);
    const result = await env.exec("cd /tmp && python3 moves.py");
    expect(result.stderr).toBe(
      [
        "Traceback (most recent call last):",
        '  File "/tmp/moves.py", line 3, in <module>',
        '    raise ValueError("moved")',
        "ValueError: moved",
        "",
      ].join("\n"),
    );
    expect(result.exitCode).toBe(1);
  });

  it("makes a script's path absolute when the shell is at the root", async () => {
    const env = new Bash({ python: true });
    await env.exec(
      "echo 'import sys; print(__file__, sys.path[0])' > /rooted.py",
    );
    const result = await env.exec("cd / && python3 rooted.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("/rooted.py /\n");
    expect(result.exitCode).toBe(0);
  });

  it("sets __file__ to <stdin> for a program read from stdin", async () => {
    const env = new Bash({ python: true });
    const dash = await env.exec(`python3 - << 'EOF'
print(__file__)
EOF`);
    expect(dash.stderr).toBe("");
    expect(dash.stdout).toBe("<stdin>\n");
    const piped = await env.exec(`echo 'print(__file__)' | python3`);
    expect(piped.stderr).toBe("");
    expect(piped.stdout).toBe("<stdin>\n");
  });

  it("names modules imported beside the program by their own paths", async () => {
    const env = new Bash({ python: true });
    await env.exec(
      "mkdir -p /tmp/lib/pkg && touch /tmp/lib/pkg/__init__.py && echo 'X = 1' > /tmp/lib/pkg/mod.py",
    );
    await env.exec(`cat > /tmp/lib/helper.py << 'EOF'
def fail():
    raise ValueError("boom")
EOF`);
    await env.exec(`cat > /tmp/lib/main.py << 'EOF'
import helper, pkg.mod
print(helper.__file__, pkg.mod.__file__, list(pkg.__path__))
helper.fail()
EOF`);
    const script = await env.exec("python3 /tmp/lib/main.py");
    expect(script.stdout).toBe(
      "/tmp/lib/helper.py /tmp/lib/pkg/mod.py ['/tmp/lib/pkg']\n",
    );
    expect(script.stderr).toContain(
      'File "/tmp/lib/helper.py", line 2, in fail',
    );
    expect(script.stderr).not.toContain("/host");
    const inline = await env.exec(
      `cd /tmp/lib && python3 -c "import helper; print(helper.__file__)"`,
    );
    expect(inline.stderr).toBe("");
    expect(inline.stdout).toBe("/tmp/lib/helper.py\n");
  });

  it("formats an exception with the standard traceback module, not one beside the program", async () => {
    const env = new Bash({ python: true });
    await env.exec(`mkdir -p /tmp/shadow && cat > /tmp/shadow/traceback.py << 'EOF'
print("hijacked")
def print_exception(*args, **kwargs):
    pass
EOF`);
    await env.exec("echo '1/0' > /tmp/shadow/main.py");
    for (const command of [
      `cd /tmp/shadow && python3 -c "1/0"`,
      "python3 /tmp/shadow/main.py",
    ]) {
      const result = await env.exec(command);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("ZeroDivisionError: division by zero");
      expect(result.exitCode).toBe(1);
    }
  });

  it("gives the program its own traceback.py when it imports one", async () => {
    const env = new Bash({ python: true });
    await env.exec(
      "mkdir -p /tmp/own && echo 'MINE = 1' > /tmp/own/traceback.py && echo 'import traceback; print(traceback.MINE)' > /tmp/own/main.py",
    );
    const result = await env.exec("python3 /tmp/own/main.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("1\n");
    const loaded = await env.exec(
      `python3 -c "import sys; print('traceback' in sys.modules)"`,
    );
    expect(loaded.stdout).toBe("False\n");
  });

  it("formats with the standard library when the program writes modules into /tmp", async () => {
    const env = new Bash({ python: true });
    await env.exec(
      "mkdir -p /tmp/plant && for m in tokenize linecache textwrap _colorize ast; do echo 'print(\"planted\")' > /tmp/$m.py; done",
    );
    await env.exec(`cat > /tmp/plant/main.py << 'EOF'
def fail():
    raise ValueError("boom")

fail()
EOF`);
    const result = await env.exec("python3 /tmp/plant/main.py");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      [
        "Traceback (most recent call last):",
        '  File "/tmp/plant/main.py", line 4, in <module>',
        "    fail()",
        "    ~~~~^^",
        '  File "/tmp/plant/main.py", line 2, in fail',
        '    raise ValueError("boom")',
        "ValueError: boom",
        "",
      ].join("\n"),
    );
    expect(result.exitCode).toBe(1);
  });

  it("puts the absolute launch directory on sys.path for -m", async () => {
    const env = new Bash({ python: true });
    await env.exec(
      "mkdir -p /tmp/mod/sub && echo 'V = 1' > /tmp/mod/helper.py",
    );
    await env.exec(`cat > /tmp/mod/app.py << 'EOF'
import os, sys
print(sys.path[0])
os.chdir("sub")
import helper
print(helper.V)
EOF`);
    const result = await env.exec("cd /tmp/mod && python3 -m app");
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("/tmp/mod\n1\n");
  });

  it("prints a syntax error the way CPython does, naming no wrapper", async () => {
    const env = new Bash({ python: true });
    const result = await env.exec(`python3 -c "x = = 1"`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      '  File "<string>", line 1\n    x = = 1\n        ^\nSyntaxError: invalid syntax\n',
    );
    expect(result.exitCode).toBe(1);
  });

  it("is the __main__ module, so a class it defines pickles", async () => {
    const env = new Bash({ python: true });
    const result = await env.exec(`python3 -c "
import pickle, sys, __main__
class Point:
    def __init__(self, x):
        self.x = x
print(__main__ is sys.modules['__main__'], hasattr(__main__, 'Point'))
print(pickle.loads(pickle.dumps(Point(7))).x)
"`);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("True True\n7\n");
    expect(result.exitCode).toBe(0);
  });

  it("accepts a coding cookie on the first line", async () => {
    // The source is compiled as a str the filesystem already decoded, and
    // CPython accepts a cookie in a str; a latin-1 cookie on UTF-8 text
    // would re-decode the literals if the source were compiled as bytes.
    const env = new Bash({ python: true });
    await env.exec(`cat > /tmp/cookie.py << 'EOF'
# -*- coding: latin-1 -*-
print("caf\u00e9")
EOF`);
    const result = await env.exec("python3 /tmp/cookie.py");
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("caf\u00e9\n");
    expect(result.exitCode).toBe(0);
  });

  it("keeps the wrapper's own imports out of the program's globals", async () => {
    const env = new Bash({ python: true });
    const result = await env.exec(
      `python3 -c "print(sorted(k for k in globals() if not k.startswith('__')))"`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("[]\n");
    expect(result.exitCode).toBe(0);
  });

  describe("the program's source reaches the compiler as written", () => {
    // The wrapper indents the program into its own try block, so any line
    // inside a multi-line string literal gained four spaces of content.
    // Compiling the program from a string literal of its own keeps the
    // wrapper's indentation out of it.
    it("keeps a triple-quoted string's lines unindented from a script", async () => {
      const env = new Bash({ python: true });
      await env.exec(`cat > /tmp/text.py << 'EOF'
text = """alpha
beta
"""
print(repr(text))
EOF`);
      const result = await env.exec("python3 /tmp/text.py");
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("'alpha\\nbeta\\n'\n");
      expect(result.exitCode).toBe(0);
    });

    it("keeps a triple-quoted string's lines unindented from stdin", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(`python3 - << 'EOF'
text = """alpha
beta
"""
print(repr(text))
EOF`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("'alpha\\nbeta\\n'\n");
      expect(result.exitCode).toBe(0);
    });

    it("keeps a triple-quoted string's lines unindented from -c", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(`python3 -c 'text = """alpha
beta
"""
print(repr(text))'`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("'alpha\\nbeta\\n'\n");
      expect(result.exitCode).toBe(0);
    });

    it("runs code the program builds in a string, which the indentation broke", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(`python3 - << 'EOF'
source = """def answer():
    return 42
print(answer())
"""
exec(source)
EOF`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });

    it("honors a module-level __future__ import", async () => {
      const env = new Bash({ python: true });
      const result = await env.exec(`python3 - << 'EOF'
from __future__ import annotations
def f(x: undefined_name) -> None:
    pass
print(f.__annotations__["x"])
EOF`);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("undefined_name\n");
      expect(result.exitCode).toBe(0);
    });
  });
});

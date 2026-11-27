import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * An `if`, `for`, C-style `for` or `case` compound that is a pipeline stage
 * (or a function body) reads the stdin it was handed, the way a `while`
 * loop, a group or a subshell already does. Regression tests for
 * https://github.com/vercel-labs/just-bash/issues/499.
 *
 * Every expectation below was checked against GNU bash 5.2.
 */

const FIVE_LINES = "L1\nL2\nL3\nL4\nL5\n";

function makeBash(): Bash {
  return new Bash({
    files: {
      "/loop.txt": FIVE_LINES,
      "/file.txt": "F1\nF2\n",
      "/empty.txt": "",
    },
    cwd: "/",
  });
}

async function run(script: string): Promise<string> {
  const result = await makeBash().exec(script);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

describe("compound pipeline stages read the pipe", () => {
  const stages: Array<[label: string, script: string, stdout: string]> = [
    ["if", "echo hi | if :; then cat; fi", "hi\n"],
    ["case", "echo hi | case x in x) cat;; esac", "hi\n"],
    [
      "for",
      `printf 'a\\nb\\n' | for i in 1 2; do read x; echo "$i$x"; done`,
      "1a\n2b\n",
    ],
    [
      "C-style for",
      `printf 'a\\nb\\n' | for ((i=0; i<2; i++)); do read x; echo "$i$x"; done`,
      "0a\n1b\n",
    ],
    [
      "else branch",
      `printf 'a\\n' | if false; then :; elif false; then :; else read z; echo "z=$z"; fi`,
      "z=a\n",
    ],
    [
      "case fall-through",
      `printf 'a\\nb\\n' | case x in x) read p;& y) read q; echo "p=$p q=$q";; esac`,
      "p=a q=b\n",
    ],
    [
      "while loop inside an if",
      `printf 'a\\nb\\n' | if :; then while read l; do echo "l=$l"; done; fi`,
      "l=a\nl=b\n",
    ],
    [
      "case inside an if",
      `printf 'a\\nb\\n' | if :; then case x in x) read p;; esac; read q; echo "p=$p q=$q"; fi`,
      "p=a q=b\n",
    ],
    ["middle stage", "echo hi | if :; then cat; fi | tr a-z A-Z", "HI\n"],
    [
      "mapfile in the body",
      `printf 'a\\nb\\n' | if :; then mapfile -t A; echo "\${#A[@]} \${A[1]}"; fi`,
      "2 b\n",
    ],
  ];

  for (const [label, script, stdout] of stages) {
    it(label, async () => {
      expect(await run(script)).toBe(stdout);
    });
  }

  it("the condition and the body share one stream", async () => {
    expect(
      await run(
        `printf 'a\\nb\\n' | if read x; then read y; echo "x=$x y=$y"; fi`,
      ),
    ).toBe("x=a y=b\n");
  });

  it("the case word and the for words read the pipe", async () => {
    expect(
      await run(
        "echo hi | case $(cat) in hi) echo yes;; *) echo no;; esac; " +
          'echo "a b" | for w in $(cat); do echo "w=$w"; done',
      ),
    ).toBe("yes\nw=a\nw=b\n");
  });

  it("an empty pipe is empty input, not the enclosing stream", async () => {
    expect(
      await run('echo outer | { printf "" | if :; then cat; fi; cat; }'),
    ).toBe("outer\n");
  });

  it("a redirection on the compound wins over the pipe", async () => {
    expect(await run("echo piped | if :; then cat; fi < /file.txt")).toBe(
      "F1\nF2\n",
    );
  });

  it("lastpipe keeps variables read in the last stage", async () => {
    expect(
      await run(
        `shopt -s lastpipe; printf 'a\\nb\\n' | if :; then read x; read y; fi; echo "x=$x y=$y"`,
      ),
    ).toBe("x=a y=b\n");
  });
});

describe("compound commands share an inherited stream", () => {
  const shared: Array<[label: string, script: string, stdout: string]> = [
    [
      "if",
      `printf 'a\\nb\\n' | { if :; then read x; fi; read y; echo "x=$x y=$y"; }`,
      "x=a y=b\n",
    ],
    [
      "for",
      `printf 'a\\nb\\n' | { for i in 1; do read x; done; read y; echo "x=$x y=$y"; }`,
      "x=a y=b\n",
    ],
    [
      "case",
      `printf 'a\\nb\\n' | { case q in q) read x;; esac; read y; echo "x=$x y=$y"; }`,
      "x=a y=b\n",
    ],
    [
      "if under a file redirection",
      '{ if :; then read x; fi; read y; echo "x=$x y=$y"; } < /file.txt',
      "x=F1 y=F2\n",
    ],
  ];

  for (const [label, script, stdout] of shared) {
    it(`a read inside ${label} advances the enclosing position`, async () => {
      expect(await run(script)).toBe(stdout);
    });
  }

  it("a piped compound leaves the enclosing stream alone", async () => {
    expect(
      await run(
        '{ echo zz | if :; then cat; fi; read b; echo "b=[$b]"; } < /loop.txt',
      ),
    ).toBe("zz\nb=[L1]\n");
  });

  it("an if in a read loop body pairs the lines", async () => {
    expect(
      await run(
        'while read x; do if :; then read y; fi; echo "$x$y"; done < /loop.txt',
      ),
    ).toBe("L1L2\nL3L4\nL5\n");
  });
});

describe("compound function bodies read the caller's stdin", () => {
  const bodies: Array<[label: string, definition: string]> = [
    ["if", "f() if :; then cat; fi"],
    ["for", "f() for i in 1; do cat; done"],
    ["case", "f() case x in x) cat;; esac"],
  ];

  for (const [label, definition] of bodies) {
    it(`${label} body reads a piped call's stdin`, async () => {
      expect(await run(`${definition}; echo hi | f`)).toBe("hi\n");
    });
  }

  for (const source of ["/empty.txt", "/dev/null"]) {
    it(`a call redirected from ${source} reads EOF`, async () => {
      expect(
        await run(
          '{ read a; f() if :; then read x; echo "x=[$x]"; fi; ' +
            `f < ${source}; read b; echo "a=$a b=$b"; } < /loop.txt`,
        ),
      ).toBe("x=[]\na=L1 b=L2\n");
    });
  }
});

import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

async function run(script: string) {
  return new Bash().exec(`x=echo; ${script}`);
}

describe("a subshell in the body of a case item", () => {
  it.each([
    // [script, stdout]
    ["case a in a)\n( $x hi )\n;; esac", "hi\n"],
    ["case a in a) ( $x ) ;; esac", "\n"],
    ["case a in a) echo one; ( $x two ) ;; b) echo b;; esac", "one\ntwo\n"],
    ["case a in a) ( $x hi ) | sed s/h/H/ ;; esac", "Hi\n"],
    ["case a in a) ( $x hi ) ;; (b) echo y ;; esac", "hi\n"],
    ["case b in a) echo a ;; (b) ( $x hi b ) ;; esac", "hi b\n"],
    ["case a in a) ( $x hi ) && echo and ;; esac", "hi\nand\n"],
    ['case a in a) ( "$x" quoted ) ;; esac', "quoted\n"],
    ["case a in a) ( ${x} braces ) ;; esac", "braces\n"],
    ["case a in a) ( $(echo echo) sub ) ;; esac", "sub\n"],
    ["case a in a) if true; then ( $x inif ); fi ;; esac", "inif\n"],
    ["case a in a) ( $x first ); ( $x second ) ;; esac", "first\nsecond\n"],
    ["case a in a) ( $x | cat ) ;; esac", "\n"],
    ["case a in a) ( $x piped | cat ) ;; esac", "piped\n"],
    ["case a in a) ( $x 1 ) 2>&1 ;; esac", "1\n"],
    ["case a in a) ( $x done ) ;& b) echo b ;; esac", "done\nb\n"],
  ])("runs %j", async (script, stdout) => {
    const result = await run(script);
    expect(result).toMatchObject({ stdout, stderr: "", exitCode: 0 });
  });

  it("still rejects a pattern that follows a command without ;;", async () => {
    const result = await run("case a in a) echo x\n(*) echo y ;; esac");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("syntax error");
    expect(result.stdout).toBe("");
  });

  it("still rejects an alternation of patterns that follows a command without ;;", async () => {
    const result = await run("case a in a) echo x\n(*|b) echo y ;; esac");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("syntax error");
  });
});

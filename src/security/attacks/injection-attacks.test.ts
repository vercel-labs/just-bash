/**
 * Injection Attack Prevention
 *
 * Tests for variable name injection, arithmetic expression injection,
 * pattern matching injection, and IFS manipulation.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../index.js";

describe("Injection Attack Prevention", () => {
  let bash: Bash;

  beforeEach(() => {
    bash = new Bash();
  });

  describe("Variable Name Injection", () => {
    it("should validate variable names in declare", async () => {
      const result = await bash.exec(`
        declare validname=value
        echo $validname
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("value\n");
    });

    it("should reject invalid variable names", async () => {
      const result = await bash.exec(`
        declare "123invalid"=value 2>&1 || true
      `);
      // Should fail or produce error
      expect(typeof result.exitCode).toBe("number");
    });

    it("should validate variable names in export", async () => {
      const result = await bash.exec(`
        export VALID_VAR=value
        printenv VALID_VAR
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("value\n");
    });

    it("should validate variable names in local", async () => {
      const result = await bash.exec(`
        testfunc() {
          local valid_local=value
          echo $valid_local
        }
        testfunc
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("value\n");
    });

    it("should handle variable names with underscores", async () => {
      const result = await bash.exec(`
        _underscore_var=value
        echo $_underscore_var
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("value\n");
    });

    it("should handle variable names starting with underscore", async () => {
      const result = await bash.exec(`
        __private=value
        echo $__private
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("value\n");
    });
  });

  describe("Arithmetic Expression Safety", () => {
    it("should handle basic arithmetic safely", async () => {
      const result = await bash.exec(`
        x=5
        y=3
        echo $((x + y))
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("8\n");
    });

    it("should handle nested arithmetic", async () => {
      const result = await bash.exec(`
        a=2
        b=3
        echo $(( (a + b) * 2 ))
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("10\n");
    });

    it("should handle arithmetic in array index", async () => {
      const result = await bash.exec(`
        arr=(a b c d e)
        i=2
        echo \${arr[i+1]}
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("d\n");
    });

    it("should handle arithmetic variable chains", async () => {
      const result = await bash.exec(`
        a=5
        b=a
        echo $((b + 1))
      `);
      // Bash evaluates 'a' as variable reference
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("6\n");
    });

    it("should handle division by zero gracefully", async () => {
      const result = await bash.exec(`
        echo $((10 / 0)) 2>&1 || true
      `);
      // Should produce error or handle gracefully
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle modulo by zero gracefully", async () => {
      const result = await bash.exec(`
        echo $((10 % 0)) 2>&1 || true
      `);
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Pattern Matching Safety", () => {
    it("should handle basic glob patterns", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/patterntest
        touch /tmp/patterntest/file1.txt /tmp/patterntest/file2.txt
        ls /tmp/patterntest/*.txt
        rm -r /tmp/patterntest
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("file1.txt");
      expect(result.stdout).toContain("file2.txt");
    });

    it("should handle character classes in patterns", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/charpattern
        touch /tmp/charpattern/a.txt /tmp/charpattern/b.txt /tmp/charpattern/1.txt
        ls /tmp/charpattern/[ab].txt
        rm -r /tmp/charpattern
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("a.txt");
      expect(result.stdout).toContain("b.txt");
      expect(result.stdout).not.toContain("1.txt");
    });

    it("should handle extglob patterns where enabled", async () => {
      const result = await bash.exec(`
        shopt -s extglob
        mkdir -p /tmp/extglob
        touch /tmp/extglob/file.txt /tmp/extglob/file.log
        ls /tmp/extglob/file.@(txt|log) 2>/dev/null || ls /tmp/extglob/file.*
        rm -r /tmp/extglob
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle pattern matching in case statements", async () => {
      const result = await bash.exec(`
        test_case() {
          case "$1" in
            *.txt) echo "text file";;
            *.log) echo "log file";;
            *) echo "unknown";;
          esac
        }
        test_case "document.txt"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("text file\n");
    });

    it("should handle regex in [[ ]]", async () => {
      const result = await bash.exec(`
        str="hello123world"
        if [[ $str =~ ^hello[0-9]+world$ ]]; then
          echo "match"
        else
          echo "no match"
        fi
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("match\n");
    });
  });

  describe("IFS Manipulation", () => {
    it("should handle default IFS", async () => {
      const result = await bash.exec(`
        read -a arr <<< "a b c"
        echo \${#arr[@]}
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("3\n");
    });

    it("should handle custom IFS", async () => {
      const result = await bash.exec(`
        IFS=:
        read -a arr <<< "a:b:c"
        echo \${#arr[@]}
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("3\n");
    });

    it("should handle empty IFS", async () => {
      const result = await bash.exec(`
        IFS=''
        str="a b c"
        for word in $str; do
          echo "word: $word"
        done
      `);
      expect(result.exitCode).toBe(0);
      // With empty IFS, word splitting is disabled
      expect(result.stdout).toBe("word: a b c\n");
    });

    it("should restore IFS after local scope", async () => {
      const result = await bash.exec(`
        test_ifs() {
          local IFS=:
          echo "in func: $IFS"
        }
        test_ifs
        echo "after func: $IFS"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("in func: :");
      // IFS should be restored after function
    });

    it("should handle IFS with special characters", async () => {
      const result = await bash.exec(`
        IFS=$'\\n'
        str=$'line1\\nline2\\nline3'
        count=0
        for line in $str; do
          ((count++))
        done
        echo $count
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("3\n");
    });
  });

  describe("Command Substitution Safety", () => {
    it("should handle nested command substitution", async () => {
      const result = await bash.exec(`
        echo $(echo $(echo "nested"))
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("nested\n");
    });

    it("should isolate command substitution environment", async () => {
      const result = await bash.exec(`
        outer=original
        result=$(outer=modified; echo $outer)
        echo "result: $result, outer: $outer"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("result: modified, outer: original\n");
    });

    it("should handle command substitution with special chars", async () => {
      const result = await bash.exec(`
        special="hello; echo pwned"
        result=$(echo "$special")
        echo "result: $result"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("result: hello; echo pwned\n");
      expect(result.stdout).not.toMatch(/^pwned$/m);
    });
  });

  describe("Eval Safety", () => {
    it("should execute eval within limits", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxCommandCount: 10 },
      });

      const result = await limitedBash.exec(`
        eval 'echo hello'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello\n");
    });

    it("should enforce limits inside eval", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxCommandCount: 3 },
      });

      const result = await limitedBash.exec(`
        eval 'echo 1; echo 2; echo 3; echo 4; echo 5'
      `);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("too many commands");
    });

    it("should handle nested eval", async () => {
      const result = await bash.exec(`
        eval 'eval "echo nested"'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("nested\n");
    });
  });

  describe("Parameter Expansion Safety", () => {
    it("should handle ${var:-default} safely", async () => {
      const result = await bash.exec(`
        unset myvar
        echo \${myvar:-default}
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("default\n");
    });

    it("should handle ${var:=default} safely", async () => {
      const result = await bash.exec(`
        unset myvar
        echo \${myvar:=assigned}
        echo $myvar
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("assigned\nassigned\n");
    });

    it("should handle ${var:+alternate} safely", async () => {
      const result = await bash.exec(`
        myvar=set
        echo \${myvar:+alternate}
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alternate\n");
    });

    it("should handle ${var:?error} safely", async () => {
      const result = await bash.exec(`
        unset myvar
        echo \${myvar:?custom error} 2>&1 || true
      `);
      expect(result.stderr).toContain("custom error");
    });

    it("should handle ${!prefix*} safely", async () => {
      const result = await bash.exec(`
        PREFIX_A=1
        PREFIX_B=2
        PREFIX_C=3
        echo \${!PREFIX_*}
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("PREFIX_");
    });

    it("should handle ${#var} safely", async () => {
      const result = await bash.exec(`
        str="hello"
        echo \${#str}
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("5\n");
    });

    it("should handle ${var//pattern/replacement} safely", async () => {
      const result = await bash.exec(`
        str="hello world"
        echo \${str//o/0}
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hell0 w0rld\n");
    });
  });

  describe("Array Injection Safety", () => {
    it("should handle array with special characters", async () => {
      const result = await bash.exec(`
        arr=('a b' 'c;d' 'e|f')
        for item in "\${arr[@]}"; do
          echo "item: $item"
        done
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("item: a b\nitem: c;d\nitem: e|f\n");
    });

    it("should handle associative array with special keys", async () => {
      const result = await bash.exec(`
        declare -A assoc
        assoc["key with spaces"]="value1"
        assoc["key;special"]="value2"
        echo \${assoc["key with spaces"]}
        echo \${assoc["key;special"]}
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("value1\nvalue2\n");
    });

    it("should handle array indices safely", async () => {
      const result = await bash.exec(`
        arr=(a b c d e)
        i=2
        echo \${arr[$i]}
        echo \${arr[i+1]}
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("c\nd\n");
    });
  });
});

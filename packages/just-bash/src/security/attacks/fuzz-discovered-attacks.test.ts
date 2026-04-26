/**
 * Fuzz-Discovered Attack Vectors
 *
 * This test file contains attack vectors discovered through fuzzing that could
 * potentially expose JavaScript native code or cause prototype pollution.
 *
 * When the fuzzer finds a potential bypass, add it here to:
 * 1. Verify whether it's a true positive (real vulnerability)
 * 2. Ensure the fix prevents the attack
 * 3. Prevent regression
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { assertExecResultSafe } from "../fuzzing/oracles/assertions.js";

describe("Fuzz-discovered attack vectors", () => {
  describe("Bash variable expansion with prototype-like names", () => {
    it("${#__defineGetter__} should not expose native code", async () => {
      const env = new Bash();
      const result = await env.exec("echo ${#__defineGetter__}");
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("0");
    });

    it("${#__proto__[@]} should not expose native code", async () => {
      const env = new Bash();
      const result = await env.exec("echo ${#__proto__[@]}");
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("0");
    });

    it("${#valueOf[@]} should not expose native code", async () => {
      const env = new Bash();
      const result = await env.exec("echo ${#valueOf[@]}");
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("0");
    });

    it("${#constructor[@]} should not expose native code", async () => {
      const env = new Bash();
      const result = await env.exec("echo ${#constructor[@]}");
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("0");
    });
  });

  describe("Bash variable assignment with prototype-like names", () => {
    it("__defineGetter__=value should not affect JS prototype", async () => {
      const env = new Bash();
      const result = await env.exec(
        '__defineGetter__="test"; echo $__defineGetter__',
      );
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("test");
    });

    it("__proto__=value should not affect JS prototype", async () => {
      const env = new Bash();
      const result = await env.exec('__proto__="test"; echo $__proto__');
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("test");
    });

    it("constructor=value should not affect JS prototype", async () => {
      const env = new Bash();
      const result = await env.exec('constructor="test"; echo $constructor');
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("test");
    });

    it("export constructor=value should not expose native code", async () => {
      const env = new Bash();
      const result = await env.exec(
        "export constructor=8Pf; echo $constructor",
      );
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("8Pf");
    });
  });

  describe("Bash nameref with prototype-like names", () => {
    it("declare -n ref=constructor should not expose native code", async () => {
      const env = new Bash();
      const result = await env.exec(
        "declare -n Q=constructor; Q=polluted; echo ${Q}",
      );
      assertExecResultSafe(result);
    });

    it("declare -n ref=__proto__ should not expose native code", async () => {
      const env = new Bash();
      const result = await env.exec("declare -n ref=__proto__; echo ${ref}");
      assertExecResultSafe(result);
    });
  });

  describe("Bash associative arrays with prototype-like keys", () => {
    it("arr[__proto__]=value should not pollute prototype", async () => {
      const env = new Bash();
      const result = await env.exec(
        "declare -A arr; arr[__proto__]=test; echo ${arr[__proto__]}",
      );
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("test");
    });

    it("arr[constructor]=value should not pollute prototype", async () => {
      const env = new Bash();
      const result = await env.exec(
        "declare -A arr; arr[constructor]=test; echo ${arr[constructor]}",
      );
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("test");
    });

    it("arr[__defineGetter__]=value should not pollute prototype", async () => {
      const env = new Bash();
      const result = await env.exec(
        "declare -A arr; arr[__defineGetter__]=test; echo ${arr[__defineGetter__]}",
      );
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("test");
    });

    it("iterating assoc array with prototype keys should be safe", async () => {
      const env = new Bash();
      const result = await env.exec(
        'declare -A x; x[__proto__]=a; x[constructor]=b; for k in "${!x[@]}"; do echo "key=$k"; done',
      );
      assertExecResultSafe(result);
      expect(result.stdout).toContain("__proto__");
      expect(result.stdout).toContain("constructor");
    });
  });

  describe("Bash indexed arrays with prototype values", () => {
    it("array containing prototype names as values should be safe", async () => {
      const env = new Bash();
      const result = await env.exec(
        "arr=(__proto__ constructor valueOf); echo ${arr[0]} ${arr[1]} ${arr[2]}",
      );
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("__proto__ constructor valueOf");
    });
  });

  describe("Bash arithmetic with prototype-like variable names", () => {
    it("$((--__proto__)) should not expose native code", async () => {
      const env = new Bash();
      const result = await env.exec("echo $((--__proto__))");
      assertExecResultSafe(result);
      expect(result.exitCode).toBe(0);
    });

    it("$((constructor + 1)) should not expose native code", async () => {
      const env = new Bash();
      const result = await env.exec("echo $((constructor + 1))");
      assertExecResultSafe(result);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Complex fuzz-generated scripts", () => {
    it("should handle complex script with multiple prototype references", async () => {
      const env = new Bash();
      const script = `
        n9O[vutWUi0V3ER]=\${#__defineGetter__}
        declare -A ZbhbQNXWV
        ZbhbQNXWV[qjN5r1Uk3S]=\${#__proto__[@]}
        echo \${n9O[vutWUi0V3ER]} \${ZbhbQNXWV[qjN5r1Uk3S]}
      `;
      const result = await env.exec(script);
      assertExecResultSafe(result);
    });

    it("should handle pollution expansion script", async () => {
      const env = new Bash();
      const result = await env.exec(
        "declare -n Q=constructor; Q=polluted; echo ${!prototype}",
      );
      assertExecResultSafe(result);
    });

    it("should handle nested pollution attempts", async () => {
      const env = new Bash();
      const script = `
        __lookupGetter__="q\${NoCmvlzoa[E29zoHxnU]}"
        export constructor=8Pf
        __proto__=nTk1n0Z
        Z7CrdEIx8E=\${tmDcI_FJH}
        export __defineSetter__=VqYzpDt
        echo $__lookupGetter__ $constructor $__proto__
      `;
      const result = await env.exec(script);
      assertExecResultSafe(result);
    });
  });

  describe("JQ prototype pollution via bash", () => {
    it("should not expose native code via jq field access", async () => {
      const env = new Bash();
      const result = await env.exec("echo '{}' | jq '.__defineGetter__'");
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("null");
    });

    it("should not expose native code via jq getpath", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{}' | jq 'getpath(["__defineGetter__"])'`,
      );
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("null");
    });

    it("should not expose native code via jq recursive descent", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{"a":{"__proto__":1}}' | jq '.. | objects | .__proto__? // empty'`,
      );
      assertExecResultSafe(result);
    });
  });

  describe("Command pipelines from fuzzer", () => {
    it("date piped to cat with missing file", async () => {
      const env = new Bash();
      const result = await env.exec(
        "date +%Y-%m-%d | cat l6jxslovcy.json 2>&1 || true",
      );
      assertExecResultSafe(result);
    });

    it("echo piped to grep with random pattern", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "test line" | grep "D_xgijZtKsat" 2>&1 || true',
      );
      assertExecResultSafe(result);
    });
  });

  describe("AWK commands from fuzzer", () => {
    it("awk with decrement operator", async () => {
      const env = new Bash();
      const result = await env.exec("awk -F, '{ XW4pCI93-- }' .. 2>&1 || true");
      assertExecResultSafe(result);
    });

    it("awk with whitespace pattern on directory", async () => {
      const env = new Bash();
      const result = await env.exec("awk -F, '/\\s+/' /tmp 2>&1 || true");
      assertExecResultSafe(result);
    });

    it("awk with constructor variable", async () => {
      const env = new Bash();
      const result = await env.exec(
        `awk -v constructor=polluted '{ print "constructor" }' 2>&1 || true`,
      );
      assertExecResultSafe(result);
    });

    it("awk with pollution array access", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "__proto__ constructor prototype" | awk '/hasOwnProperty/ { print yzLMBe91S["toLocaleString"] = $0 / $1 }' 2>&1 || true`,
      );
      assertExecResultSafe(result);
    });
  });

  describe("SED commands from fuzzer", () => {
    it("sed with delete command", async () => {
      const env = new Bash();
      const result = await env.exec(`echo "test" | sed -E 'd' 2>&1 || true`);
      assertExecResultSafe(result);
    });

    it("sed with line-specific delete", async () => {
      const env = new Bash();
      const result = await env.exec(`echo "test" | sed -E '5d' 2>&1 || true`);
      assertExecResultSafe(result);
    });

    it("sed with prototype pattern range and transliterate", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo "__proto__ constructor prototype" | sed '/prototype/,/__proto__/y/aeiou/AEIOU/' 2>&1 || true`,
      );
      assertExecResultSafe(result);
    });
  });

  describe("JQ commands from fuzzer", () => {
    it("jq keys minus array element", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '[{"a":1},{"a":2}]' | jq 'keys - .[]' 2>&1 || true`,
      );
      assertExecResultSafe(result);
    });

    it("jq optional field access on missing file", async () => {
      const env = new Bash();
      const result = await env.exec(
        "jq '.NJrKp37?' r_fcmgdak4-5.json 2>&1 || true",
      );
      assertExecResultSafe(result);
    });

    it("jq with pollution keys in input", async () => {
      const env = new Bash();
      const result = await env.exec(
        `echo '{"__proto__":{"polluted":true},"constructor":1}' | jq '(.items = "__defineSetter__") // (.id = "propertyIsEnumerable")' 2>&1 || true`,
      );
      assertExecResultSafe(result);
    });
  });

  describe("Complex bash control flow with pollution names", () => {
    it("while loop with prototype variable expansion", async () => {
      const env = new Bash();
      const result = await env.exec(
        "while Zba=${#dZ2Spyc[@]} sh | [[ -f 'moo0yhzq6' ]]; do constructor=${prototype:10} || cat {M89p2,jMxO_vkKV7S}; done & wait 2>&1 || true",
      );
      assertExecResultSafe(result);
    });

    it("local __proto__ with function defining assoc array", async () => {
      const env = new Bash();
      const script = `
        local __proto__=NREXI | set 'TsYvNYF6'
        prototype() { declare -A zb; zb[constructor]={4..7}; }
        ! (! wc EDzpt92o && export prototype='mg9i')
      `;
      const result = await env.exec(`${script} 2>&1 || true`);
      assertExecResultSafe(result);
    });

    it("simple constructor assignment", async () => {
      const env = new Bash();
      const result = await env.exec("constructor=5m 2>&1 || true");
      assertExecResultSafe(result);
    });

    it("case statement with pollution variable names", async () => {
      const env = new Bash();
      const script = `
        case $constructor in
          LTma_)
            if __proto__=\${G} | local DVtgb=Xj; then
              declare -A e5
              e5[__proto__]=i/xE5Ri || unset Sq.taP | false 2>&1
            fi || [[ -f $__proto__ ]] | GMY3Zjo[__lookupSetter__]=pT_KEA3K.pS8
            ;;
        esac 2>&1 || true
      `;
      const result = await env.exec(script);
      assertExecResultSafe(result);
    });

    it("for loop with nameref to __proto__", async () => {
      const env = new Bash();
      const result = await env.exec(
        "for a in a; do declare -n a=__proto__; done | a[__defineGetter__]=a 2>&1 || true",
      );
      assertExecResultSafe(result);
    });

    it("complex multi-line with propertyIsEnumerable", async () => {
      const env = new Bash();
      const script = `
        RkMZTH4A9={2..8} 85 | sGjqaq1F6Id=GqXg9RPTAR1 sh
        export ucGfVZZ="wlY$propertyIsEnumerable" | yPSuB3Cg=\${#MV[@]} || (local __defineGetter__=\${__proto__[6]}) | if __defineSetter__=\${prototype}; then j8WWQnmwDp1w "e3r/87ns_1$$" {3..13} && [[ -e $* ]]; fi
      `;
      const result = await env.exec(`${script} 2>&1 || true`);
      assertExecResultSafe(result);
    });

    it("echo prototype array expansion", async () => {
      const env = new Bash();
      const result = await env.exec("echo ${prototype[@]} 2>&1 || true");
      assertExecResultSafe(result);
    });

    it("while loop with brace expansion and prototype assignment", async () => {
      const env = new Bash();
      const script = `
        while prototype={4..14} | H08OO9hF[constructor]=PI8; do
          ! declare -n FeCF_MmW=W0lEbMhv
        done | local ACH1G=ru.IDBHJkS_
        ((rm /= EdxPpqwOeq)) | ((0X1F))
        export prototype=mjGu6KeqXcn
      `;
      const result = await env.exec(`${script} 2>&1 || true`);
      assertExecResultSafe(result);
    });

    it("yq pipe with for loop using prototype variables", async () => {
      const env = new Bash();
      const script = `
        bqiLR1J=\${bkIMDK9tpK} yq | MMdy[dst8]=- && for LHFqdA01Q in {3..16} d8QcI/oe 'rMb/vv4b'; do
          ! constructor=\${__proto__:-OP1lmPiFYbDi}
        done | [[ -e "tu/EL3sa\${prototype[8]}" ]]
      `;
      const result = await env.exec(`${script} 2>&1 || true`);
      assertExecResultSafe(result);
    });

    it("background function named constructor", async () => {
      const env = new Bash();
      const script = `
        true -ZI46r1/// tRbE16Z 'L7M' | NHiOLNJX6jQ=u/A test || du \${prototype} 'X' | declare -n YrFM9Q7gU8V=__proto__
        declare '9bvdFr4VKPy7' 'VxGWtRkq6SP' || declare -n w557Ukcaa5x=__lookupSetter__
        constructor() { constructor=aXaGf; } &
        wait
      `;
      const result = await env.exec(`${script} 2>&1 || true`);
      assertExecResultSafe(result);
    });
  });

  describe("Fuzz-discovered timeout regressions", () => {
    // These scripts were discovered by fuzzing and initially caused timeouts.
    // They serve as regression tests to ensure they complete in reasonable time.

    it("C-style for loop with ternary in increment", async () => {
      // Originally took 37819ms to timeout
      const env = new Bash({
        executionLimits: { maxLoopIterations: 100, maxCommandCount: 100 },
      });
      const script = `for ((++HvL80q71kdn; -428 == Kw_PCw; RN3 ? 937 : 2#101)); do yuHtpyKKdV4=\${toString[5]} set; done
for gTcon in 'i2cZ1' 'V6' '8A9It2Dg0sZW' \${!constructor}; do declare -A vs; vs[constructor]='aM1VdRfPp' | JXVMw[constructor]=N &; done
! (jq 9X3NB {0..17}) || VVZk4lQ61al[propertyIsEnumerable]=$lkBt | niZap6rwgB=".o\${!__lookupGetter__}" cat`;
      const result = await env.exec(script);
      assertExecResultSafe(result);
    });

    it("nested if statements with pipes", async () => {
      // Originally took 71517ms to timeout
      const env = new Bash({
        executionLimits: { maxLoopIterations: 100, maxCommandCount: 100 },
      });
      const script = `I0EfEH[toLocaleString]=cmKwOvR | if ! if if local Ip=dWiFTnFFZ2ME; then Sw=0btQ cat; fi | lxpUU=1MQwQQ3Vkw0m rg; then constructor=46 || prototype=h7zvB4LR8S0H; fi; then if { propertyIsEnumerable='L3'; }; then if [[ -e B ]]; then rAUcdqj7s[e4UYv0GjAu]=kzc; fi; fi || ((Taxz5y)); fi 2>&1 || true`;
      const result = await env.exec(script);
      assertExecResultSafe(result);
    });

    it("declare -n with prototype names and indirect expansion", async () => {
      // Originally took 1691ms to timeout
      const env = new Bash({
        executionLimits: { maxLoopIterations: 100, maxCommandCount: 100 },
      });
      const script = `! declare -n E9=hasOwnProperty && M.pMl \${constructor:-Exo6z855_L}
rg vHlanutW || export __defineGetter__=\${!__proto__}`;
      const result = await env.exec(script);
      assertExecResultSafe(result);
    });

    it("should handle binary literal in arithmetic ternary", async () => {
      // Component of the first timeout script
      const env = new Bash();
      const result = await env.exec("echo $((RN3 ? 937 : 2#101))");
      assertExecResultSafe(result);
      // 2#101 is binary 101 = 5 decimal
      expect(result.stdout.trim()).toBe("5");
    });

    it("should handle deeply nested if as condition", async () => {
      // Component of the second timeout script
      const env = new Bash();
      const result = await env.exec(
        "if if if true; then echo a; fi; then echo b; fi; then echo c; fi",
      );
      assertExecResultSafe(result);
      expect(result.stdout.trim()).toBe("a\nb\nc");
    });

    it("should handle indirect expansion of prototype name", async () => {
      // Component of the third timeout script
      // ${!__proto__} is indirect expansion - returns variable name matching prefix
      // Exit code 1 is expected when the variable is unset
      const env = new Bash();
      const result = await env.exec("echo ${!__proto__}");
      assertExecResultSafe(result);
      // Just verify it completes and doesn't expose native code
    });

    it("while loop with for loop as condition and background jobs", async () => {
      // Originally took 11908ms to timeout
      const env = new Bash({
        executionLimits: { maxLoopIterations: 100, maxCommandCount: 100 },
      });
      const script = `while for ((HyO3HFaL4; -929 == NpRe0oLrk; ++Glp)); do ! false < /dev/null &; done | T0ut0imRm=WBc drte4sOL; do h() { ! local 6tqqC w4 && local isPrototypeOf=\${valueOf:-0JuHjVG0gz49}; } | if prototype=\${q7jNtu8lZ[constructor]}; then declare -A cd; cd[__proto__]=\${!propertyIsEnumerable@}; fi; done | declare -n TUn0Xvw=prototype
! ufsXx7KR48[prototype]=A0r4wHb && local BTi='hZ1YRkhWdO'
((!rg))`;
      const result = await env.exec(script);
      assertExecResultSafe(result);
    });

    it("arithmetic in pipe with assoc array and prototype names", async () => {
      // Originally took 49843ms to timeout - execution limits didn't trigger
      const env = new Bash({
        executionLimits: { maxLoopIterations: 100, maxCommandCount: 100 },
      });
      const script = `declare -A Q_RHb04ugQ; Q_RHb04ugQ[__defineGetter__]=GSGqLBCa
if ((-516)) | declare -A hpLXpICxv9; hpLXpICxv9[__proto__]="T2\${hasOwnProperty}"; then ((jq /= 917)); fi`;
      const result = await env.exec(script);
      assertExecResultSafe(result);
    });

    it("indirect expansion with @ suffix and command substitution", async () => {
      // Fuzz-discovered: crashed without producing a result
      const env = new Bash({
        executionLimits: { maxLoopIterations: 100, maxCommandCount: 100 },
      });
      const script = `A=\${!zxBPjKVee@} sh
! EUQoB4pyO="KzDp$(false)"`;
      const result = await env.exec(script);
      assertExecResultSafe(result);
    });
  });
});

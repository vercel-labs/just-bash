/**
 * Coverage Boost Generators
 *
 * Targeted generators that exercise specific interpreter features
 * not well-covered by the general grammar generator. Each generator
 * focuses on a gap identified in coverage reports.
 */

import fc from "fast-check";
import { identifier, simpleWord } from "./grammar-generator.js";

// =============================================================================
// BASH EXPANSION BOOST
// Targets: :=, :?, :+, //, ^^, ,,, @Q, ~
// =============================================================================

const bashExpansionBoost: fc.Arbitrary<string> = fc.oneof(
  // assign_default: ${var:=word}
  fc
    .tuple(identifier, simpleWord)
    .map(([v, w]) => `echo "\${${v}:=${w}}"`),
  // error_if_unset: ${var:?msg}
  fc
    .tuple(identifier, simpleWord)
    .map(([v, m]) => `echo "\${${v}:?${m}}" 2>/dev/null || true`),
  // use_alternative: ${var:+word}
  fc
    .tuple(identifier, simpleWord)
    .map(([v, w]) => `${v}=1; echo "\${${v}:+${w}}"`),
  // pattern_replacement: ${var//pat/rep}
  fc
    .tuple(identifier, simpleWord)
    .map(([v, w]) => `${v}=hello; echo "\${${v}/ell/${w}}"`),
  // case_modification: ${var^^}, ${var,,}
  identifier.map((v) => `${v}=hello; echo "\${${v}^^}"`),
  identifier.map((v) => `${v}=HELLO; echo "\${${v},,}"`),
  // transform: ${var@Q}
  identifier.map((v) => `${v}=hello; echo "\${${v}@Q}"`),
  // tilde expansion
  fc.constant("echo ~"),
  fc.constant("echo ~/test"),
  fc.constant("cd ~; pwd"),
);

// =============================================================================
// BASH BUILTIN BOOST
// Targets: cd, read, source, getopts, pushd/popd, hash, help, mapfile, etc.
// =============================================================================

const bashBuiltinBoost: fc.Arbitrary<string> = fc.oneof(
  // cd
  fc.constant("cd /tmp && cd -"),
  // read
  fc.constant("echo hello | read x; echo $x"),
  // source (need a file)
  fc.constant('echo "echo sourced" > /tmp/s.sh; source /tmp/s.sh'),
  // getopts
  fc.constant('while getopts "ab:" opt; do echo $opt; done'),
  // pushd/popd/dirs
  fc.constant("pushd /tmp >/dev/null; popd >/dev/null"),
  fc.constant("dirs"),
  // hash
  fc.constant("hash"),
  // help
  fc.constant("help echo"),
  // mapfile
  fc.constant('echo -e "a\\nb\\nc" | mapfile arr; echo ${#arr[@]}'),
  // test/[
  fc.constant("test -d /tmp"),
  fc.constant("[ -f /dev/null ]"),
  // wait
  fc.constant("wait"),
  // type
  fc.constant("type echo"),
  // command
  fc.constant("command echo hello"),
  // builtin
  fc.constant("builtin echo hello"),
  // export
  fc.constant("export MY_VAR=hello; echo $MY_VAR"),
  // unset
  fc.constant("X=1; unset X; echo ${X:-unset}"),
  // exit (in subshell)
  fc.constant("(exit 0)"),
  // local
  fc.constant("f() { local x=42; echo $x; }; f"),
  // set
  fc.constant("set -- a b c; echo $1"),
  // break
  fc.constant("for i in 1 2 3; do break; done"),
  // continue
  fc.constant("for i in 1 2 3; do continue; echo $i; done"),
  // return
  fc.constant("f() { return 5; }; f; echo $?"),
  // eval
  fc.constant("eval 'echo evaluated'"),
  // shift
  fc.constant("set -- a b c; shift; echo $1"),
  // declare
  fc.constant("declare -i x=5; echo $x"),
  // typeset
  fc.constant("typeset -i y=10; echo $y"),
  // readonly
  fc.constant("readonly RO=val; echo $RO"),
  // shopt
  fc.constant("shopt -s extglob"),
  // exec (in subshell)
  fc.constant("(exec echo hello)"),
  // : (null command)
  fc.constant(": this is a no-op"),
  // let
  fc.constant("let x=5+3; echo $x"),
  // readarray (alias for mapfile)
  fc.constant('echo -e "a\\nb\\nc" | readarray arr; echo ${#arr[@]}'),
  // . (alias for source)
  fc.constant('echo "echo dotted" > /tmp/d.sh; . /tmp/d.sh'),
);

// =============================================================================
// AWK STATEMENT BOOST
// Targets: while, for, for_in, do-while, break, continue, delete, return, next
// =============================================================================

const awkStmtBoost: fc.Arbitrary<string> = fc.oneof(
  // while loop
  fc.constant(`echo "1 2 3" | awk '{i=1; while(i<=NF){print $i; i++}}'`),
  // for loop
  fc.constant(`echo "a b c" | awk '{for(i=1;i<=NF;i++) print $i}'`),
  // for-in loop
  fc.constant(
    `echo "a b a c b" | awk '{for(i=1;i<=NF;i++) arr[$i]++} END{for(k in arr) print k, arr[k]}'`,
  ),
  // do-while
  fc.constant(`echo "test" | awk '{i=0; do{i++}while(i<3); print i}'`),
  // break
  fc.constant(
    `echo "test" | awk '{for(i=1;i<=5;i++){if(i==3)break; print i}}'`,
  ),
  // continue
  fc.constant(
    `echo "test" | awk '{for(i=1;i<=5;i++){if(i==3)continue; print i}}'`,
  ),
  // delete
  fc.constant(
    `echo "a b" | awk '{arr["x"]=1; delete arr["x"]; print length(arr)}'`,
  ),
  // return (user-defined function)
  fc.constant(
    `echo "5" | awk 'function double(x){return x*2}{print double($1)}'`,
  ),
  // next
  fc.constant(`printf "a\\nb\\nc\\n" | awk '/b/{next}{print}'`),
  // nextfile
  fc.constant(`printf "a\\nb\\n" | awk 'FNR==1{nextfile}{print}'`),
);

// =============================================================================
// AWK EXPRESSION BOOST
// Targets: array_access, pre_increment, pre_decrement, in, getline
// =============================================================================

const awkExprBoost: fc.Arbitrary<string> = fc.oneof(
  // Higher weight for hard-to-hit features
  {
    weight: 3,
    arbitrary: fc.oneof(
      // regex
      fc.constant(`echo "hello" | awk '{if ($0 ~ /ell/) print "match"}'`),
      // regex (extra)
      fc.constant(`echo "abc" | awk '/abc/{print "regex match"}'`),
      // tuple (comma-separated key for multi-dimensional 'in' check)
      fc.constant(`echo "1" | awk 'BEGIN{a[1,2]="x"} {print (1,2) in a}'`),
      // tuple (extra: different array)
      fc.constant(`echo "1" | awk '{a[1,2]=3; print (1,2) in a}'`),
    ),
  },
  {
    weight: 2,
    arbitrary: fc.oneof(
      // array_access
      fc.constant(`echo "a b" | awk '{arr[1]="x"; print arr[1]}'`),
      // pre_increment
      fc.constant(`echo "test" | awk '{x=5; print ++x}'`),
      // pre_decrement
      fc.constant(`echo "test" | awk '{x=5; print --x}'`),
      // in expression
      fc.constant(
        `echo "a b" | awk '{arr["x"]=1; if("x" in arr) print "yes"}'`,
      ),
      // getline
      fc.constant(`echo "hello" | awk '{getline line; print line}'`),
    ),
  },
);

// =============================================================================
// SED COMMAND BOOST
// Targets: branch, branchOnSubst, label, group, hold, next
// =============================================================================

// Sed commands that are harder to hit — give them higher weight via separate group
const sedCmdHardBoost: fc.Arbitrary<string> = fc.oneof(
  // branch + label (exercises both branch and label)
  fc.constant(`printf "a\\nb\\n" | sed ':loop; s/a/A/; /a/b loop'`),
  // branch unconditional
  fc.constant(`printf "a\\nb\\n" | sed 'b end; s/a/x/; :end'`),
  // branchOnSubst (t command)
  fc.constant(`echo "aabb" | sed 's/a/x/; t done; s/b/y/; :done'`),
  // branchOnNoSubst (T command)
  fc.constant(`echo "test" | sed 's/x/y/; T done; s/t/T/; :done'`),
  // group
  fc.constant(`printf "a\\nb\\n" | sed '/a/{s/a/A/; p}'`),
  // next (n)
  fc.constant(`printf "a\\nb\\nc\\n" | sed 'n; p'`),
  // nextAppend (N)
  fc.constant(`printf "a\\nb\\nc\\n" | sed 'N; p'`),
);

const sedCmdBoost: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: sedCmdHardBoost },
  {
    weight: 2,
    arbitrary: fc.oneof(
      // hold/get
      fc.constant(`printf "a\\nb\\n" | sed 'h; s/a/x/; H; g; p'`),
      // print (p)
      fc.constant(`printf "a\\nb\\n" | sed -n 'p'`),
      // printFirstLine (P)
      fc.constant(`printf "a\\nb\\n" | sed -n 'N; P'`),
      // delete (d)
      fc.constant(`printf "a\\nb\\nc\\n" | sed '2d'`),
      // deleteFirstLine (D)
      fc.constant(`printf "a\\nb\\nc\\n" | sed 'N; D'`),
      // append (a)
      fc.constant(`echo "test" | sed 'a\\appended'`),
      // insert (i)
      fc.constant(`echo "test" | sed 'i\\inserted'`),
      // change (c)
      fc.constant(`echo "test" | sed 'c\\changed'`),
      // getAppend (G)
      fc.constant(`printf "a\\nb\\n" | sed 'h; G'`),
      // exchange (x)
      fc.constant(`printf "a\\nb\\n" | sed 'x; p'`),
      // quit (q)
      fc.constant(`printf "a\\nb\\nc\\n" | sed '2q'`),
      // quitSilent (Q)
      fc.constant(`printf "a\\nb\\nc\\n" | sed '2Q'`),
      // transliterate (y)
      fc.constant(`echo "hello" | sed 'y/helo/HELO/'`),
      // lineNumber (=)
      fc.constant(`printf "a\\nb\\n" | sed '='`),
      // zap (z)
      fc.constant(`printf "a\\nb\\n" | sed '1z'`),
      // list (l)
      fc.constant(`echo "hello" | sed -n 'l'`),
      // printFilename (F)
      fc.constant(`echo "test" | sed 'F'`),
      // version (v)
      fc.constant(`echo "test" | sed 'v 4.0'`),
    ),
  },
);

// =============================================================================
// JQ NODE BOOST
// Targets: Reduce, Foreach, Def, VarBind, VarRef, Cond, StringInterp, UpdateOp
// =============================================================================

// JQ nodes that are harder to hit — give them higher weight
const jqNodeHardBoost: fc.Arbitrary<string> = fc.oneof(
  // UnaryOp (negation — must use pipe prefix so - isn't treated as option)
  fc.constant(`echo '5' | jq '. | -(. + 1)'`),
  // UnaryOp (extra: negate after pipe)
  fc.constant(`echo '3' | jq '. as $x | -$x'`),
  // VarRef
  fc.constant(`echo '{"a":1}' | jq '.a as $x | $x + 1'`),
  // VarRef (extra)
  fc.constant(`echo '[1,2,3]' | jq '. as $arr | $arr | length'`),
  // Break
  fc.constant(
    `echo 'null' | jq 'label $out | foreach range(5) as $x (0; . + $x; if . > 5 then ., break $out else . end)'`,
  ),
  // Break (extra: first)
  fc.constant(
    `echo '[1,2,3,4,5]' | jq 'first(label $out | .[] | if . > 3 then ., break $out else . end)'`,
  ),
);

const jqNodeBoost: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: jqNodeHardBoost },
  {
    weight: 2,
    arbitrary: fc.oneof(
      // Reduce
      fc.constant(`echo '[1,2,3]' | jq 'reduce .[] as $x (0; . + $x)'`),
      // Foreach
      fc.constant(`echo 'null' | jq '[foreach range(3) as $x (0; . + $x)]'`),
      // Def (user function)
      fc.constant(`echo '5' | jq 'def double: . * 2; double'`),
      // Cond (if-then-else)
      fc.constant(`echo '5' | jq 'if . > 3 then "big" else "small" end'`),
      // StringInterp
      fc.constant(`echo '{"name":"world"}' | jq '"hello \\(.name)"'`),
      // UpdateOp
      fc.constant(`echo '{"a":1}' | jq '.a |= . + 1'`),
      // Slice
      fc.constant(`echo '[1,2,3,4,5]' | jq '.[1:3]'`),
      // Paren
      fc.constant(`echo '5' | jq '(. + 1) * 2'`),
      // Optional
      fc.constant(`echo '{}' | jq '.foo?'`),
      // Recurse
      fc.constant(`echo '{"a":{"b":1}}' | jq '.. | numbers'`),
    ),
  },
);

// =============================================================================
// COMBINED BOOST
// =============================================================================

export const coverageBoost: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: bashExpansionBoost },
  { weight: 3, arbitrary: bashBuiltinBoost },
  { weight: 3, arbitrary: awkStmtBoost },
  { weight: 2, arbitrary: awkExprBoost },
  { weight: 4, arbitrary: sedCmdBoost },
  { weight: 3, arbitrary: jqNodeBoost },
);

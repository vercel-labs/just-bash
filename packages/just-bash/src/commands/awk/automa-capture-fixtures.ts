// Automa modifications: independent GNU awk 5.2.1 golden outputs.
export const cases = [
  {
    id: "match-captures-clear-and-miss",
    program:
      'BEGIN{a["old"]="old";r=match("ab",/(a)(b)/,a);print r,RSTART,RLENGTH,a[0],a[1],a[2],("old" in a);r=match("zz",/(a)(b)/,a);print r,RSTART,RLENGTH,length(a)}',
    stdin: "",
    expected: {
      exitCode: 0,
      stdout: "1 1 2 ab a b 0\n0 0 -1 0\n",
      stderr: "",
    },
  },
  {
    id: "match-group-index-length",
    program:
      'BEGIN{match("xxab",/(a)(b)/,a);print a[0,"start"],a[0,"length"],a[1,"start"],a[1,"length"],a[2,"start"],a[2,"length"]}',
    stdin: "",
    expected: {
      exitCode: 0,
      stdout: "3 2 3 1 4 1\n",
      stderr: "",
    },
  },
  {
    id: "match-optional-unmatched-groups",
    program:
      'BEGIN{match("b",/(a)?(b)/,a);print (0 in a),(1 in a),(2 in a),a[2],((1 SUBSEP "start") in a),a[2,"start"],a[2,"length"]}',
    stdin: "",
    expected: {
      exitCode: 0,
      stdout: "1 0 1 b 0 1 1\n",
      stderr: "",
    },
  },
  {
    id: "match-participating-empty-group",
    program:
      'BEGIN{match("b",/(a*)(b)/,a);print (1 in a),length(a[1]),a[1,"start"],a[1,"length"],a[2]}',
    stdin: "",
    expected: {
      exitCode: 0,
      stdout: "1 0 1 0 b\n",
      stderr: "",
    },
  },
  {
    id: "match-dynamic-string-regex",
    program: 'BEGIN{p="(a)(b)";match("ab",p,a);print a[0],a[1],a[2]}',
    stdin: "",
    expected: {
      exitCode: 0,
      stdout: "ab a b\n",
      stderr: "",
    },
  },
  {
    id: "match-unicode-character-offsets",
    program:
      'BEGIN{match("😀ab",/(a)(b)/,a);print RSTART,RLENGTH,a[1,"start"],a[2,"start"]}',
    stdin: "",
    expected: {
      exitCode: 0,
      stdout: "2 2 2 3\n",
      stderr: "",
    },
  },
  {
    id: "match-custom-subsep",
    program:
      'BEGIN{SUBSEP="@";match("ab",/(a)(b)/,a);print a["1@start"],a["1@length"],a[1],a[2]}',
    stdin: "",
    expected: {
      exitCode: 0,
      stdout: "1 1 a b\n",
      stderr: "",
    },
  },
];

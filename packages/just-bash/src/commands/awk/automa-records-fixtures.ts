// Automa modifications: independent GNU awk 5.2.1 golden outputs.
export const cases: Array<{
  id: string;
  program: string;
  stdin: string;
  options?: string[];
  args?: string[];
  files?: Record<string, string>;
  expected: { exitCode: number; stdout: string; stderr: string };
}> = [
  {
    id: "rs-default",
    program: '{printf "[%s]|%d|%d\\n",$0,NR,length(RT)}',
    stdin: "a\n\nb\n",
    expected: {
      exitCode: 0,
      stdout: "[a]|1|1\n[]|2|1\n[b]|3|1\n",
      stderr: "",
    },
  },
  {
    id: "rs-literal-single-metachar",
    program: 'BEGIN{RS="|"}{printf "[%s]|%d|%d\\n",$0,NR,length(RT)}',
    stdin: "|a||b|",
    expected: {
      exitCode: 0,
      stdout: "[]|1|1\n[a]|2|1\n[]|3|1\n[b]|4|1\n",
      stderr: "",
    },
  },
  {
    id: "rs-trailing-without-terminator",
    program: 'BEGIN{RS="|"}{printf "[%s]|%d|%d\\n",$0,NR,length(RT)}',
    stdin: "a|b",
    expected: {
      exitCode: 0,
      stdout: "[a]|1|1\n[b]|2|0\n",
      stderr: "",
    },
  },
  {
    id: "rs-regexp-and-rt",
    program: 'BEGIN{RS="[0-9]+"}{printf "[%s][%s]\\n",$0,RT}',
    stdin: "12a3b45",
    expected: {
      exitCode: 0,
      stdout: "[][12]\n[a][3]\n[b][45]\n",
      stderr: "",
    },
  },
  {
    id: "rs-empty-paragraphs",
    program: 'BEGIN{RS=""}{printf "[%s]|%d|%d\\n",$0,NF,NR}',
    stdin: "\n\nalpha\nbeta\n\n\nzeta\n\n",
    expected: {
      exitCode: 0,
      stdout: "[alpha\nbeta]|2|1\n[zeta]|1|2\n",
      stderr: "",
    },
  },
  {
    id: "rs-empty-single-fs-newline",
    program: 'BEGIN{RS="";FS="|"}{printf "%d:%s:%s:%s:%s\\n",NF,$1,$2,$3,$4}',
    stdin: "a|b\nc|d\n\nz|q\n",
    expected: {
      exitCode: 0,
      stdout: "4:a:b:c:d\n2:z:q::\n",
      stderr: "",
    },
  },
  {
    id: "rs-v-admission",
    options: ["-v", "RS=|"],
    program: "BEGIN{print length(RS)}{print $0}",
    stdin: "a|b|",
    expected: {
      exitCode: 0,
      stdout: "1\na\nb\n",
      stderr: "",
    },
  },
  {
    id: "rs-dynamic-future-records",
    program: 'BEGIN{RS="|"}{printf "[%s]\\n",$0;RS=","}',
    stdin: "a|b,c,d",
    expected: {
      exitCode: 0,
      stdout: "[a]\n[b]\n[c]\n[d]\n",
      stderr: "",
    },
  },
  {
    id: "rs-multiple-files-fnr",
    program: 'BEGIN{RS="|"}{print $0,NR,FNR}',
    args: ["one.txt", "two.txt"],
    files: {
      "one.txt": "a|b|",
      "two.txt": "c|d",
    },
    stdin: "",
    expected: {
      exitCode: 0,
      stdout: "a 1 1\nb 2 2\nc 3 1\nd 4 2\n",
      stderr: "",
    },
  },
  {
    id: "getline-var-shares-rs-cursor",
    program:
      'BEGIN{RS="|";r=getline v;print r,v,NR,FNR,NF}{print "row",$0,NR,FNR}',
    stdin: "a|b|c|",
    expected: {
      exitCode: 0,
      stdout: "1 a 1 1 0\nrow b 2 2\nrow c 3 3\n",
      stderr: "",
    },
  },
  {
    id: "getline-var-keeps-current-record",
    program:
      'BEGIN{RS="|"}{print "current",$0,NR,FNR;if(NR==1){r=getline v;print "var",r,v,$0,NR,FNR,NF}}',
    stdin: "a|b|c|",
    expected: {
      exitCode: 0,
      stdout: "current a 1 1\nvar 1 b a 2 2 1\ncurrent c 3 3\n",
      stderr: "",
    },
  },
  {
    id: "getline-no-var-replaces-current-record",
    program:
      'BEGIN{RS="|"}{print "before",$0,NR,FNR;if(NR==1){r=getline;print "read",r,$0,NF,NR,FNR}}',
    stdin: "a|b|c|",
    expected: {
      exitCode: 0,
      stdout: "before a 1 1\nread 1 b 1 2 2\nbefore c 3 3\n",
      stderr: "",
    },
  },
  {
    id: "getline-redirect-var-no-counters",
    program:
      'BEGIN{RS="|";while((getline v < "side.txt")>0) print v,NR,FNR,NF;close("side.txt");print (getline v < "side.txt"),v,NR,FNR}',
    files: {
      "side.txt": "a|b|",
    },
    stdin: "",
    expected: {
      exitCode: 0,
      stdout: "a 0 0 0\nb 0 0 0\n1 a 0 0\n",
      stderr: "",
    },
  },
  {
    id: "getline-redirect-no-var-fields-only",
    program: 'BEGIN{RS="|";while((getline < "side.txt")>0) print $0,NF,NR,FNR}',
    files: {
      "side.txt": "a b|c|",
    },
    stdin: "",
    expected: {
      exitCode: 0,
      stdout: "a b 2 0 0\nc 1 0 0\n",
      stderr: "",
    },
  },
  {
    id: "getline-rs-change",
    program:
      'BEGIN{RS="|";getline a;RS=",";getline b;print a,b,NR,FNR}{print "row",$0,NR,FNR}',
    stdin: "a|b,c",
    expected: {
      exitCode: 0,
      stdout: "a b 2 2\nrow c 3 3\n",
      stderr: "",
    },
  },
];

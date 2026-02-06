"use client";

import { useEffect, useState } from "react";
import TerminalComponent from "./components/Terminal";
import { TerminalData } from "./components/TerminalData";

const NOSCRIPT_CONTENT = `
     _           _       _               _
    (_)_   _ ___| |_    | |__   __ _ ___| |__
    | | | | / __| __|   | '_ \\ / _\` / __| '_ \\
    | | |_| \\__ \\ |_ _  | |_) | (_| \\__ \\ | | |
   _/ |\\__,_|___/\\__( ) |_.__/ \\__,_|___/_| |_|
  |__/              |/

  just-bash

  A simulated bash environment with an in-memory virtual filesystem.
  Designed for AI agents needing a secure, sandboxed bash environment.

  FEATURES
  --------

  - Pure TypeScript implementation
  - In-memory virtual filesystem
  - Secure sandboxed execution
  - Network access with URL filtering
  - Vercel Sandbox compatible API

  INSTALLATION
  ------------

  npm install just-bash

  BASIC USAGE
  -----------

  import { Bash } from "just-bash";

  const env = new Bash();
  await env.exec('echo "Hello" > greeting.txt');
  const result = await env.exec("cat greeting.txt");
  console.log(result.stdout); // "Hello\\n"

  SUPPORTED COMMANDS
  ------------------

  File Operations:
    cat, cp, file, ln, ls, mkdir, mv, readlink, rm, rmdir,
    split, stat, touch, tree

  Text Processing:
    awk, base64, column, comm, cut, diff, expand, fold, grep,
    head, join, md5sum, nl, od, paste, printf, rev, rg, sed,
    sha1sum, sha256sum, sort, strings, tac, tail, tr, unexpand,
    uniq, wc, xargs

  Data Processing:
    jq (JSON), python3 (Pyodide), sqlite3, xan (CSV), yq (YAML)

  Navigation & Environment:
    basename, cd, dirname, du, echo, env, export, find,
    hostname, printenv, pwd, tee

  Shell Utilities:
    alias, bash, chmod, clear, date, expr, false, help, history,
    seq, sh, sleep, time, timeout, true, unalias, which, whoami

  SHELL FEATURES
  --------------

  - Pipes: cmd1 | cmd2
  - Redirections: >, >>, 2>, 2>&1, <
  - Chaining: &&, ||, ;
  - Variables: $VAR, \${VAR}, \${VAR:-default}
  - Globs: *, ?, [...]
  - If statements: if/then/elif/else/fi
  - Functions: function name { ... }
  - Loops: for, while, until
  - Arithmetic: $((expr)), (( expr ))
  - Tests: [[ ]], [ ]

  LINKS
  -----

  GitHub: https://github.com/vercel-labs/just-bash
  npm: https://www.npmjs.com/package/just-bash

  License: Apache-2.0
  Author: Malte and Claude

  ---
  Enable JavaScript for an interactive terminal experience.
`;

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <noscript>
        <pre>{NOSCRIPT_CONTENT}</pre>
      </noscript>
      <TerminalData />
      {mounted ? <TerminalComponent /> : null}
      <a href="https://vercel.com" target="_blank" hidden id="credits">
        Created by Vercel Labs
      </a>
    </>
  );
}

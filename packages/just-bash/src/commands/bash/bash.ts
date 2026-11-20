import { decodeBytesToUtf8, latin1FromBytes } from "../../encoding.js";
import { mergeToNullPrototype } from "../../helpers/env.js";
import { BASH_VERSION } from "../../shell-metadata.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { showHelp } from "../help.js";

/**
 * Bash's own first line, with just-bash where bash names the machine, so a
 * script or a reader checking the version sees the bash release whose syntax
 * the shell follows ($BASH_VERSION) and that it is not GNU bash.
 */
const VERSION_TEXT = `GNU bash, version ${BASH_VERSION} (just-bash)
This is just-bash, a bash interpreter written in TypeScript, not GNU bash.
`;

const bashHelp = {
  name: "bash",
  summary: "execute shell commands or scripts",
  usage: "bash [OPTIONS] [SCRIPT_FILE] [ARGUMENTS...]",
  options: [
    "-c          read commands from the first argument",
    "-s          read commands from standard input",
    "-euxvfCan   set the shell option, as `set` does (+ turns it off)",
    "-o OPTION   set -o OPTION (+o turns it off)",
    "-O OPTION   shopt -s OPTION (+O: shopt -u)",
    "-l, -i      accepted and ignored (no profile, no terminal)",
    "    --help  display this help and exit",
    "    --version  show the bash version the shell follows and exit",
  ],
  notes: [
    "Without -c or -s, reads and executes commands from SCRIPT_FILE.",
    "Arguments are passed as $1, $2, etc. to the script.",
    '$0 is set to the script name (or "bash" with -c).',
  ],
};

export const bashCommand: RuntimeCommand = {
  name: "bash",

  execute(args: string[], ctx: RuntimeCommandContext): Promise<ExecResult> {
    return runShell("bash", args, ctx);
  },
};

// sh is an alias for bash
export const shCommand: RuntimeCommand = {
  name: "sh",

  execute(args: string[], ctx: RuntimeCommandContext): Promise<ExecResult> {
    return runShell("sh", args, ctx);
  },
};

/** Single-letter options `set` takes, passed to it as given. */
const SET_FLAGS = "abefhmnpuvxBCEHPT";
/**
 * `-l` (login: read profile files) and `-i` (interactive) change nothing for
 * a shell that has no profile files and no terminal, so they are accepted and
 * ignored rather than refused.
 */
const IGNORED_FLAGS = "il";
const IGNORED_LONG_OPTIONS = new Set([
  "--login",
  "--noediting",
  "--noprofile",
  "--norc",
]);
const LONG_OPTIONS_WITH_VALUE = new Set(["--init-file", "--rcfile"]);
const OPTION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

interface Invocation {
  /** `-c`: the first operand is the script, the second `$0`. */
  command: boolean;
  /** `-s`: the script is stdin, and every operand a positional parameter. */
  stdin: boolean;
  /** Commands that apply the options before the script runs. */
  setup: string[];
  operands: string[];
}

/**
 * Read options as bash does: every word up to the first operand, `--` or `-`
 * that starts with `-` or `+` is an option, single letters may be combined
 * (`-lc`, `-euo pipefail`), and `-c` is a flag rather than an option taking
 * the script, so `bash -c -e 'cmd'` works too.
 */
function parseInvocation(
  shell: string,
  args: string[],
): Invocation | ExecResult {
  const invocation: Invocation = {
    command: false,
    stdin: false,
    setup: [],
    operands: [],
  };
  const setArgs: string[] = [];
  const usageError = (message: string): ExecResult => ({
    stdout: "",
    stderr: `${shell}: ${message}\n`,
    exitCode: 2,
  });

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--" || arg === "-") {
      i++;
      break;
    }
    if (arg.startsWith("--")) {
      i++;
      if (arg === "--help") {
        return showHelp(
          shell === "sh"
            ? {
                ...bashHelp,
                name: "sh",
                summary: "execute shell commands or scripts (POSIX shell)",
              }
            : bashHelp,
        );
      }
      if (arg === "--version") {
        return { stdout: VERSION_TEXT, stderr: "", exitCode: 0 };
      }
      if (arg === "--posix") {
        setArgs.push("-o", "posix");
      } else if (arg === "--verbose") {
        setArgs.push("-v");
      } else if (LONG_OPTIONS_WITH_VALUE.has(arg)) {
        if (i >= args.length) {
          return usageError(`${arg}: option requires an argument`);
        }
        i++;
      } else if (!IGNORED_LONG_OPTIONS.has(arg)) {
        return usageError(`${arg}: invalid option`);
      }
      continue;
    }
    if (arg.length < 2 || (arg[0] !== "-" && arg[0] !== "+")) {
      break;
    }
    const sign = arg[0];
    i++;
    for (const flag of arg.slice(1)) {
      if (flag === "c") {
        invocation.command ||= sign === "-";
      } else if (flag === "s") {
        invocation.stdin ||= sign === "-";
      } else if (IGNORED_FLAGS.includes(flag)) {
        // accepted, see IGNORED_FLAGS
      } else if (flag === "o" || flag === "O") {
        const name = args[i];
        if (name === undefined) {
          return usageError(`${sign}${flag}: option requires an argument`);
        }
        i++;
        if (!OPTION_NAME.test(name)) {
          return usageError(`${name}: invalid option name`);
        }
        if (flag === "o") {
          setArgs.push(`${sign}o`, name);
        } else {
          invocation.setup.push(`shopt ${sign === "-" ? "-s" : "-u"} ${name}`);
        }
      } else if (SET_FLAGS.includes(flag)) {
        setArgs.push(`${sign}${flag}`);
      } else {
        return usageError(`${sign}${flag}: invalid option`);
      }
    }
  }
  invocation.operands = args.slice(i);
  // `set` goes last, so `-x` does not trace the setup before it.
  if (setArgs.length > 0) {
    invocation.setup.push(`set ${setArgs.join(" ")}`);
  }
  if (invocation.command && invocation.operands.length === 0) {
    return usageError("-c: option requires an argument");
  }
  return invocation;
}

async function runShell(
  shell: string,
  args: string[],
  ctx: RuntimeCommandContext,
): Promise<ExecResult> {
  const parsed = parseInvocation(shell, args);
  if (!("operands" in parsed)) {
    return parsed;
  }
  const { command, operands, setup, stdin } = parsed;

  // With -c: bash -c 'command' arg0 arg1 arg2
  // arg0 becomes $0, arg1 becomes $1, arg2 becomes $2
  if (command) {
    return executeScript(
      operands[0],
      operands[1] ?? shell,
      operands.slice(2),
      ctx,
      setup,
      `${shell}: -c`,
    );
  }

  // No script file - read the script from stdin if available. Decode bytes —
  // a script's UTF-8 string literals must reach the parser as text.
  if (stdin || operands.length === 0) {
    const stdinText = decodeBytesToUtf8(ctx.stdin);
    if (stdinText.trim()) {
      return executeScript(stdinText, shell, operands, ctx, setup, shell);
    }
    // No stdin - interactive mode is not supported, but the options still
    // apply, so one set or shopt refuses still ends the shell with status 2.
    if (setup.length > 0) {
      return executeScript("", shell, operands, ctx, setup, shell);
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  // Read and execute script file
  const scriptPath = operands[0];
  const scriptArgs = operands.slice(1);

  try {
    const fullPath = ctx.fs.resolvePath(ctx.cwd, scriptPath);
    const scriptContent = await ctx.fs.readFile(fullPath);
    return executeScript(
      scriptContent,
      scriptPath,
      scriptArgs,
      ctx,
      setup,
      scriptPath,
    );
  } catch {
    return {
      stdout: "",
      stderr: `${shell}: ${scriptPath}: No such file or directory\n`,
      exitCode: 127,
    };
  }
}

async function executeScript(
  script: string,
  scriptName: string,
  scriptArgs: string[],
  ctx: RuntimeCommandContext,
  setup: string[],
  /** What a syntax error is reported under: `bash: -c`, the script's path. */
  reportAs: string,
): Promise<ExecResult> {
  if (!ctx.exec) {
    return {
      stdout: "",
      stderr: "bash: internal error: exec function not available\n",
      exitCode: 1,
    };
  }

  // The nested shell is a new process: its environment is the parent's
  // exported variables (including prefix assignments like
  // "FOO=bar sh -c '...'"), plus the positional parameters. The exec entry
  // initializes the shell's own variables (IFS, OPTIND, ...) on top.
  // Use null-prototype object to prevent prototype pollution
  const positionalEnv = mergeToNullPrototype(
    ctx.exportedEnv ?? Object.create(null),
    {
      "0": scriptName,
      "#": String(scriptArgs.length),
      "@": scriptArgs.join(" "),
      "*": scriptArgs.join(" "),
    },
  ) as Record<string, string>;
  scriptArgs.forEach((arg, i) => {
    positionalEnv[String(i + 1)] = arg;
  });

  // Skip shebang line if present, keeping its newline so $LINENO and a
  // syntax error's line count from the file's first line.
  let scriptToRun = script;
  if (scriptToRun.startsWith("#!")) {
    const firstNewline = scriptToRun.indexOf("\n");
    if (firstNewline !== -1) {
      scriptToRun = scriptToRun.slice(firstNewline);
    }
  }

  // Options given on the command line run as `set`/`shopt` ahead of the
  // script, on its first line so $LINENO still counts the script's own lines.
  // An option `set` or `shopt` refuses ends the shell with status 2, as bash
  // does, before any of the script runs. Each word is a flag or a name
  // `parseInvocation` checked, so nothing here needs quoting.
  if (setup.length > 0) {
    scriptToRun = `${setup.map((line) => `${line} || exit 2; `).join("")}${scriptToRun}`;
  }

  // Execute the script as-is, preserving newlines for proper parsing
  // The parser needs to see the original structure to correctly handle
  // multi-line constructs like (( ... )) vs ( ( ... ) )
  // Forward our already-byte-shaped stdin verbatim — `stdinKind: "bytes"`
  // tells the nested exec entry to skip the default text-mode UTF-8
  // encoding and avoid double-encoding.
  const nestedExec = ctx.execWithInheritedStdin;
  const result = nestedExec
    ? await nestedExec(scriptToRun, {
        env: positionalEnv,
        newShell: true,
        cwd: ctx.cwd,
        signal: ctx.signal,
        scriptName: reportAs,
      })
    : await ctx.exec(scriptToRun, {
        env: positionalEnv,
        newShell: true,
        cwd: ctx.cwd,
        stdin: latin1FromBytes(ctx.stdin),
        stdinKind: "bytes",
        signal: ctx.signal,
        scriptName: reportAs,
      });
  return result;
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "bash",
  flags: [{ flag: "-c", type: "value", valueHint: "string" }],
  stdinType: "text",
};

export const shFlagsForFuzzing: CommandFuzzInfo = {
  name: "sh",
  flags: [{ flag: "-c", type: "value", valueHint: "string" }],
  stdinType: "text",
};

// Command registry with statically analyzable lazy loading
// Each command has an explicit loader function for bundler compatibility (Next.js, etc.)

import type { Command, CommandContext, ExecResult } from "../types.js";

type CommandLoader = () => Promise<Command>;

interface LazyCommandDef<T extends string = string> {
  name: T;
  load: CommandLoader;
}

/** All available built-in command names (excludes network commands) */
export type CommandName =
  | "echo"
  | "cat"
  | "printf"
  | "ls"
  | "mkdir"
  | "rmdir"
  | "touch"
  | "rm"
  | "cp"
  | "mv"
  | "ln"
  | "chmod"
  | "pwd"
  | "readlink"
  | "head"
  | "tail"
  | "wc"
  | "stat"
  | "grep"
  | "fgrep"
  | "egrep"
  | "rg"
  | "sed"
  | "awk"
  | "sort"
  | "uniq"
  | "comm"
  | "cut"
  | "paste"
  | "tr"
  | "rev"
  | "nl"
  | "fold"
  | "expand"
  | "unexpand"
  | "strings"
  | "split"
  | "column"
  | "join"
  | "tee"
  | "find"
  | "basename"
  | "dirname"
  | "tree"
  | "du"
  | "env"
  | "printenv"
  | "alias"
  | "unalias"
  | "history"
  | "xargs"
  | "true"
  | "false"
  | "clear"
  | "bash"
  | "sh"
  | "jq"
  | "base64"
  | "diff"
  | "date"
  | "sleep"
  | "timeout"
  | "seq"
  | "expr"
  | "md5sum"
  | "sha1sum"
  | "sha256sum"
  | "file"
  | "html-to-markdown"
  | "help"
  | "which"
  | "tac"
  | "hostname"
  | "od"
  | "gzip"
  | "gunzip"
  | "zcat"
  | "tar"
  | "yq"
  | "xan"
  | "sqlite3"
  | "time"
  | "whoami"
  | "python3"
  | "python";

/** Network command names (only available when network is configured) */
export type NetworkCommandName = "curl";

/** All command names including network commands */
export type AllCommandName = CommandName | NetworkCommandName;

// Statically analyzable loaders - each import() call is a literal string
const commandLoaders: LazyCommandDef<CommandName>[] = [
  // Basic I/O
  {
    name: "echo",
    load: async () => (await import("./echo/echo.js")).echoCommand,
  },
  {
    name: "cat",
    load: async () => (await import("./cat/cat.js")).catCommand,
  },
  {
    name: "printf",
    load: async () => (await import("./printf/printf.js")).printfCommand,
  },

  // File operations
  {
    name: "ls",
    load: async () => (await import("./ls/ls.js")).lsCommand,
  },
  {
    name: "mkdir",
    load: async () => (await import("./mkdir/mkdir.js")).mkdirCommand,
  },
  {
    name: "rmdir",
    load: async () => (await import("./rmdir/rmdir.js")).rmdirCommand,
  },
  {
    name: "touch",
    load: async () => (await import("./touch/touch.js")).touchCommand,
  },
  {
    name: "rm",
    load: async () => (await import("./rm/rm.js")).rmCommand,
  },
  {
    name: "cp",
    load: async () => (await import("./cp/cp.js")).cpCommand,
  },
  {
    name: "mv",
    load: async () => (await import("./mv/mv.js")).mvCommand,
  },
  {
    name: "ln",
    load: async () => (await import("./ln/ln.js")).lnCommand,
  },
  {
    name: "chmod",
    load: async () => (await import("./chmod/chmod.js")).chmodCommand,
  },

  // Navigation
  {
    name: "pwd",
    load: async () => (await import("./pwd/pwd.js")).pwdCommand,
  },
  {
    name: "readlink",
    load: async () => (await import("./readlink/readlink.js")).readlinkCommand,
  },

  // File viewing
  {
    name: "head",
    load: async () => (await import("./head/head.js")).headCommand,
  },
  {
    name: "tail",
    load: async () => (await import("./tail/tail.js")).tailCommand,
  },
  {
    name: "wc",
    load: async () => (await import("./wc/wc.js")).wcCommand,
  },
  {
    name: "stat",
    load: async () => (await import("./stat/stat.js")).statCommand,
  },

  // Text processing
  {
    name: "grep",
    load: async () => (await import("./grep/grep.js")).grepCommand,
  },
  {
    name: "fgrep",
    load: async () => (await import("./grep/grep.js")).fgrepCommand,
  },
  {
    name: "egrep",
    load: async () => (await import("./grep/grep.js")).egrepCommand,
  },
  {
    name: "rg",
    load: async () => (await import("./rg/rg.js")).rgCommand,
  },
  {
    name: "sed",
    load: async () => (await import("./sed/sed.js")).sedCommand,
  },
  {
    name: "awk",
    load: async () => (await import("./awk/awk2.js")).awkCommand2,
  },
  {
    name: "sort",
    load: async () => (await import("./sort/sort.js")).sortCommand,
  },
  {
    name: "uniq",
    load: async () => (await import("./uniq/uniq.js")).uniqCommand,
  },
  {
    name: "comm",
    load: async () => (await import("./comm/comm.js")).commCommand,
  },
  {
    name: "cut",
    load: async () => (await import("./cut/cut.js")).cutCommand,
  },
  {
    name: "paste",
    load: async () => (await import("./paste/paste.js")).pasteCommand,
  },
  {
    name: "tr",
    load: async () => (await import("./tr/tr.js")).trCommand,
  },
  {
    name: "rev",
    load: async () => (await import("./rev/rev.js")).rev,
  },
  {
    name: "nl",
    load: async () => (await import("./nl/nl.js")).nl,
  },
  {
    name: "fold",
    load: async () => (await import("./fold/fold.js")).fold,
  },
  {
    name: "expand",
    load: async () => (await import("./expand/expand.js")).expand,
  },
  {
    name: "unexpand",
    load: async () => (await import("./expand/unexpand.js")).unexpand,
  },
  {
    name: "strings",
    load: async () => (await import("./strings/strings.js")).strings,
  },
  {
    name: "split",
    load: async () => (await import("./split/split.js")).split,
  },
  {
    name: "column",
    load: async () => (await import("./column/column.js")).column,
  },
  {
    name: "join",
    load: async () => (await import("./join/join.js")).join,
  },
  {
    name: "tee",
    load: async () => (await import("./tee/tee.js")).teeCommand,
  },

  // Search
  {
    name: "find",
    load: async () => (await import("./find/find.js")).findCommand,
  },

  // Path utilities
  {
    name: "basename",
    load: async () => (await import("./basename/basename.js")).basenameCommand,
  },
  {
    name: "dirname",
    load: async () => (await import("./dirname/dirname.js")).dirnameCommand,
  },

  // Directory utilities
  {
    name: "tree",
    load: async () => (await import("./tree/tree.js")).treeCommand,
  },
  {
    name: "du",
    load: async () => (await import("./du/du.js")).duCommand,
  },

  // Environment
  {
    name: "env",
    load: async () => (await import("./env/env.js")).envCommand,
  },
  {
    name: "printenv",
    load: async () => (await import("./env/env.js")).printenvCommand,
  },
  {
    name: "alias",
    load: async () => (await import("./alias/alias.js")).aliasCommand,
  },
  {
    name: "unalias",
    load: async () => (await import("./alias/alias.js")).unaliasCommand,
  },
  {
    name: "history",
    load: async () => (await import("./history/history.js")).historyCommand,
  },

  // Utilities
  {
    name: "xargs",
    load: async () => (await import("./xargs/xargs.js")).xargsCommand,
  },
  {
    name: "true",
    load: async () => (await import("./true/true.js")).trueCommand,
  },
  {
    name: "false",
    load: async () => (await import("./true/true.js")).falseCommand,
  },
  {
    name: "clear",
    load: async () => (await import("./clear/clear.js")).clearCommand,
  },

  // Shell
  {
    name: "bash",
    load: async () => (await import("./bash/bash.js")).bashCommand,
  },
  {
    name: "sh",
    load: async () => (await import("./bash/bash.js")).shCommand,
  },

  // Data processing
  {
    name: "jq",
    load: async () => (await import("./jq/jq.js")).jqCommand,
  },
  {
    name: "base64",
    load: async () => (await import("./base64/base64.js")).base64Command,
  },
  {
    name: "diff",
    load: async () => (await import("./diff/diff.js")).diffCommand,
  },
  {
    name: "date",
    load: async () => (await import("./date/date.js")).dateCommand,
  },
  {
    name: "sleep",
    load: async () => (await import("./sleep/sleep.js")).sleepCommand,
  },
  {
    name: "timeout",
    load: async () => (await import("./timeout/timeout.js")).timeoutCommand,
  },
  {
    name: "time",
    load: async () => (await import("./time/time.js")).timeCommand,
  },
  {
    name: "seq",
    load: async () => (await import("./seq/seq.js")).seqCommand,
  },
  {
    name: "expr",
    load: async () => (await import("./expr/expr.js")).exprCommand,
  },

  // Checksums
  {
    name: "md5sum",
    load: async () => (await import("./md5sum/md5sum.js")).md5sumCommand,
  },
  {
    name: "sha1sum",
    load: async () => (await import("./md5sum/sha1sum.js")).sha1sumCommand,
  },
  {
    name: "sha256sum",
    load: async () => (await import("./md5sum/sha256sum.js")).sha256sumCommand,
  },

  // File type detection
  {
    name: "file",
    load: async () => (await import("./file/file.js")).fileCommand,
  },

  // HTML processing
  {
    name: "html-to-markdown",
    load: async () =>
      (await import("./html-to-markdown/html-to-markdown.js"))
        .htmlToMarkdownCommand,
  },

  // Help
  {
    name: "help",
    load: async () => (await import("./help/help.js")).helpCommand,
  },

  // PATH utilities
  {
    name: "which",
    load: async () => (await import("./which/which.js")).whichCommand,
  },

  // Misc utilities
  {
    name: "tac",
    load: async () => (await import("./tac/tac.js")).tac,
  },
  {
    name: "hostname",
    load: async () => (await import("./hostname/hostname.js")).hostname,
  },
  {
    name: "whoami",
    load: async () => (await import("./whoami/whoami.js")).whoami,
  },
  {
    name: "od",
    load: async () => (await import("./od/od.js")).od,
  },

  // Compression
  {
    name: "gzip",
    load: async () => (await import("./gzip/gzip.js")).gzipCommand,
  },
  {
    name: "gunzip",
    load: async () => (await import("./gzip/gzip.js")).gunzipCommand,
  },
  {
    name: "zcat",
    load: async () => (await import("./gzip/gzip.js")).zcatCommand,
  },
];

// tar, yq, xan, and sqlite3 don't work in browsers
// __BROWSER__ is defined by esbuild at build time for browser bundles
declare const __BROWSER__: boolean | undefined;
if (typeof __BROWSER__ === "undefined" || !__BROWSER__) {
  commandLoaders.push({
    name: "tar" as CommandName,
    load: async () => (await import("./tar/tar.js")).tarCommand,
  });
  commandLoaders.push({
    name: "yq" as CommandName,
    load: async () => (await import("./yq/yq.js")).yqCommand,
  });
  commandLoaders.push({
    name: "xan" as CommandName,
    load: async () => (await import("./xan/xan.js")).xanCommand,
  });
  commandLoaders.push({
    name: "sqlite3" as CommandName,
    load: async () => (await import("./sqlite3/sqlite3.js")).sqlite3Command,
  });
  commandLoaders.push({
    name: "python3" as CommandName,
    load: async () => (await import("./python3/python3.js")).python3Command,
  });
  commandLoaders.push({
    name: "python" as CommandName,
    load: async () => (await import("./python3/python3.js")).pythonCommand,
  });
}

// Network commands - only registered when network is configured
const networkCommandLoaders: LazyCommandDef<NetworkCommandName>[] = [
  {
    name: "curl",
    load: async () => (await import("./curl/curl.js")).curlCommand,
  },
];

// Cache for loaded commands
const cache = new Map<string, Command>();

/**
 * Creates a lazy command that loads on first execution
 */
function createLazyCommand(def: LazyCommandDef): Command {
  return {
    name: def.name,
    async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
      let cmd = cache.get(def.name);

      if (!cmd) {
        cmd = await def.load();
        cache.set(def.name, cmd);
      }

      return cmd.execute(args, ctx);
    },
  };
}

/**
 * Gets all available command names (excludes network commands)
 */
export function getCommandNames(): string[] {
  return commandLoaders.map((def) => def.name);
}

/**
 * Gets all network command names
 */
export function getNetworkCommandNames(): string[] {
  return networkCommandLoaders.map((def) => def.name);
}

/**
 * Creates all lazy commands for registration (excludes network commands)
 * @param filter Optional array of command names to include. If not provided, all commands are created.
 */
export function createLazyCommands(filter?: CommandName[]): Command[] {
  const loaders = filter
    ? commandLoaders.filter((def) => filter.includes(def.name))
    : commandLoaders;
  return loaders.map(createLazyCommand);
}

/**
 * Creates network commands for registration (curl, etc.)
 * These are only registered when network is explicitly configured.
 */
export function createNetworkCommands(): Command[] {
  return networkCommandLoaders.map(createLazyCommand);
}

/**
 * Clears the command cache (for testing)
 */
export function clearCommandCache(): void {
  cache.clear();
}

/**
 * Gets the number of loaded commands (for testing)
 */
export function getLoadedCommandCount(): number {
  return cache.size;
}

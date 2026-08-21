import { createExclusiveOn } from "../../fs/create-exclusive.js";
import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";

/**
 * Version reported by `mktemp --version`. just-bash emulates the GNU coreutils
 * surface, so the number tracks the coreutils release the behaviour follows.
 */
const MKTEMP_VERSION = "mktemp (just-bash) 9.4\n";

/** GNU default template when none is given. */
const DEFAULT_TEMPLATE = "tmp.XXXXXXXXXX";

/** GNU requires at least this many trailing X characters. */
const MIN_X = 3;

/**
 * Bounded retries so a crowded directory cannot spin forever. This is a
 * runtime invariant of name generation (GNU mktemp caps attempts the same
 * way), not a resource ceiling callers should be able to tune: every attempt
 * is one existence check, and with 62^3 name space collisions are vanishing.
 */
// @banned-pattern-ignore: fixed collision-retry invariant, not a tunable resource ceiling
const MAX_ATTEMPTS = 100;

/** Characters GNU mktemp draws the random part from. */
const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Largest multiple of ALPHABET.length that fits in a byte (rejection sampling). */
const REJECT_AT = 256 - (256 % ALPHABET.length);

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const mktempHelp = {
  name: "mktemp",
  summary: "create a temporary file or directory and print its name",
  usage: "mktemp [OPTION]... [TEMPLATE]",
  description: [
    "Create a uniquely named temporary file (or directory with -d) and write",
    "its name to standard output. TEMPLATE must end in at least three 'X's,",
    "which are replaced with random characters; it defaults to tmp.XXXXXXXXXX.",
    "Without -p/-t/--tmpdir a bare TEMPLATE is relative to the current",
    "directory, while the default template is placed in $TMPDIR (or /tmp).",
    "Files are created with mode 0600 and directories with mode 0700.",
  ],
  options: [
    "-d, --directory        create a directory, not a file",
    "-u, --dry-run          do not create anything, merely print a name",
    "-q, --quiet            suppress diagnostics about creation failure",
    "    --suffix=SUFF      append SUFF to TEMPLATE (must not contain a slash)",
    "-p DIR, --tmpdir[=DIR] interpret TEMPLATE relative to DIR",
    "                       (defaults to $TMPDIR, or /tmp when unset)",
    "-t                     interpret TEMPLATE as a single file name",
    "                       component, relative to the temporary directory",
    "-h, --help             display this help and exit",
    "    --version          output version information and exit",
  ],
  examples: [
    "mktemp",
    "mktemp -d",
    "mktemp /tmp/build-XXXXXX",
    "mktemp --suffix=.txt fileXXXXXX",
  ],
};

const argDefs = {
  directory: { short: "d", long: "directory", type: "boolean" as const },
  dryRun: { short: "u", long: "dry-run", type: "boolean" as const },
  quiet: { short: "q", long: "quiet", type: "boolean" as const },
  tmpdir: { short: "p", long: "tmpdir", type: "string" as const },
  legacyT: { short: "t", type: "boolean" as const },
  suffix: { long: "suffix", type: "string" as const },
};

/**
 * `--tmpdir` takes an optional argument, which the shared parser cannot
 * express: a bare `--tmpdir` means "use the default directory" and must not
 * swallow the following template. Rewrite it to `--tmpdir=` before parsing,
 * skipping tokens that are values of a preceding option.
 */
function normalizeTmpdirFlag(args: string[]): string[] {
  const out: string[] = [];
  let expectValue = false;
  let stopParsing = false;

  for (const arg of args) {
    if (stopParsing || expectValue) {
      out.push(arg);
      expectValue = false;
      continue;
    }
    if (arg === "--") {
      stopParsing = true;
      out.push(arg);
      continue;
    }
    if (arg === "--tmpdir") {
      out.push("--tmpdir=");
      continue;
    }
    // Long or short options whose value comes as the next argument.
    if (arg === "--suffix" || /^-[a-z]*p$/.test(arg)) {
      expectValue = true;
    }
    out.push(arg);
  }

  return out;
}

function randomChars(count: number): string {
  const bytes = new Uint8Array(count);
  let result = "";
  while (result.length < count) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= REJECT_AT) continue; // avoid modulo bias
      result += ALPHABET[byte % ALPHABET.length];
      if (result.length === count) break;
    }
  }
  return result;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function fail(message: string): ExecResult {
  return { stdout: "", stderr: `mktemp: ${message}\n`, exitCode: 1 };
}

interface TemplateParts {
  /** Template up to and including the final run of X characters. */
  stem: string;
  /** Number of trailing X characters in `stem`. */
  xCount: number;
  /** Text appended after the random characters. */
  suffix: string;
}

function splitTemplate(
  template: string,
  explicitSuffix: string | undefined,
): TemplateParts | ExecResult {
  let stem = template;
  let suffix = explicitSuffix ?? "";

  if (explicitSuffix === undefined) {
    const lastX = template.lastIndexOf("X");
    if (lastX !== -1) {
      stem = template.slice(0, lastX + 1);
      suffix = template.slice(lastX + 1);
    }
  } else if (!template.endsWith("X")) {
    return fail(`with --suffix, template '${template}' must end in X`);
  }

  if (suffix.includes("/")) {
    return fail(`invalid suffix '${suffix}', contains directory separator`);
  }

  let xCount = 0;
  while (xCount < stem.length && stem[stem.length - 1 - xCount] === "X") {
    xCount++;
  }
  if (xCount < MIN_X) {
    return fail(`too few X's in template '${template}'`);
  }

  return { stem, xCount, suffix };
}

/**
 * True when anything already occupies `path`. Uses lstat rather than exists()
 * so a symlink — including a dangling one, which exists() reports as absent —
 * counts as taken instead of being followed to its target.
 */
async function pathIsTaken(
  ctx: RuntimeCommandContext,
  path: string,
): Promise<boolean> {
  try {
    await ctx.fs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

function isExecResult(value: unknown): value is ExecResult {
  return typeof value === "object" && value !== null && "exitCode" in value;
}

export const mktempCommand: RuntimeCommand = {
  name: "mktemp",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    // `--` terminates options, so `mktemp -- --help` treats --help as a
    // template rather than printing help, as GNU option parsing requires.
    const terminator = args.indexOf("--");
    const optionArgs = terminator === -1 ? args : args.slice(0, terminator);

    if (hasHelpFlag(optionArgs) || optionArgs.includes("-h")) {
      return showHelp(mktempHelp);
    }
    if (optionArgs.includes("--version")) {
      return { stdout: MKTEMP_VERSION, stderr: "", exitCode: 0 };
    }

    const parsed = parseArgs("mktemp", normalizeTmpdirFlag(args), argDefs);
    if (!parsed.ok) return parsed.error;

    const { flags, positional } = parsed.result;
    if (positional.length > 1) {
      return fail("too many templates");
    }

    const template = positional.length === 1 ? positional[0] : DEFAULT_TEMPLATE;
    const parts = splitTemplate(template, flags.suffix);
    if (isExecResult(parts)) return parts;

    // Resolve the directory the entry is created in. A bare TEMPLATE without
    // -p/-t stays relative to the current directory, matching GNU mktemp.
    const envTmpdir = ctx.env.get("TMPDIR");
    const defaultTmpdir = envTmpdir ? envTmpdir : "/tmp";
    let destDir: string | null = null;

    if (flags.legacyT) {
      if (template.includes("/")) {
        return fail(
          `invalid template, '${template}', contains directory separator`,
        );
      }
      destDir = flags.tmpdir ? flags.tmpdir : defaultTmpdir;
    } else if (flags.tmpdir !== undefined || positional.length === 0) {
      if (template.startsWith("/")) {
        return fail(
          `invalid template, '${template}'; with --tmpdir, it may not be absolute`,
        );
      }
      destDir = flags.tmpdir ? flags.tmpdir : defaultTmpdir;
    }

    const kind = flags.directory ? "directory" : "file";
    const prefix =
      destDir === null ? parts.stem : joinPath(destDir, parts.stem);
    const base = prefix.slice(0, prefix.length - parts.xCount);

    const creationFailure = (reason: string): ExecResult => ({
      stdout: "",
      stderr: flags.quiet
        ? ""
        : `mktemp: failed to create ${kind} via template '${template}': ${reason}\n`,
      exitCode: 1,
    });

    // Some filesystems create missing parents on write; GNU mktemp does not,
    // so reject a destination directory that is missing up front. --dry-run
    // never touches the filesystem, so GNU still prints a candidate for a
    // missing directory and this check must not run.
    if (!flags.dryRun) {
      const slash = prefix.lastIndexOf("/");
      const parentDir = ctx.fs.resolvePath(
        ctx.cwd,
        slash === -1 ? "." : prefix.slice(0, slash) || "/",
      );
      try {
        const parentStat = await ctx.fs.stat(parentDir);
        if (!parentStat.isDirectory) {
          return creationFailure("Not a directory");
        }
      } catch {
        return creationFailure("No such file or directory");
      }
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const name = `${base}${randomChars(parts.xCount)}${parts.suffix}`;
      const fullPath = ctx.fs.resolvePath(ctx.cwd, name);

      try {
        if (flags.dryRun) {
          // -u reports a name without creating anything. Probe with lstat,
          // like gnulib's GT_NOCREATE path: a symlink occupying the name
          // counts as taken, where a following stat would see through it.
          if (await pathIsTaken(ctx, fullPath)) continue;
        } else {
          await createExclusiveOn(ctx.fs, fullPath, {
            mode: flags.directory ? DIR_MODE : FILE_MODE,
            directory: flags.directory,
          });
        }
      } catch (error) {
        const message = getErrorMessage(error);
        // Another entry appeared between the check and the create: retry.
        if (message.includes("EEXIST") || message.includes("already exists")) {
          continue;
        }
        return creationFailure(sanitizeErrorMessage(message));
      }

      return { stdout: `${name}\n`, stderr: "", exitCode: 0 };
    }

    return creationFailure("File exists");
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "mktemp",
  flags: [
    { flag: "-d", type: "boolean" },
    { flag: "-u", type: "boolean" },
    { flag: "-q", type: "boolean" },
    { flag: "-t", type: "boolean" },
    { flag: "-p", type: "value", valueHint: "path" },
    { flag: "--suffix", type: "value", valueHint: "string" },
  ],
  needsArgs: false,
};

import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const mktempHelp = {
  name: "mktemp",
  summary: "create a temporary file or directory and print its name",
  usage: "mktemp [OPTION]... [TEMPLATE]",
  description: [
    "TEMPLATE must end in at least three consecutive X's, which are replaced",
    "by random characters. With no TEMPLATE, tmp.XXXXXXXXXX is used.",
    "A TEMPLATE containing a slash names its own directory, so -p and -t",
    "do not apply to it.",
  ],
  options: [
    "-d, --directory        create a directory instead of a file",
    "-u, --dry-run          do not create anything, only print a name",
    "-q, --quiet            suppress diagnostics about creation failure",
    "-p DIR, --tmpdir[=DIR] place the result in DIR (default $TMPDIR, else /tmp)",
    "-t                     place TEMPLATE in the temporary directory",
    "    --help             display this help and exit",
  ],
  examples: ["mktemp", "mktemp -d", "mktemp -p /var/cache build.XXXXXX"],
  notes: ["Files are created with mode 0600 and directories with 0700."],
};

/** GNU's template when none is given. */
const DEFAULT_TEMPLATE = "tmp.XXXXXXXXXX";

/** The trailing run of X's, which is the part that gets replaced. */
const TRAILING_X = /X{3,}$/;

const SUFFIX_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** How many names to try before giving up, as GNU's TMP_MAX does. */
const MAX_ATTEMPTS = 32;

/** The private modes mktemp guarantees. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

interface MktempOptions {
  directory: boolean;
  dryRun: boolean;
  quiet: boolean;
  template: string;
}

export const mktempCommand: RuntimeCommand = {
  name: "mktemp",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(mktempHelp);
    }

    const parsed = parseArgs(args, ctx);
    if ("error" in parsed) {
      return parsed.error;
    }
    const { directory, dryRun, quiet, template } = parsed;

    const resolved = ctx.fs.resolvePath(ctx.cwd, template);
    const slash = resolved.lastIndexOf("/");
    const parent = resolved.slice(0, slash) || "/";
    const name = resolved.slice(slash + 1);

    // A malformed template is a usage error, not a creation failure, so -q
    // does not silence it. GNU prints this one either way.
    if (!TRAILING_X.test(name)) {
      return {
        stdout: "",
        stderr: `mktemp: too few X's in template '${template}'\n`,
        exitCode: 1,
      };
    }

    let lastError = "";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = `${parent}/${name.replace(TRAILING_X, (run) => randomSuffix(run.length))}`;
      if (dryRun) {
        return { stdout: `${candidate}\n`, stderr: "", exitCode: 0 };
      }
      try {
        await create(candidate, directory, ctx);
      } catch (error) {
        // A collision is the expected failure, and the loop is what handles
        // it. Any other error would also repeat, so it falls out of the loop
        // and is reported once the attempts are spent.
        lastError = getErrorMessage(error);
        continue;
      }
      return { stdout: `${candidate}\n`, stderr: "", exitCode: 0 };
    }

    const what = directory ? "directory" : "file";
    return {
      stdout: "",
      stderr: quiet
        ? ""
        : `mktemp: failed to create ${what} via template '${template}': ${lastError}\n`,
      exitCode: 1,
    };
  },
};

/**
 * `mkdir` without `recursive` already refuses an existing path, so the
 * directory case is exclusive on its own.
 *
 * The file case is not, and cannot be here: `writeFile` has no exclusive mode
 * and truncates whatever it finds, so between the `exists` check and the write
 * another writer on the same backing store could take the name. Nothing in
 * `IFileSystem` closes that today; an `exclusive` flag on `WriteFileOptions`
 * would, and is the follow-up. The same gap means the mode is set after
 * creation rather than at it, so the file is briefly 0644.
 */
async function create(
  path: string,
  directory: boolean,
  ctx: RuntimeCommandContext,
): Promise<void> {
  if (directory) {
    await ctx.fs.mkdir(path, { recursive: false });
    await ctx.fs.chmod(path, DIR_MODE);
    return;
  }
  if (await ctx.fs.exists(path)) {
    throw new Error(`file exists`);
  }
  await ctx.fs.writeFile(path, "");
  await ctx.fs.chmod(path, FILE_MODE);
}

/**
 * `-p` and `-t` only decide where a bare template goes, so the operand cannot
 * be resolved until every option has been read.
 */
function parseArgs(
  args: string[],
  ctx: RuntimeCommandContext,
): MktempOptions | { error: ExecResult } {
  let directory = false;
  let dryRun = false;
  let quiet = false;
  let useTmpDir = false;
  let tmpDir: string | undefined;
  const operands: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--") {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      operands.push(arg);
      continue;
    }
    if (arg.startsWith("--tmpdir=")) {
      tmpDir = arg.slice("--tmpdir=".length);
      useTmpDir = true;
      continue;
    }
    if (arg === "--directory") {
      directory = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--quiet") {
      quiet = true;
      continue;
    }
    if (arg === "--tmpdir") {
      useTmpDir = true;
      continue;
    }
    if (arg.startsWith("--")) {
      return { error: unknownOption("mktemp", arg) };
    }

    // `-p` takes a value and so ends the cluster, either inline (`-pDIR`,
    // `-dpDIR`) or as the next argument (`-p DIR`, `-dp DIR`).
    const valueAt = arg.indexOf("p");
    if (valueAt > 0) {
      const inline = arg.slice(valueAt + 1);
      if (inline) {
        tmpDir = inline;
      } else {
        if (i + 1 >= args.length) {
          return {
            error: {
              stdout: "",
              stderr: "mktemp: option requires an argument -- 'p'\n",
              exitCode: 1,
            },
          };
        }
        tmpDir = args[++i];
      }
      useTmpDir = true;
    }

    for (const flag of arg.slice(1, valueAt > 0 ? valueAt : undefined)) {
      if (flag === "d") {
        directory = true;
      } else if (flag === "u") {
        dryRun = true;
      } else if (flag === "q") {
        quiet = true;
      } else if (flag === "t") {
        useTmpDir = true;
      } else {
        return { error: unknownOption("mktemp", `-${flag}`) };
      }
    }
  }

  if (operands.length > 1) {
    return {
      error: {
        stdout: "",
        stderr: `mktemp: too many templates\n`,
        exitCode: 1,
      },
    };
  }

  // An empty value counts as unset, as it does in GNU: `TMPDIR= mktemp` and
  // `mktemp -p ''` both fall through rather than resolving against the root.
  const defaultDir = firstNonEmpty(tmpDir, ctx.env.get("TMPDIR"), "/tmp");
  const operand = operands[0];
  if (operand === undefined) {
    return {
      directory,
      dryRun,
      quiet,
      template: `${stripTrailingSlash(defaultDir)}/${DEFAULT_TEMPLATE}`,
    };
  }
  if (operand.includes("/")) {
    // A template naming its own directory is used as written; GNU errors on
    // this combined with --tmpdir, but accepting it is the friendlier read.
    return { directory, dryRun, quiet, template: operand };
  }
  const base = useTmpDir ? stripTrailingSlash(defaultDir) : ".";
  return { directory, dryRun, quiet, template: `${base}/${operand}` };
}

/**
 * Names have to be unpredictable, because the file case cannot create
 * exclusively: a caller who can guess the next candidate can take the name
 * between the check and the write. `crypto.getRandomValues` is available in
 * both Node and the browser, so this costs the command nothing.
 */
function randomSuffix(length: number): string {
  // 62 symbols do not divide 256, so bytes at or above the largest whole
  // multiple are drawn again rather than folded, which would make the first
  // eight symbols measurably more likely.
  const limit =
    SUFFIX_ALPHABET.length * Math.floor(256 / SUFFIX_ALPHABET.length);
  let suffix = "";
  while (suffix.length < length) {
    const bytes = new Uint8Array(length - suffix.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) {
        suffix += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length];
      }
    }
  }
  return suffix;
}

function firstNonEmpty(...values: (string | undefined)[]): string {
  return values.find((value) => value !== undefined && value !== "") ?? "/tmp";
}

function stripTrailingSlash(dir: string): string {
  return dir.length > 1 && dir.endsWith("/") ? dir.slice(0, -1) : dir;
}

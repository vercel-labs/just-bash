import { getErrorMessage } from "../../interpreter/helpers/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { unknownOption } from "../help.js";

/**
 * mktemp - create a temporary file or directory and print its name
 *
 * Usage:
 *   mktemp [OPTION]... [TEMPLATE]
 *
 * Options:
 *   -d, --directory  create a directory instead of a file
 *   -u, --dry-run    do not create anything, only print a name
 *   -q, --quiet      suppress diagnostics about failure
 *   -p DIR, --tmpdir[=DIR]  place the file in DIR (default $TMPDIR or /tmp)
 *   -t               place TEMPLATE in the temporary directory
 *
 * TEMPLATE must end in at least three consecutive X's, which are replaced.
 * A TEMPLATE containing a slash is used as written; -p and -t do not apply.
 */

/** GNU's template when none is given. */
const DEFAULT_TEMPLATE = "tmp.XXXXXXXXXX";

/** The trailing run of X's, which is the part that gets replaced. */
const TRAILING_X = /X{3,}$/;

const SUFFIX_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** How many names to try before giving up, as GNU's TMP_MAX does. */
const MAX_ATTEMPTS = 32;

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
    const parsed = parseArgs(args, ctx);
    if ("error" in parsed) {
      return parsed.error;
    }
    const { directory, dryRun, quiet, template } = parsed;

    const resolved = ctx.fs.resolvePath(ctx.cwd, template);
    const slash = resolved.lastIndexOf("/");
    const parent = resolved.slice(0, slash) || "/";
    const name = resolved.slice(slash + 1);

    if (!TRAILING_X.test(name)) {
      return fail(quiet, `mktemp: too few X's in template '${template}'\n`);
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = `${parent}/${name.replace(TRAILING_X, (run) => randomSuffix(run.length))}`;
      try {
        if (await ctx.fs.exists(candidate)) {
          continue;
        }
        if (!dryRun) {
          if (directory) {
            await ctx.fs.mkdir(candidate, { recursive: false });
          } else {
            await ctx.fs.writeFile(candidate, "");
          }
        }
      } catch (error) {
        return fail(
          quiet,
          `mktemp: failed to create ${directory ? "directory" : "file"} via template '${template}': ${getErrorMessage(error)}\n`,
        );
      }
      return { stdout: `${candidate}\n`, stderr: "", exitCode: 0 };
    }

    return fail(
      quiet,
      `mktemp: failed to find an unused name for template '${template}'\n`,
    );
  },
};

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

  const defaultDir = tmpDir ?? ctx.env.get("TMPDIR") ?? "/tmp";
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

function fail(quiet: boolean, message: string): ExecResult {
  return { stdout: "", stderr: quiet ? "" : message, exitCode: 1 };
}

/**
 * Names are unpredictable, not unguessable. The exclusivity guarantee comes
 * from creating the entry after checking it is free, which is where GNU's comes
 * from too; `$RANDOM` in the interpreter uses the same source.
 */
function randomSuffix(length: number): string {
  let suffix = "";
  for (let i = 0; i < length; i++) {
    suffix +=
      SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
  }
  return suffix;
}

function stripTrailingSlash(dir: string): string {
  return dir.length > 1 && dir.endsWith("/") ? dir.slice(0, -1) : dir;
}

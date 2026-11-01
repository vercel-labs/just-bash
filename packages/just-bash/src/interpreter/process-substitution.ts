import type { ResourceLease } from "../execution-scope.js";
import { setFdEntry } from "./fd-table.js";
import { beginIsolatedShellState } from "./state-transaction.js";
import { automaTrapChild } from "./traps.js";
/**
 * Process Substitution
 *
 * Implements bash's `<(cmd)` and `>(cmd)`.
 *
 * Real bash runs `cmd` asynchronously connected to a pipe and substitutes the
 * pipe's path (`/dev/fd/N`, or a FIFO on systems without `/dev/fd`). There are
 * no processes or pipes here, so the construct is modelled with the same
 * building blocks the rest of the interpreter uses for fds: a backing file in
 * the VFS under `/dev/fd/`, whose contents are produced (or consumed) by
 * running the body as a subshell.
 *
 * - `<(cmd)` runs `cmd` eagerly during word expansion, writes its stdout to
 *   the backing file, and substitutes that path. Because the body is fully
 *   buffered, a body that never terminates on its own (e.g. `yes`) is bounded
 *   by the ordinary execution limits rather than by the reader closing the
 *   pipe.
 * - `>(cmd)` substitutes an empty writable backing file. Once the command that
 *   consumed the path has finished, whatever was written to the file is fed to
 *   `cmd` as stdin and `cmd`'s output is appended to the result — the closest
 *   deterministic analogue of bash's asynchronous writer.
 *
 * Backing files live only for the duration of the command whose expansion
 * created them: {@link markProcessSubstitutions} / {@link releaseProcessSubstitutions}
 * bracket every command execution, so fd numbers are reused (63, 62, … just
 * like bash) and nothing accumulates in the VFS across commands.
 */

import type { ProcessSubstitutionPart, ScriptNode } from "../ast/types.js";
import {
  latin1FromBytes,
  readBytesFrom,
  stdoutAsBytes,
  utf8ByteLength,
} from "../encoding.js";
import { ExecutionOutputAccumulator } from "../execution-output.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";
import type {
  BufferEncoding,
  FileContent,
  IFileSystem,
  MkdirOptions,
  RmOptions,
  WriteFileOptions,
} from "../fs/interface.js";
import { MountableFs } from "../fs/mountable-fs/index.js";
import { _Proxy } from "../security/trusted-globals.js";
import type { ExecResult } from "../types.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
  ExitError,
} from "./errors.js";
import { cloneArrays } from "./helpers/array.js";
import type { InterpreterContext } from "./types.js";

/**
 * Directory holding the synthetic descriptor files. Matches the Linux path
 * bash substitutes, so scripts that echo the substituted word (or test it with
 * `[ -r ... ]`) see what they would see on a real system.
 */
const PROC_SUB_DIR = "/dev/fd";

/**
 * First descriptor number handed out, counting down. bash uses 63 for the
 * first process substitution of a command, 62 for the second, and so on.
 */
const FIRST_FD = 63;

/**
 * Lowest descriptor number handed out. bash's high fds stop well above the
 * shell's own 0-9 range; capping here bounds how many bodies a single command
 * can buffer at once.
 */
const LOWEST_FD = 10;

/** Maximum number of process substitutions live at the same time. */
const MAX_LIVE = FIRST_FD - LOWEST_FD + 1;

/**
 * The filesystem mounted at `/dev/fd` for sandboxes that refuse writes.
 *
 * Mounting a plain `InMemoryFs` would hand a script exactly the scratch space
 * the read-only contract denies it: after any process substitution,
 * `echo data > /dev/fd/anything` would start succeeding. Nothing reaches the
 * host either way, but it is a policy widening a script can observe and use.
 *
 * So the hole is narrowed to what the feature actually needs. Only the
 * descriptors the interpreter currently has allocated are writable; every
 * other path under `/dev/fd` gets the same `EROFS` the base filesystem would
 * have produced. Reads are untouched — they are already allowed on the
 * read-only base — and directory-shaped mutations are refused outright,
 * because process substitution never performs them.
 */
class ProcessSubstitutionFs extends InMemoryFs {
  private readonly isLiveDescriptor: (relativePath: string) => boolean;

  constructor(isLiveDescriptor: (relativePath: string) => boolean) {
    super();
    this.isLiveDescriptor = isLiveDescriptor;
  }

  /** Refuse anything that is not a live descriptor's backing file. */
  private assertLiveDescriptor(path: string, operation: string): void {
    if (this.isLiveDescriptor(path)) return;
    this.refuse(path, operation);
  }

  private refuse(path: string, operation: string): never {
    throw new Error(
      `EROFS: read-only file system, ${operation} '${PROC_SUB_DIR}${path}'`,
    );
  }

  override async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    this.assertLiveDescriptor(path, "write");
    return super.writeFile(path, content, options);
  }

  override async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    this.assertLiveDescriptor(path, "append");
    return super.appendFile(path, content, options);
  }

  override async rm(path: string, options?: RmOptions): Promise<void> {
    this.assertLiveDescriptor(path, "rm");
    return super.rm(path, options);
  }

  override async mkdir(path: string, _options?: MkdirOptions): Promise<void> {
    this.refuse(path, "mkdir");
  }

  override async cp(_src: string, dest: string): Promise<void> {
    this.refuse(dest, "cp");
  }

  override async mv(_src: string, dest: string): Promise<void> {
    this.refuse(dest, "mv");
  }

  override async symlink(_target: string, linkPath: string): Promise<void> {
    this.refuse(linkPath, "symlink");
  }

  override async link(_existingPath: string, newPath: string): Promise<void> {
    this.refuse(newPath, "link");
  }

  override async chmod(path: string, _mode: number): Promise<void> {
    this.refuse(path, "chmod");
  }

  override async utimes(
    path: string,
    _atime: Date,
    _mtime: Date,
  ): Promise<void> {
    this.refuse(path, "utimes");
  }
}

/**
 * Give `/dev/fd` a private, always-writable filesystem for the rest of this
 * execution.
 *
 * A read-only sandbox (`OverlayFs({ readOnly: true })` — the `just-bash` CLI's
 * default) rejects every write. That forbids the *script* from modifying the
 * filesystem it was handed, but a process substitution is a pipe, not a file
 * write: real bash runs `cat <(cmd)` and `tee >(cmd)` fine on a read-only
 * mount. Both directions need writes to succeed — `<(cmd)` to materialise the
 * body's output, and `>(cmd)` for the *outer* command (`tee`, a `>` redirect,
 * any command handed the path) to write into it.
 *
 * Rather than special-case each writer, the whole `/dev/fd` subtree is routed
 * to a throwaway `InMemoryFs`. Everything else still goes to the filesystem the
 * caller supplied, unchanged and still read-only. The mount lives for one
 * execution and never reaches the host filesystem, so nothing the sandbox
 * exposes changes — and because the mount is genuinely writable, descriptors
 * are removed on release instead of leaving stale entries behind.
 *
 * A fresh `MountableFs` wraps the caller's filesystem; the caller's own object
 * is never mutated, even if it happens to be a `MountableFs` itself. The
 * mounted filesystem only accepts writes to descriptors that are live right
 * now, so the read-only contract still holds for every other path.
 */
function mountBackingFs(ctx: InterpreterContext): void {
  const backing = new ProcessSubstitutionFs((relativePath) =>
    liveEntries(ctx).some(
      (entry) => entry.path === `${PROC_SUB_DIR}${relativePath}`,
    ),
  );
  ctx.fs = new MountableFs({
    base: ctx.fs,
    mounts: [{ mountPoint: PROC_SUB_DIR, filesystem: backing }],
  });
  ctx.state.processSubstitutionFsMounted = true;
}

/**
 * Materialise a descriptor's backing file, mounting the private `/dev/fd`
 * filesystem first if the supplied one refuses the write.
 */
async function writeBackingFile(
  ctx: InterpreterContext,
  path: string,
  bytes: string,
): Promise<void> {
  try {
    await ctx.fs.writeFile(path, bytes, "binary");
    return;
  } catch (error) {
    // Already on the private mount: the failure is real, not a policy refusal.
    if (ctx.state.processSubstitutionFsMounted) throw error;
    mountBackingFs(ctx);
  }
  await ctx.fs.writeFile(path, bytes, "binary");
}

/** Drop a descriptor's backing file. */
async function dropBackingFile(
  ctx: InterpreterContext,
  path: string,
): Promise<void> {
  try {
    await ctx.fs.rm(path, { force: true });
  } catch {
    // Nothing to drop: an outer command may have removed the path itself.
  }
}

/** A process substitution whose backing file is still live. */
export interface ProcessSubstitutionEntry {
  /** Synthetic descriptor number (63, 62, …). */
  fd: number;
  /** Backing file path handed to the outer command. */
  path: string;
  /** `<(...)` or `>(...)`. */
  direction: "input" | "output";
  /** Body to run with the written bytes as stdin (output substitutions only). */
  body: ScriptNode;
  /** Automa: credits belong only to bytes routed into this capture. */
  automaCaptureAccounting?: {
    path: string;
    bytes: number;
    routing: number;
    revision: number;
    paths: Set<string>;
  };
}

/** Keep direct backing-file replacement from inheriting stdout routing credits. */
function captureFileSystem(
  fs: IFileSystem,
  capture: NonNullable<ProcessSubstitutionEntry["automaCaptureAccounting"]>,
): IFileSystem {
  const captured = async (path: string) => {
    const resolved = fs.resolvePath("/", path);
    if (capture.paths.has(resolved)) return true;
    return capture.paths.has(await fs.realpath(resolved).catch(() => resolved));
  };
  const unchangedAlias = async (
    path: string,
    revision: number,
    bytes: number,
  ) => {
    const resolved = fs.resolvePath("/", path);
    if (resolved === capture.path) return false;
    const [source, destination] = await Promise.all([
      fs.stat(capture.path).catch(() => undefined),
      fs.stat(resolved).catch(() => undefined),
    ]);
    // Some backends model link() by copying an entry. A replacement that
    // provably detached the alias did not change the captured file's credits.
    if (
      source?.identity &&
      destination?.identity &&
      source.identity !== destination.identity
    ) {
      if (capture.revision === revision) capture.bytes = bytes;
      capture.paths.delete(resolved);
      return true;
    }
    return false;
  };
  return new _Proxy(fs, {
    get(target, key) {
      if (key === "constructor" || key === "prototype" || key === "__proto__")
        throw new Error("Unsafe process capture filesystem property");
      // @banned-pattern-ignore: gadget keys are rejected above; this is the
      // fixed host filesystem capability, never a user-keyed data object.
      const operation = Reflect.get(target, key, target);
      if (typeof operation !== "function") return operation;
      if (key === "writeFile" || key === "appendFile") {
        return async (
          path: string,
          content: FileContent,
          options?: WriteFileOptions | BufferEncoding,
        ) => {
          const routed = capture.routing > 0;
          const affected = await captured(path);
          const bytes = capture.bytes;
          const revision = affected ? ++capture.revision : capture.revision;
          if (affected && key === "writeFile") capture.bytes = 0;
          await operation.call(target, path, content, options);
          const unchanged =
            affected && (await unchangedAlias(path, revision, bytes));
          if (affected && !unchanged && routed) {
            const encoding =
              typeof options === "string" ? options : options?.encoding;
            capture.bytes +=
              typeof content === "string"
                ? encoding === "binary" || encoding === "latin1"
                  ? content.length
                  : utf8ByteLength(content)
                : content.byteLength;
          }
        };
      }
      if (["cp", "mv", "link", "symlink", "rm"].includes(String(key))) {
        return async (...args: unknown[]) => {
          const destination = String(args[key === "rm" ? 0 : 1]);
          const affected = await captured(destination);
          const bytes = capture.bytes;
          const revision = affected ? ++capture.revision : capture.revision;
          if (affected) capture.bytes = 0;
          const alias = key === "link" && (await captured(String(args[0])));
          const result = await operation.apply(target, args);
          if (affected) await unchangedAlias(destination, revision, bytes);
          if (alias) capture.paths.add(fs.resolvePath("/", destination));
          return result;
        };
      }
      return operation.bind(target);
    },
  });
}

function liveEntries(ctx: InterpreterContext): ProcessSubstitutionEntry[] {
  const existing = ctx.state.processSubstitutions;
  if (existing) return existing;
  const created: ProcessSubstitutionEntry[] = [];
  ctx.state.processSubstitutions = created;
  return created;
}

/**
 * Run a process substitution body with subshell semantics: variable, array and
 * cwd changes are discarded and `$?` is left untouched (bash reaps the body
 * asynchronously, so it never becomes the shell's last exit status). The
 * caller decides where the body's stderr goes.
 */
async function runBody(
  ctx: InterpreterContext,
  body: ScriptNode,
  stdin: string | undefined,
): Promise<ExecResult> {
  const currentDepth = ctx.substitutionDepth ?? 0;
  const maxDepth = ctx.limits.maxSubstitutionDepth;
  if (currentDepth >= maxDepth) {
    throw new ExecutionLimitError(
      `Process substitution nesting limit exceeded (${maxDepth})`,
      "substitution_depth",
    );
  }

  const savedDepth = ctx.substitutionDepth;
  const savedEnv = new Map(ctx.state.env);
  const savedArrays = cloneArrays(ctx.state.arrays);
  const savedCwd = ctx.state.cwd;
  const savedBashPid = ctx.state.bashPid;
  const savedSuppressVerbose = ctx.state.suppressVerbose;
  const savedGroupStdin = ctx.state.groupStdin;
  const savedExitCode = ctx.state.lastExitCode;
  const savedExitCodeVar = ctx.state.env.get("?");
  const savedSubstitutionExitCode = ctx.state.lastSubstitutionExitCode;

  ctx.substitutionDepth = currentDepth + 1;
  ctx.state.bashPid = ctx.state.nextVirtualPid++;
  ctx.state.suppressVerbose = true;
  if (stdin !== undefined) ctx.state.groupStdin = stdin;

  let result: ExecResult;
  try {
    result = await automaTrapChild(
      ctx,
      () => ctx.executeScript(body),
      "process",
    );
  } catch (error) {
    // Safety limits always propagate.
    if (error instanceof ExecutionLimitError) throw error;
    // `exit` inside the body terminates only the body, exactly like a
    // subshell; whatever it printed before exiting still reaches the pipe.
    if (error instanceof ExitError) {
      return {
        stdout: error.stdout,
        stderr: error.stderr,
        exitCode: error.exitCode,
        internalOutputAccounting: error.internalOutputAccounting,
        internalOutputSegments: error.internalOutputSegments,
      };
    }
    throw error;
  } finally {
    ctx.substitutionDepth = savedDepth;
    ctx.state.env = savedEnv;
    ctx.state.arrays = savedArrays;
    ctx.state.cwd = savedCwd;
    ctx.state.bashPid = savedBashPid;
    ctx.state.suppressVerbose = savedSuppressVerbose;
    ctx.state.groupStdin = savedGroupStdin;
    // The body's status is never the shell's `$?` (bash forks it away), and
    // a substitution inside it must not become the enclosing command's status
    // either — `x=<(echo $(false))` is still 0.
    ctx.state.lastExitCode = savedExitCode;
    ctx.state.lastSubstitutionExitCode = savedSubstitutionExitCode;
    if (savedExitCodeVar !== undefined) {
      ctx.state.env.set("?", savedExitCodeVar);
    } else {
      ctx.state.env.delete("?");
    }
  }

  return result;
}

/** Automa: capture stdout before text aggregation, through the original FD table. */
async function captureProcessBytes(
  ctx: InterpreterContext,
  body: ScriptNode,
  stdin: string | undefined,
): Promise<ExecResult & { captureRelease(): void }> {
  const entries = liveEntries(ctx);
  if (entries.length >= MAX_LIVE)
    throw new ExecutionLimitError(
      `Process substitution limit exceeded (${MAX_LIVE} concurrent)`,
      "file_descriptors",
    );
  const fd = FIRST_FD - entries.length;
  const path = `${PROC_SUB_DIR}/${fd}`;
  const accounting = {
    path,
    bytes: 0,
    routing: 0,
    revision: 0,
    paths: new Set([path]),
  };
  entries.push({
    fd,
    path,
    direction: "input",
    body,
    automaCaptureAccounting: accounting,
  });
  let originalFs: IFileSystem | undefined;
  let restore: (() => void) | undefined;
  let lease: ResourceLease | undefined;
  let returned = false;
  try {
    await writeBackingFile(ctx, path, "");
    originalFs = ctx.fs;
    ctx.fs = captureFileSystem(originalFs, accounting);
    restore = beginIsolatedShellState(ctx.state);
    setFdEntry(ctx, 1, { kind: "output", path, append: true });
    ctx.state.closedStandardFds?.delete(1);
    ctx.executionScope.throwIfAborted("process substitution");
    const result = await runBody(ctx, body, stdin);
    ctx.executionScope.throwIfAborted("process substitution");
    const size = (await ctx.fs.stat(path)).size;
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error("Invalid process substitution capture size");
    if (size > ctx.limits.maxStringLength)
      throw new ExecutionLimitError(
        `process substitution: string length limit exceeded (${ctx.limits.maxStringLength} bytes)`,
        "string_length",
      );
    lease = ctx.executionScope.reserveBytes(
      size * 3,
      "process substitution capture",
    );
    const stdout = latin1FromBytes(await readBytesFrom(ctx.fs, path));
    ctx.executionScope.throwIfAborted("process substitution");
    if (stdout.length !== size)
      throw new Error("Process substitution capture changed while reading");
    returned = true;
    return {
      ...result,
      stdout,
      stdoutKind: "bytes",
      stdoutEncoding: "binary",
      // The private fd route charged these exact bytes before writing them.
      // Routing stdout into the backing file removed its result-side credit;
      // materialising it again must carry that credit, not charge it twice.
      internalOutputAccounting: {
        stdout: Math.min(size, accounting.bytes),
        stderr: result.internalOutputAccounting?.stderr ?? 0,
      },
      internalOutputSegments: [
        ["stdout", stdout, "bytes"],
        ...(result.internalOutputSegments ?? []).filter(
          (part) => part[0] === "stderr",
        ),
      ],
      captureRelease: () => lease?.release(),
    };
  } finally {
    restore?.();
    if (originalFs) ctx.fs = originalFs;
    await dropBackingFile(ctx, path);
    entries.pop();
    if (!returned) lease?.release();
  }
}

/**
 * Expand a process substitution to the path the outer command should use.
 */
export async function openProcessSubstitution(
  ctx: InterpreterContext,
  part: ProcessSubstitutionPart,
): Promise<string> {
  let captureRelease: (() => void) | undefined;
  try {
    const entries = liveEntries(ctx);
    if (entries.length >= MAX_LIVE) {
      throw new ExecutionLimitError(
        `Process substitution limit exceeded (${MAX_LIVE} concurrent)`,
        "file_descriptors",
      );
    }

    let bytes = "";
    if (part.direction === "input") {
      const result = await captureProcessBytes(ctx, part.body, undefined);
      captureRelease = result.captureRelease;
      // The body runs during expansion, so its stderr belongs to the shell at
      // expansion time - later redirections on the outer command must not
      // capture it (same rule as command substitution).
      if (result.stderr) {
        ctx.state.expansionStderr =
          (ctx.state.expansionStderr || "") + result.stderr;
      }
      bytes = latin1FromBytes(stdoutAsBytes(result));
      if (bytes.length > ctx.limits.maxStringLength) {
        throw new ExecutionLimitError(
          `process substitution: string length limit exceeded (${ctx.limits.maxStringLength} bytes)`,
          "string_length",
        );
      }
    }

    // The descriptor is numbered only after the body has run, so a nested
    // substitution inside it gets - and releases - this same number first, just
    // as bash reuses a descriptor once its writer is reaped. Registering the
    // entry before the write is what makes the backing path writable on the
    // guarded /dev/fd mount; a failed write must not leave it registered.
    const fd = FIRST_FD - entries.length;
    const path = `${PROC_SUB_DIR}/${fd}`;
    entries.push({ fd, path, direction: part.direction, body: part.body });
    try {
      await writeBackingFile(ctx, path, bytes);
    } catch (error) {
      entries.pop();
      throw error;
    }
    return path;
  } finally {
    captureRelease?.();
  }
}

/**
 * Remember how many process substitutions were live before a command ran.
 */
export function markProcessSubstitutions(ctx: InterpreterContext): number {
  return ctx.state.processSubstitutions?.length ?? 0;
}

/** Output produced by `>(cmd)` writers drained at the end of a command. */
export type ProcessSubstitutionWriterOutput = Pick<
  ExecResult,
  "stdout" | "stderr" | "internalOutputAccounting" | "internalOutputSegments"
>;

/** Nothing was drained. */
const NO_WRITER_OUTPUT: ProcessSubstitutionWriterOutput = {
  stdout: "",
  stderr: "",
};

/**
 * Tear down every process substitution opened since `mark`, newest first.
 *
 * Input substitutions just drop their backing file. Output substitutions first
 * feed everything the outer command wrote into their body; the body's output is
 * returned so the caller can append it to the command's own, the way bash's
 * asynchronous writer shares the shell's stdout and stderr.
 */
export async function releaseProcessSubstitutions(
  ctx: InterpreterContext,
  mark: number,
): Promise<ProcessSubstitutionWriterOutput> {
  const entries = ctx.state.processSubstitutions;
  if (!entries || entries.length <= mark) return NO_WRITER_OUTPUT;

  const output = new ExecutionOutputAccumulator(
    ctx.executionScope,
    "process substitution",
  );
  try {
    while (entries.length > mark) {
      const entry = entries[entries.length - 1];

      // Read and drop while the entry is still registered: on the guarded
      // /dev/fd mount only live descriptors may be removed.
      let written = "";
      if (entry.direction === "output") {
        try {
          written = latin1FromBytes(await readBytesFrom(ctx.fs, entry.path));
        } catch {
          // Backing file already gone - nothing was written.
        }
      }
      await dropBackingFile(ctx, entry.path);
      entries.pop();

      // Run the writer only after the descriptor is gone, so a body that throws
      // (an execution limit, say) cannot leave the entry or its file behind.
      if (entry.direction === "output") {
        const result = await captureProcessBytes(ctx, entry.body, written);
        try {
          output.appendResult(result);
        } finally {
          result.captureRelease();
        }
      }
    }
    return output.build(0);
  } catch (error) {
    output.prependTo(error);
    // A direct capture limit must poison the shared execution just like a
    // budget-originated failure, even while unwinding return/break/exit.
    if (
      error instanceof ExecutionLimitError ||
      error instanceof ExecutionAbortedError
    )
      ctx.executionScope.poisonAfterAbort(error);
    throw error;
  } finally {
    // A failed writer must not leave its siblings live or execute them later.
    while (entries.length > mark) {
      await dropBackingFile(ctx, entries[entries.length - 1].path);
      entries.pop();
    }
  }
}

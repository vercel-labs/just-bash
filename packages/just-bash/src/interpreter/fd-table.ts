/**
 * File Descriptor Table
 *
 * One typed view over `ctx.state.fileDescriptors`, the shell's descriptor
 * table. The table itself stays a `Map<number, string>` because it is part
 * of the public `CommandContext` surface — extensions read fd values as
 * content — so this module owns the string encoding instead.
 *
 * Entry kinds:
 * - `input`      readable content (`N< file`, `N<<EOF`, `N<<<word`). Reading
 *                is destructive: the remaining content is written back, so
 *                successive `read -u N` calls advance a shared position.
 * - `output`     a file opened for writing (`N> file`, `N>> file`).
 * - `readwrite`  `N<> file` — content plus an explicit read position.
 * - `dup-out`    fd duplicated from stdout/stderr (`N>&1`).
 * - `dup-in`     fd duplicated from stdin (`N<&0`).
 *
 * An `input` entry is stored verbatim, so its content can look exactly like
 * one of the marker encodings (a file whose first line is `__file__:/x`).
 * `inputFds` records which descriptors hold content, so the markers are
 * never guessed at for a descriptor this module opened; the prefix sniffing
 * in {@link decodeFdEntry} is only a fallback for descriptors written by
 * older code paths.
 */

import type { WritableFile } from "../fs/interface.js";
import { checkFdLimit } from "./helpers/result.js";
import type { InterpreterContext } from "./types.js";

const FILE_PREFIX = "__file__:";
const FILE_APPEND_PREFIX = "__file_append__:";
const RW_PREFIX = "__rw__:";
const DUP_OUT_PREFIX = "__dupout__:";
const DUP_IN_PREFIX = "__dupin__:";

/** Lowest descriptor a script may open by number. 0/1/2 are the std streams. */
export const FIRST_USER_FD = 3;

export type FdEntry =
  | { kind: "input"; content: string }
  | {
      kind: "output";
      path: string;
      append: boolean;
      writable?: WritableFile;
    }
  | { kind: "readwrite"; path: string; position: number; content: string }
  | { kind: "dup-out"; sourceFd: number }
  | { kind: "dup-in"; sourceFd: number }
  | { kind: "closed" };

/**
 * A descriptor's raw value, whether it is known to hold content, and which
 * other descriptors shared its open file description.
 */
interface FdSnapshotEntry {
  raw: string | undefined;
  isInput: boolean;
  writable: WritableFile | undefined;
  aliases: number[];
}

/** Descriptor state captured by {@link rememberFd}, replayed by
 * {@link restoreFds}. */
export type FdSnapshot = Map<number, FdSnapshotEntry>;

/**
 * Parse the content of a read-write file descriptor.
 * Format: __rw__:pathLength:path:position:content
 * The explicit path length keeps paths containing colons parseable.
 */
function parseReadWrite(
  raw: string,
): { path: string; position: number; content: string } | null {
  const afterPrefix = raw.slice(RW_PREFIX.length);
  const firstColonIdx = afterPrefix.indexOf(":");
  if (firstColonIdx === -1) return null;
  const pathLength = Number.parseInt(afterPrefix.slice(0, firstColonIdx), 10);
  if (Number.isNaN(pathLength) || pathLength < 0) return null;
  const pathStart = firstColonIdx + 1;
  const path = afterPrefix.slice(pathStart, pathStart + pathLength);
  const remaining = afterPrefix.slice(pathStart + pathLength + 1);
  const posColonIdx = remaining.indexOf(":");
  if (posColonIdx === -1) return null;
  const position = Number.parseInt(remaining.slice(0, posColonIdx), 10);
  if (Number.isNaN(position) || position < 0) return null;
  return { path, position, content: remaining.slice(posColonIdx + 1) };
}

function parseDupSource(raw: string, prefix: string): number | null {
  const sourceFd = Number.parseInt(raw.slice(prefix.length), 10);
  return Number.isNaN(sourceFd) ? null : sourceFd;
}

/**
 * Decode a raw table value into a typed entry.
 * Callers that know the descriptor holds content should go through
 * {@link getFdEntry}, which consults `inputFds` first and never guesses.
 */
export function decodeFdEntry(raw: string): FdEntry {
  if (raw.startsWith(FILE_PREFIX)) {
    return {
      kind: "output",
      path: raw.slice(FILE_PREFIX.length),
      append: false,
    };
  }
  if (raw.startsWith(FILE_APPEND_PREFIX)) {
    return {
      kind: "output",
      path: raw.slice(FILE_APPEND_PREFIX.length),
      append: true,
    };
  }
  if (raw.startsWith(RW_PREFIX)) {
    const parsed = parseReadWrite(raw);
    if (parsed) return { kind: "readwrite", ...parsed };
  }
  if (raw.startsWith(DUP_OUT_PREFIX)) {
    const sourceFd = parseDupSource(raw, DUP_OUT_PREFIX);
    if (sourceFd !== null) return { kind: "dup-out", sourceFd };
  }
  if (raw.startsWith(DUP_IN_PREFIX)) {
    const sourceFd = parseDupSource(raw, DUP_IN_PREFIX);
    if (sourceFd !== null) return { kind: "dup-in", sourceFd };
  }
  return { kind: "input", content: raw };
}

/** Encode a typed entry back into its raw table value. */
export function encodeFdEntry(entry: FdEntry): string {
  switch (entry.kind) {
    case "input":
      return entry.content;
    case "output":
      return `${entry.append ? FILE_APPEND_PREFIX : FILE_PREFIX}${entry.path}`;
    case "readwrite":
      return `${RW_PREFIX}${entry.path.length}:${entry.path}:${entry.position}:${entry.content}`;
    case "dup-out":
      return `${DUP_OUT_PREFIX}${entry.sourceFd}`;
    case "dup-in":
      return `${DUP_IN_PREFIX}${entry.sourceFd}`;
    case "closed":
      throw new Error("Closed descriptors have no table encoding");
  }
}

function table(ctx: InterpreterContext): Map<number, string> {
  ctx.state.fileDescriptors ??= new Map();
  return ctx.state.fileDescriptors;
}

function markContent(ctx: InterpreterContext, fd: number, isInput: boolean) {
  if (isInput) {
    ctx.state.inputFds ??= new Set();
    ctx.state.inputFds.add(fd);
  } else {
    ctx.state.inputFds?.delete(fd);
  }
}

function writableForFd(
  ctx: InterpreterContext,
  fd: number,
): WritableFile | undefined {
  return ctx.state.outputWriters?.get(fd);
}

function detachWritable(ctx: InterpreterContext, fd: number): void {
  const writable = writableForFd(ctx, fd);
  if (!writable) return;
  ctx.state.outputWriters?.delete(fd);
  ctx.state.writableCloseCandidates ??= new Set();
  ctx.state.writableCloseCandidates.add(writable);
}

function attachWritable(
  ctx: InterpreterContext,
  fd: number,
  writable: WritableFile | undefined,
): void {
  if (!writable) return;
  ctx.state.outputWriters ??= new Map();
  ctx.state.outputWriters.set(fd, writable);
}

/**
 * Closes candidate descriptions that no live shell descriptor still owns.
 * Newly opened command-scoped descriptions may be supplied because standard
 * descriptors do not always need an encoded table entry.
 */
export function closeUnusedWritables(
  ctx: InterpreterContext,
  opened: readonly WritableFile[] = [],
): Promise<void> | undefined {
  const candidates = new Set([
    ...(ctx.state.writableCloseCandidates ?? []),
    ...opened,
  ]);
  ctx.state.writableCloseCandidates?.clear();
  const active = new Set([
    ...(ctx.state.outputWriters?.values() ?? []),
    ...(ctx.state.inheritedOutputWriters ?? []),
  ]);
  const closable = [...candidates]
    .reverse()
    .filter((writable) => !active.has(writable));
  if (closable.length === 0) return undefined;
  return closeWritables(ctx, closable);
}

async function closeWritables(
  ctx: InterpreterContext,
  writables: readonly WritableFile[],
): Promise<void> {
  for (const writable of writables) {
    try {
      await writable.close();
    } catch (error) {
      // Preserve the result-oriented Bash.exec contract and any in-flight
      // shell control flow. ExecutionScope reports cleanup failures as 126.
      try {
        ctx.executionScope.registerCleanup(() => Promise.reject(error));
      } catch {
        // An existing abort or limit failure remains authoritative.
      }
    }
  }
}

// ---- Shared open file descriptions -----------------------------------------
// `N<&M` gives N and M the same open file description, so they share ONE read
// offset: after `exec 4<&3`, reading fd 3 moves fd 4 forward too. The table
// stores a descriptor's unread remainder as its value, so "sharing an offset"
// means keeping the aliased descriptors' values in step. `state.fdAliases`
// records the alias groups; every member maps to the same Set object, and a
// descriptor with no aliases has no entry at all.

/** The descriptors sharing `fd`'s open file description, `fd` included. */
function aliasGroup(
  ctx: InterpreterContext,
  fd: number,
): Set<number> | undefined {
  return ctx.state.fdAliases?.get(fd);
}

export function getFdAliasMembers(
  ctx: InterpreterContext,
  fd: number,
): number[] {
  return [...(aliasGroup(ctx, fd) ?? [fd])];
}

/** Drop `fd` from its alias group; the last remaining member stops aliasing. */
function leaveAliasGroup(ctx: InterpreterContext, fd: number): void {
  const group = aliasGroup(ctx, fd);
  if (!group) return;
  group.delete(fd);
  ctx.state.fdAliases?.delete(fd);
  if (group.size < 2) {
    for (const member of group) ctx.state.fdAliases?.delete(member);
  }
}

/** Put `fd` into `sourceFd`'s alias group, creating the group if needed. */
function joinAliasGroup(
  ctx: InterpreterContext,
  fd: number,
  sourceFd: number,
): void {
  if (fd === sourceFd) return;
  ctx.state.fdAliases ??= new Map();
  const group = aliasGroup(ctx, sourceFd) ?? new Set([sourceFd]);
  group.add(fd);
  for (const member of group) ctx.state.fdAliases.set(member, group);
}

/** Raw table value for `fd`, or undefined when the fd is not open. */
export function getRawFd(
  ctx: InterpreterContext,
  fd: number,
): string | undefined {
  return ctx.state.fileDescriptors?.get(fd);
}

/** Typed entry for `fd`, or undefined when the fd is not open. */
export function getFdEntry(
  ctx: InterpreterContext,
  fd: number,
): FdEntry | undefined {
  const raw = getRawFd(ctx, fd);
  if (raw === undefined) return undefined;
  // A descriptor known to hold content is never re-parsed: a file whose
  // first line reads `__file__:/tmp/x` is data, not a marker.
  if (ctx.state.inputFds?.has(fd)) return { kind: "input", content: raw };
  const entry = decodeFdEntry(raw);
  if (entry.kind !== "output") return entry;
  const writable = writableForFd(ctx, fd);
  return writable ? { ...entry, writable } : entry;
}

export function isFdOpen(ctx: InterpreterContext, fd: number): boolean {
  return ctx.state.fileDescriptors?.has(fd) === true;
}

/** Write a descriptor's value without disturbing its alias group. */
function writeRawFd(
  ctx: InterpreterContext,
  fd: number,
  raw: string,
  isInput: boolean,
): void {
  const fds = table(ctx);
  if (!fds.has(fd)) checkFdLimit(ctx);
  fds.set(fd, raw);
  markContent(ctx, fd, isInput);
}

/**
 * Store a raw value, charging the descriptor limit for newly opened fds.
 * Opening a descriptor gives it a NEW open file description, so it stops
 * sharing an offset with anything it was previously duplicated from —
 * `exec 4<&3; exec 4< other` leaves fd 3 alone.
 */
export function setRawFd(
  ctx: InterpreterContext,
  fd: number,
  raw: string,
  isInput = false,
): void {
  leaveAliasGroup(ctx, fd);
  detachWritable(ctx, fd);
  writeRawFd(ctx, fd, raw, isInput);
}

export function setFdEntry(
  ctx: InterpreterContext,
  fd: number,
  entry: FdEntry,
): void {
  setRawFd(ctx, fd, encodeFdEntry(entry), entry.kind === "input");
  attachWritable(ctx, fd, entry.kind === "output" ? entry.writable : undefined);
}

export function closeFd(ctx: InterpreterContext, fd: number): void {
  ctx.state.fileDescriptors?.delete(fd);
  ctx.state.inputFds?.delete(fd);
  detachWritable(ctx, fd);
  leaveAliasGroup(ctx, fd);
}

/**
 * Point `fd` at whatever `sourceFd` refers to, the way `dup2()` does: the raw
 * value and its content/marker classification are copied, and the two
 * descriptors join one alias group so they share a read offset from here on.
 * Returns false when `sourceFd` is not open.
 */
export function dupFd(
  ctx: InterpreterContext,
  fd: number,
  sourceFd: number,
): boolean {
  const raw = getRawFd(ctx, sourceFd);
  if (raw === undefined) return false;
  const writable = writableForFd(ctx, sourceFd);
  setRawFd(ctx, fd, raw, ctx.state.inputFds?.has(sourceFd) === true);
  attachWritable(ctx, fd, writable);
  joinAliasGroup(ctx, fd, sourceFd);
  return true;
}

export function moveFd(
  ctx: InterpreterContext,
  fd: number,
  sourceFd: number,
): boolean {
  const raw = getRawFd(ctx, sourceFd);
  if (raw === undefined) return false;
  if (fd === sourceFd) return true;
  const isInput = ctx.state.inputFds?.has(sourceFd) === true;
  const writable = writableForFd(ctx, sourceFd);
  const aliases = [...(aliasGroup(ctx, sourceFd) ?? [])].filter(
    (member) => member !== sourceFd,
  );
  closeFd(ctx, sourceFd);
  setRawFd(ctx, fd, raw, isInput);
  attachWritable(ctx, fd, writable);
  const survivor = aliases.find((member) => isFdOpen(ctx, member));
  if (survivor !== undefined) joinAliasGroup(ctx, fd, survivor);
  return true;
}

/**
 * Readable bytes remaining on `fd`.
 * Returns a reason instead of content when the fd cannot be read from, so
 * callers can pick the diagnostic bash uses for their context.
 */
export function readFd(
  ctx: InterpreterContext,
  fd: number,
): { content: string } | { error: "not-open" | "write-only" } {
  const entry = getFdEntry(ctx, fd);
  if (entry === undefined) return { error: "not-open" };
  switch (entry.kind) {
    case "input":
      return { content: entry.content };
    case "readwrite":
      return { content: entry.content.slice(entry.position) };
    case "output":
    case "dup-out":
      return { error: "write-only" };
    case "dup-in":
      return { error: "not-open" };
    case "closed":
      return { error: "not-open" };
  }
}

/**
 * Advance the read position of `fd` by `count` characters.
 * `input` entries keep only the unread remainder, matching bash's single
 * shared file offset: every later read continues where this one stopped —
 * including reads through a descriptor duplicated from this one, which
 * shares the same open file description.
 */
export function advanceFd(
  ctx: InterpreterContext,
  fd: number,
  count: number,
): void {
  const entry = getFdEntry(ctx, fd);
  if (entry === undefined) return;
  let advanced: FdEntry;
  if (entry.kind === "input") {
    advanced = { kind: "input", content: entry.content.slice(count) };
  } else if (entry.kind === "readwrite") {
    advanced = { ...entry, position: entry.position + count };
  } else {
    return;
  }
  const raw = encodeFdEntry(advanced);
  const isInput = advanced.kind === "input";
  // The offset lives in the open file description, not the descriptor, so
  // every alias moves with it. writeRawFd, not setRawFd: this is a read, and
  // a read must not break the aliasing it is moving.
  for (const member of aliasGroup(ctx, fd) ?? [fd]) {
    writeRawFd(ctx, member, raw, isInput);
  }
}

export async function writeFdEntry(
  ctx: InterpreterContext,
  entry: FdEntry,
  descriptors: number[],
  content: string,
  encoding: "binary" | "utf8",
): Promise<boolean> {
  if (entry.kind === "output") {
    if (entry.writable) {
      await entry.writable.write(content, encoding);
    } else {
      await ctx.fs.appendFile(entry.path, content, encoding);
    }
    return true;
  }
  const liveEntry = descriptors
    .map((fd) => getFdEntry(ctx, fd))
    .find(
      (candidate): candidate is Extract<FdEntry, { kind: "readwrite" }> =>
        candidate?.kind === "readwrite",
    );
  const writeEntry = liveEntry ?? entry;
  if (writeEntry.kind !== "readwrite") return false;

  const updatedContent =
    writeEntry.content.slice(0, writeEntry.position) +
    content +
    writeEntry.content.slice(writeEntry.position + content.length);
  const updated: FdEntry = {
    ...writeEntry,
    position: writeEntry.position + content.length,
    content: updatedContent,
  };
  await ctx.fs.writeFile(writeEntry.path, updatedContent, encoding);
  const raw = encodeFdEntry(updated);
  for (const fd of descriptors) {
    if (isFdOpen(ctx, fd)) writeRawFd(ctx, fd, raw, false);
  }
  return true;
}

/**
 * Record `fd`'s current state into `snapshot`, unless it is already there —
 * the FIRST value seen is the one a later {@link restoreFds} puts back.
 * A `raw` of `undefined` records "was not open".
 */
export function rememberFd(
  ctx: InterpreterContext,
  snapshot: FdSnapshot,
  fd: number,
): void {
  if (snapshot.has(fd)) return;
  const group = aliasGroup(ctx, fd);
  snapshot.set(fd, {
    raw: getRawFd(ctx, fd),
    isInput: ctx.state.inputFds?.has(fd) === true,
    writable: writableForFd(ctx, fd),
    aliases: group ? [...group].filter((member) => member !== fd) : [],
  });
}

/**
 * Snapshot the given descriptors so a scoped redirection can put the table
 * back the way it found it.
 */
export function snapshotFds(
  ctx: InterpreterContext,
  fds: Iterable<number>,
): FdSnapshot {
  const snapshot: FdSnapshot = new Map();
  for (const fd of fds) rememberFd(ctx, snapshot, fd);
  return snapshot;
}

/**
 * Undo the descriptor changes recorded by {@link rememberFd}.
 *
 * Only the descriptor is restored, never the file offset behind it: a
 * command that read through `4<&3` has moved the shared description, and
 * bash leaves fd 3 where that read left it once fd 4 is taken back down.
 */
export function restoreFds(
  ctx: InterpreterContext,
  snapshot: FdSnapshot,
): void {
  const fds = ctx.state.fileDescriptors;
  if (!fds) return;
  for (const [fd, { raw, isInput, writable, aliases }] of snapshot) {
    if (raw === undefined) {
      closeFd(ctx, fd);
      continue;
    }
    // Re-opening the saved value detaches fd from whatever it aliases now.
    setRawFd(ctx, fd, raw, isInput);
    attachWritable(ctx, fd, writable);
    // Then re-attach it to whichever of its original co-members is still
    // open — they all share one description, so any survivor will do.
    const survivor = aliases.find((member) => fds.has(member));
    if (survivor !== undefined) joinAliasGroup(ctx, fd, survivor);
  }
}

/**
 * Output formatters for diff.
 *
 * The three formats GNU diff can produce: POSIX normal format (the default),
 * unified format (-u) and context format (-c). Layout was derived by running
 * GNU diffutils 3.12 and matching the bytes it emits.
 *
 * Two intentional deviations from GNU:
 *
 * - The -u/-c file header carries no timestamp. GNU appends a tab and the
 *   file's mtime; inside a virtual filesystem that is often synthetic or
 *   absent, and it would make output non-reproducible. Patch consumers ignore
 *   the field.
 * - When several minimal edit scripts exist for the same pair of files, which
 *   one comes out is arbitrary, and this picks a different one than GNU on
 *   some inputs. Hunks are still minimal and the formats are exact; only the
 *   grouping of ambiguous changes can differ.
 */

import * as Diff from "diff";

const NO_NEWLINE = "\\ No newline at end of file\n";

/** Number of context lines GNU shows around a change for -u and -c. */
export const DEFAULT_CONTEXT = 3;

export interface FileLines {
  /** Lines with their trailing newline stripped. */
  lines: string[];
  /** True when the last line is not newline-terminated. */
  noEol: boolean;
}

/**
 * A run of adjacent deleted and/or inserted lines. Starts are 0-based indices
 * into the corresponding `FileLines.lines`.
 */
export interface Change {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/** Splits file content into lines, remembering a missing final newline. */
export function splitLines(content: string): FileLines {
  if (content === "") return { lines: [], noEol: false };
  const noEol = !content.endsWith("\n");
  const lines = content.split("\n");
  // A newline-terminated file ends with an empty trailing element.
  if (!noEol) lines.pop();
  return { lines, noEol };
}

/**
 * Builds the comparison tokens for a file. Every line keeps its newline so a
 * final line without one never compares equal to the same text with one —
 * that is what makes GNU report `\ No newline at end of file` as a difference.
 */
function tokenize(file: FileLines, ignoreCase: boolean): string[] {
  const last = file.lines.length - 1;
  return file.lines.map((line, i) => {
    const token = i === last && file.noEol ? line : `${line}\n`;
    return ignoreCase ? token.toLowerCase() : token;
  });
}

/** Computes the runs of deleted and/or inserted lines between two files. */
export function computeChanges(
  oldFile: FileLines,
  newFile: FileLines,
  ignoreCase: boolean,
): Change[] {
  const parts = Diff.diffArrays(
    tokenize(oldFile, ignoreCase),
    tokenize(newFile, ignoreCase),
  );

  const changes: Change[] = [];
  let oldIdx = 0;
  let newIdx = 0;
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      oldIdx += part.count ?? part.value.length;
      newIdx += part.count ?? part.value.length;
      i++;
      continue;
    }
    const change: Change = {
      oldStart: oldIdx,
      oldCount: 0,
      newStart: newIdx,
      newCount: 0,
    };
    // Deletions and insertions that touch arrive as separate adjacent parts;
    // one hunk covers the whole run.
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      const count = parts[i].count ?? parts[i].value.length;
      if (parts[i].removed) {
        change.oldCount += count;
        oldIdx += count;
      } else {
        change.newCount += count;
        newIdx += count;
      }
      i++;
    }
    changes.push(change);
  }
  return changes;
}

/**
 * Quotes a filename for a -u/-c header the way GNU diff does.
 *
 * Without this a filename containing a newline would forge extra header or
 * `@@` lines in the emitted patch, which a downstream `patch` would act on.
 * Rule taken from GNU diffutils 3.12 in a UTF-8 locale: quote when the name
 * holds whitespace, a double quote or a control character; leave non-ASCII
 * alone. A lone backslash does not trigger quoting but is escaped once some
 * other character has.
 */
function quoteFilename(name: string): string {
  if (!/[\s"\u0000-\u001f\u007f]/.test(name)) return name;
  let out = '"';
  for (const ch of name) {
    if (ch === '"' || ch === "\\") out += `\\${ch}`;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch < "\u0020" || ch === "\u007f") {
      out += `\\${ch.charCodeAt(0).toString(8).padStart(3, "0")}`;
    } else out += ch;
  }
  return `${out}"`;
}

/** Appends one line plus, when it is a final line without newline, the marker. */
function pushLine(
  out: string[],
  file: FileLines,
  index: number,
  prefix: string,
): void {
  out.push(`${prefix}${file.lines[index]}\n`);
  if (file.noEol && index === file.lines.length - 1) out.push(NO_NEWLINE);
}

/** `N` for one line, `N,M` for a run, and the preceding line for an empty run. */
function normalRange(start: number, count: number): string {
  if (count === 0) return String(start);
  if (count === 1) return String(start + 1);
  return `${start + 1},${start + count}`;
}

/** POSIX normal format: `2c2` / `< old` / `---` / `> new`. */
export function formatNormal(
  oldFile: FileLines,
  newFile: FileLines,
  changes: Change[],
): string {
  const out: string[] = [];
  for (const change of changes) {
    const op = change.oldCount === 0 ? "a" : change.newCount === 0 ? "d" : "c";
    out.push(
      `${normalRange(change.oldStart, change.oldCount)}${op}${normalRange(
        change.newStart,
        change.newCount,
      )}\n`,
    );
    for (let i = 0; i < change.oldCount; i++) {
      pushLine(out, oldFile, change.oldStart + i, "< ");
    }
    if (op === "c") out.push("---\n");
    for (let i = 0; i < change.newCount; i++) {
      pushLine(out, newFile, change.newStart + i, "> ");
    }
  }
  return out.join("");
}

/**
 * Groups changes into hunks. GNU merges two changes into one hunk when at most
 * `2 * context` unchanged lines separate them.
 */
function groupIntoHunks(changes: Change[], context: number): Change[][] {
  const hunks: Change[][] = [];
  let current: Change[] = [];
  for (const change of changes) {
    const prev = current[current.length - 1];
    if (
      prev &&
      change.oldStart - (prev.oldStart + prev.oldCount) > 2 * context
    ) {
      hunks.push(current);
      current = [];
    }
    current.push(change);
  }
  if (current.length > 0) hunks.push(current);
  return hunks;
}

interface HunkBounds {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
}

/** Half-open [from, to) line ranges covered by a hunk, context included. */
function hunkBounds(
  hunk: Change[],
  oldFile: FileLines,
  newFile: FileLines,
  context: number,
): HunkBounds {
  const first = hunk[0];
  const last = hunk[hunk.length - 1];
  return {
    oldFrom: Math.max(0, first.oldStart - context),
    oldTo: Math.min(
      oldFile.lines.length,
      last.oldStart + last.oldCount + context,
    ),
    newFrom: Math.max(0, first.newStart - context),
    newTo: Math.min(
      newFile.lines.length,
      last.newStart + last.newCount + context,
    ),
  };
}

/** `@@` range: `N,0` when empty, bare `N` for one line, else `N,count`. */
function unifiedRange(from: number, to: number): string {
  const count = to - from;
  if (count === 0) return `${from},0`;
  if (count === 1) return String(from + 1);
  return `${from + 1},${count}`;
}

/** Unified format (-u): `--- old`, `+++ new`, `@@` hunks. */
export function formatUnified(
  oldName: string,
  newName: string,
  oldFile: FileLines,
  newFile: FileLines,
  changes: Change[],
  context: number,
): string {
  const out: string[] = [
    `--- ${quoteFilename(oldName)}\n`,
    `+++ ${quoteFilename(newName)}\n`,
  ];
  for (const hunk of groupIntoHunks(changes, context)) {
    const b = hunkBounds(hunk, oldFile, newFile, context);
    out.push(
      `@@ -${unifiedRange(b.oldFrom, b.oldTo)} +${unifiedRange(
        b.newFrom,
        b.newTo,
      )} @@\n`,
    );
    let oldIdx = b.oldFrom;
    for (const change of hunk) {
      // Unchanged lines are printed from the old file, matching GNU under -i.
      for (; oldIdx < change.oldStart; oldIdx++)
        pushLine(out, oldFile, oldIdx, " ");
      for (let i = 0; i < change.oldCount; i++) {
        pushLine(out, oldFile, change.oldStart + i, "-");
      }
      for (let i = 0; i < change.newCount; i++) {
        pushLine(out, newFile, change.newStart + i, "+");
      }
      oldIdx = change.oldStart + change.oldCount;
    }
    for (; oldIdx < b.oldTo; oldIdx++) pushLine(out, oldFile, oldIdx, " ");
  }
  return out.join("");
}

/** `*** N,M ****` range: start,end inclusive, bare `N` for one line. */
function contextRange(from: number, to: number): string {
  const count = to - from;
  if (count === 0) return String(from);
  if (count === 1) return String(from + 1);
  return `${from + 1},${to}`;
}

/**
 * Emits one side of a context-format hunk. GNU omits the body entirely when
 * this side has no changed lines, leaving just the range header.
 */
function pushContextSide(
  out: string[],
  file: FileLines,
  hunk: Change[],
  from: number,
  to: number,
  isOldSide: boolean,
): void {
  const hasChanges = hunk.some(
    (c) => (isOldSide ? c.oldCount : c.newCount) > 0,
  );
  if (!hasChanges) return;

  let idx = from;
  for (const change of hunk) {
    const start = isOldSide ? change.oldStart : change.newStart;
    const count = isOldSide ? change.oldCount : change.newCount;
    for (; idx < start; idx++) pushLine(out, file, idx, "  ");
    // A run touching both files is a change (`!`); otherwise it is one-sided.
    const marker =
      change.oldCount > 0 && change.newCount > 0
        ? "! "
        : isOldSide
          ? "- "
          : "+ ";
    for (let i = 0; i < count; i++) pushLine(out, file, start + i, marker);
    idx = start + count;
  }
  for (; idx < to; idx++) pushLine(out, file, idx, "  ");
}

/** Context format (-c): `*** old`, `--- new`, `***************` hunks. */
export function formatContext(
  oldName: string,
  newName: string,
  oldFile: FileLines,
  newFile: FileLines,
  changes: Change[],
  context: number,
): string {
  const out: string[] = [
    `*** ${quoteFilename(oldName)}\n`,
    `--- ${quoteFilename(newName)}\n`,
  ];
  for (const hunk of groupIntoHunks(changes, context)) {
    const b = hunkBounds(hunk, oldFile, newFile, context);
    out.push("***************\n");
    out.push(`*** ${contextRange(b.oldFrom, b.oldTo)} ****\n`);
    pushContextSide(out, oldFile, hunk, b.oldFrom, b.oldTo, true);
    out.push(`--- ${contextRange(b.newFrom, b.newTo)} ----\n`);
    pushContextSide(out, newFile, hunk, b.newFrom, b.newTo, false);
  }
  return out.join("");
}

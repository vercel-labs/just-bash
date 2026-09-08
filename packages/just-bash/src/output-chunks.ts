/**
 * Ordered output sequences.
 *
 * An `ExecResult` keeps stdout and stderr as two strings, which is enough to
 * deliver each to its own destination but says nothing about how the two
 * interleaved. `OutputChunk[]` records that sequence alongside them, for the
 * one case that needs it: a duplication (`2>&1`) puts both fds on a single
 * descriptor, and what that descriptor carries is the two streams in the
 * order they were written.
 */

import {
  encodeUtf8ToBytes,
  latin1FromBytes,
  type OutputKind,
} from "./encoding.js";
import type { OutputChunk } from "./types.js";

/**
 * Whether a recorded sequence still accounts for exactly the two streams it is
 * attached to, piece for piece.
 *
 * Every consumer checks this before following the sequence. A layer between
 * the recording and the read can rewrite a stream -- a decode that reshapes
 * stdout, a diagnostic appended on the way out, an earlier pipeline stage's
 * stderr prepended -- and the recording then describes content the result no
 * longer carries. Reconstructing rather than trusting keeps the two strings
 * authoritative: the sequence can reorder, never invent or drop.
 */
export function chunksDescribe(
  chunks: OutputChunk[] | undefined,
  stdout: string,
  stderr: string,
): chunks is OutputChunk[] {
  if (!chunks?.length) return false;
  let recordedStdout = "";
  let recordedStderr = "";
  for (const chunk of chunks) {
    if (chunk.stream === "stdout") recordedStdout += chunk.text;
    else recordedStderr += chunk.text;
  }
  return recordedStdout === stdout && recordedStderr === stderr;
}

/**
 * The sequence for two streams, or `undefined` where none was recorded.
 *
 * Output with nothing in it is trivially in order, which lets a caller join
 * two sequences whenever both sides are known -- and drop to `undefined`, the
 * stdout-then-stderr fallback, as soon as either is not. Chunks are never
 * synthesized from the strings alone: their shape (`kind`) is not recoverable
 * from the text, and guessing it wrong re-encodes bytes as if they were
 * Unicode.
 */
export function orderedOutput(
  chunks: OutputChunk[] | undefined,
  stdout: string,
  stderr: string,
): OutputChunk[] | undefined {
  if (stdout === "" && stderr === "") return [];
  return chunksDescribe(chunks, stdout, stderr) ? chunks : undefined;
}

/**
 * A sequence for output built here rather than relayed from a child -- a
 * diagnostic, a shell message. Its shape is known to be JS text, which is
 * what lets it be described where `orderedOutput` declines to guess.
 */
export function textChunks(stdout: string, stderr: string): OutputChunk[] {
  const chunks: OutputChunk[] = [];
  if (stdout) chunks.push({ stream: "stdout", text: stdout, kind: "text" });
  if (stderr) chunks.push({ stream: "stderr", text: stderr, kind: "text" });
  return chunks;
}

/**
 * One descriptor's worth of text, built from pieces that may not share a
 * shape.
 *
 * A byte-shaped piece is a latin1 buffer of bytes already chosen; a
 * text-shaped one is JS Unicode whose bytes are chosen when it is written.
 * Concatenating the two would leave a string that is neither, so a mixed run
 * settles on bytes and encodes the Unicode pieces to UTF-8 first. Pieces that
 * already agree are joined untouched.
 */
export function joinChunkTexts(pieces: { text: string; kind: OutputKind }[]): {
  text: string;
  kind: OutputKind;
} {
  let hasBytes = false;
  let hasText = false;
  for (const piece of pieces) {
    if (piece.text === "") continue;
    if (piece.kind === "bytes") hasBytes = true;
    else hasText = true;
  }
  if (hasBytes && hasText) {
    return { text: chunksToBytes(pieces), kind: "bytes" };
  }
  return {
    text: pieces.map((piece) => piece.text).join(""),
    kind: hasBytes ? "bytes" : "text",
  };
}

/**
 * The pieces as one byte buffer, each encoded by its own shape -- what a pipe
 * carries, since the reading end sees bytes and nothing else.
 */
export function chunksToBytes(
  pieces: { text: string; kind: OutputKind }[],
): string {
  return pieces
    .map((piece) =>
      piece.kind === "bytes"
        ? piece.text
        : latin1FromBytes(encodeUtf8ToBytes(piece.text)),
    )
    .join("");
}

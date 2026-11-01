// Automa modifications: command-boundary streaming without replay or duplicate output.
import type { CommandNode } from "./ast/types.js";
import {
  decodeBytesToUtf8,
  decodedTextFromResult as normalize,
  unsafeBytesFromLatin1,
} from "./encoding.js";
import { outputSegments as segments } from "./execution-output.js";
import type { ExecutionScope } from "./execution-scope.js";
import type { InterpreterContext } from "./interpreter/types.js";
import type { ExecResult } from "./types.js";

type Stream = "stdout" | "stderr";
interface Part {
  text: string;
  stream: Stream;
  kind?: "text" | "bytes";
  emitted?: boolean;
}
const decode = (value: string) =>
  decodeBytesToUtf8(unsafeBytesFromLatin1(value));
export function createOutputSink(
  scope: ExecutionScope,
  callback?: (text: string, stream: Stream) => void | Promise<void>,
) {
  const counts = { stdout: 0, stderr: 0 };
  const chunks: string[] = [];
  // Output is an ordered byte stream even when one UTF-8 character spans
  // command/descriptor boundaries. Retain at most three undecided bytes; do
  // not buffer completed output or decode each incomplete fragment separately.
  let pending = "";
  let pendingStream: Stream | undefined;
  const width = (lead: number) =>
    lead >= 0xc2 && lead <= 0xdf
      ? 2
      : lead >= 0xe0 && lead <= 0xef
        ? 3
        : lead >= 0xf0 && lead <= 0xf4
          ? 4
          : 0;
  const continuation = (lead: number, position: number, byte: number) =>
    byte >= 0x80 &&
    byte <= 0xbf &&
    (position !== 1 ||
      ((lead !== 0xe0 || byte >= 0xa0) &&
        (lead !== 0xed || byte <= 0x9f) &&
        (lead !== 0xf0 || byte >= 0x90) &&
        (lead !== 0xf4 || byte <= 0x8f)));
  async function publish(text: string, stream: Stream = "stdout") {
    if (!text || scope.signal?.aborted) return;
    chunks.push(text);
    if (callback) await callback(text, stream);
  }
  async function flushPending() {
    const text = pending;
    const stream = pendingStream;
    pending = "";
    pendingStream = undefined;
    await publish(decode(text), stream);
  }
  async function write(text: string, stream: Stream) {
    if (pending) {
      const lead = pending.charCodeAt(0);
      let consumed = 0;
      while (
        consumed < text.length &&
        pending.length < width(lead) &&
        continuation(lead, pending.length, text.charCodeAt(consumed))
      )
        pending += text[consumed++];
      // An invalid continuation keeps the original decoder's byte fallback.
      // A complete character is attributed to its first byte's descriptor.
      if (pending.length === width(lead) || consumed < text.length)
        await flushPending();
      text = text.slice(consumed);
      if (!text || scope.signal?.aborted) return;
    }
    let end = text.length;
    for (let start = Math.max(0, end - 3); start < end; start++) {
      const lead = text.charCodeAt(start);
      const expected = width(lead);
      if (!expected || end - start >= expected) continue;
      let valid = true;
      for (let at = start + 1; at < end; at++)
        if (!continuation(lead, at - start, text.charCodeAt(at))) valid = false;
      if (!valid) continue;
      pending = text.slice(start);
      pendingStream = stream;
      end = start;
      break;
    }
    await publish(decode(text.slice(0, end)), stream);
  }
  let mask = { stdout: false, stderr: false };
  let current: { parts: Part[]; depth: number } | undefined;
  let bufferedBatches = 0;
  function complete(parts: Part[], result: ExecResult) {
    if (!parts.length)
      for (const [stream, text, kind] of segments(result))
        parts.push({ text, stream, kind, emitted: false });
    const joined = { stdout: "", stderr: "" };
    for (const part of parts) joined[part.stream] += part.text;
    for (const stream of ["stdout", "stderr"] as const) {
      const value = stream === "stdout" ? normalize(result) : result.stderr;
      let previous = joined[stream];
      // Upstream accumulators can retain raw bytes or a decoded child string.
      // Compare their exact representation before appending wrapper diagnostics;
      // never infer the encoding of a new output segment from its characters.
      if (
        previous &&
        !value.startsWith(previous) &&
        !value.endsWith(previous)
      ) {
        let shown = "";
        let bytes = "";
        for (const part of parts) {
          if (part.stream !== stream) continue;
          if (part.kind === "bytes") bytes += part.text;
          else {
            shown += decode(bytes) + part.text;
            bytes = "";
          }
        }
        shown += decode(bytes);
        if (shown && (value.startsWith(shown) || value.endsWith(shown)))
          previous = shown;
      }
      if (value.length <= previous.length) continue;
      const prefix = previous && value.endsWith(previous);
      const text = prefix
        ? value.slice(0, -previous.length)
        : value.slice(previous.length);
      const part: Part = { text, stream, kind: "text", emitted: false };
      if (prefix) parts.unshift(part);
      else parts.push(part);
    }
    return parts;
  }
  async function emit(part: Part) {
    const { text, stream } = part;
    if (!text || part.emitted || mask[stream] || scope.signal?.aborted) return;
    part.emitted = true;
    counts[stream] += text.length;
    if (part.kind === "bytes") await write(text, stream);
    else {
      await flushPending();
      await publish(text, stream);
    }
  }
  return {
    async capture(
      ctx: InterpreterContext,
      command: CommandNode,
      execute: () => Promise<ExecResult>,
    ) {
      if (bufferedBatches) return execute();
      const previous = mask;
      const parent = current;
      const frame: { parts: Part[]; depth: number } = {
        parts: [],
        depth: ctx.substitutionDepth ?? 0,
      };
      current = frame;
      // Compound redirects are resolved after the buffered body. Hold its
      // descendants until that exact upstream route has been applied.
      if (command.redirections?.length || frame.depth > 0)
        mask = { stdout: true, stderr: true };
      const propagate = () => {
        if (!parent) return;
        for (const part of frame.parts) {
          if (frame.depth > parent.depth && part.stream === "stdout") continue;
          parent.parts.push(part);
        }
      };
      try {
        let result = await execute();
        result = scope.accountResult(result, "output sink");
        complete(frame.parts, result);
        mask = frame.depth > 0 ? { stdout: true, stderr: true } : previous;
        for (const part of frame.parts) await emit(part);
        propagate();
        return result;
      } catch (error) {
        propagate();
        throw error;
      } finally {
        mask = previous;
        current = parent;
      }
    },
    route(
      result: ExecResult,
      stdout: { kind: string },
      stderr: { kind: string },
    ) {
      if (!current || bufferedBatches) return;
      const routed: Part[] = [];
      for (const part of complete(current.parts, result)) {
        const target = part.stream === "stdout" ? stdout : stderr;
        if (target.kind !== "live-stdout" && target.kind !== "live-stderr")
          continue;
        const stream = target.kind === "live-stdout" ? "stdout" : "stderr";
        routed.push(stream === part.stream ? part : { ...part, stream });
      }
      current.parts = routed;
    },
    async pipeline(
      intermediate: boolean,
      pipeStderr: boolean,
      execute: () => Promise<ExecResult>,
    ) {
      if (bufferedBatches) return execute();
      const previous = mask;
      const parent = current;
      const start = parent?.parts.length ?? 0;
      if (intermediate) {
        mask = { stdout: true, stderr: previous.stderr || pipeStderr };
      }
      try {
        return await execute();
      } finally {
        mask = previous;
        if (intermediate && parent) {
          const consumed = parent.parts.splice(start);
          if (!pipeStderr)
            for (const part of consumed)
              if (part.stream === "stderr") parent.parts.push(part);
        }
      }
    },
    async buffer<T>(execute: () => Promise<T>) {
      bufferedBatches++;
      try {
        return await execute();
      } finally {
        bufferedBatches--;
      }
    },
    async finish<T extends ExecResult>(
      result: T,
    ): Promise<T & { output: string }> {
      // A fatal command may have buffered partial stdout that never reached fd1
      // (for example an exhausted awk before a pipe). Keep it in stdout as
      // failure evidence; do not publish it as terminal output.
      if (!result.executionFailure)
        await emit({
          text: normalize(result).slice(counts.stdout),
          stream: "stdout",
        });
      await emit({
        text: result.stderr.slice(counts.stderr),
        stream: "stderr",
      });
      await flushPending();
      return { ...result, output: chunks.join("") };
    },
  };
}

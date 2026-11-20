// Automa modifications: N5b shared bounded checksum input, work and output.
import { BoundedStringBuilder } from "../../bounded-builder.js";
import { latin1FromBytes } from "../../encoding.js";
import type { ResourceLease } from "../../execution-scope.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { _setTimeout } from "../../timers.js";
import type {
  ExecResult,
  OutputSegment,
  RuntimeCommandContext,
} from "../../types.js";

export interface ChecksumIO {
  check(units?: number): void;
  reserve(bytes: number): ResourceLease;
  pause(units?: number): Promise<void>;
  limit(kind: string): never;
  read(file: string): Promise<{ bytes: Uint8Array; release(): void }>;
  append(stream: "stdout" | "stderr", text: string): void;
  result(exitCode: number): ExecResult;
  dispose(): void;
}

export function checksumIO(
  ctx: RuntimeCommandContext,
  name: string,
): ChecksumIO {
  const scope = ctx.executionScope;
  let input = 0,
    work = 0,
    live = 0,
    stdinRead = false;
  const retained: ResourceLease[] = [];
  const limit = (kind: string): never => {
    scope?.consumeLimited(`${name} ${kind}`, 1, 0, name);
    throw new ExecutionLimitError(
      `${name}: ${kind} resource limit exceeded`,
      "string_length",
    );
  };
  const check = (units = 1) => {
    scope?.throwIfAborted(name);
    ctx.signal?.throwIfAborted();
    work += units;
    if (work > ctx.limits.maxWorkUnits) limit("work");
    scope?.consumeWork(units, name);
  };
  const reserve = (bytes: number): ResourceLease => {
    check();
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > ctx.limits.maxLiveBytes - live
    )
      limit("memory");
    const lease = scope?.reserveBytes(bytes, name);
    live += bytes;
    let released = false;
    return {
      release() {
        if (!released) {
          released = true;
          live -= bytes;
          lease?.release();
        }
      },
    };
  };
  const consume = (bytes: number) => {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > ctx.limits.maxInputBytes - input
    )
      limit("input");
    scope?.consumeInput(bytes, name);
    input += bytes;
  };
  const pause = async (units = 1) => {
    check(units);
    await new Promise<void>((resolve) => _setTimeout(resolve, 0));
    check();
  };
  const maximum = Math.min(
    ctx.limits.maxOutputSize,
    ctx.limits.maxStringLength,
  );
  const stdout = new BoundedStringBuilder(maximum, name, () => limit("output"));
  const stderr = new BoundedStringBuilder(maximum, name, () => limit("output"));
  const segments: OutputSegment[] = [];
  return {
    check,
    reserve,
    pause,
    limit,
    async read(file: string) {
      check();
      const path = ctx.fs.resolvePath(ctx.cwd, file);
      const raw =
        file === "-"
          ? stdinRead
            ? ""
            : latin1FromBytes(ctx.stdin)
          : undefined;
      if (raw !== undefined) stdinRead = true;
      const size =
        raw !== undefined ? raw.length : (await ctx.fs.stat(path)).size;
      check();
      consume(size);
      const leases = [reserve(size + 256)];
      try {
        let bytes: Uint8Array;
        if (raw !== undefined) {
          bytes = new Uint8Array(raw.length);
          for (let at = 0; at < raw.length; at += 65536) {
            await pause(1 + Math.ceil(Math.min(65536, raw.length - at) / 64));
            for (
              let index = at;
              index < Math.min(at + 65536, raw.length);
              index++
            )
              bytes[index] = raw.charCodeAt(index);
          }
        } else bytes = await ctx.fs.readFileBuffer(path);
        check();
        if (bytes.length > size) {
          consume(bytes.length - size);
          leases.push(reserve(bytes.length - size));
        }
        return {
          bytes,
          release() {
            for (const lease of leases) lease.release();
          },
        };
      } catch (error) {
        for (const lease of leases) lease.release();
        throw error;
      }
    },
    append(stream: "stdout" | "stderr", text: string) {
      check(1 + Math.ceil(text.length / 1024));
      if (segments.length >= ctx.limits.maxArrayElements)
        limit("output segments");
      retained.push(reserve(text.length * 4 + 32));
      (stream === "stdout" ? stdout : stderr).append(text);
      if (stdout.byteLength + stderr.byteLength > ctx.limits.maxOutputSize)
        limit("output");
      segments.push([stream, text]);
    },
    result(exitCode: number): ExecResult {
      check();
      return {
        stdout: stdout.build(),
        stderr: stderr.build(),
        exitCode,
        internalOutputSegments: segments,
      };
    },
    dispose() {
      for (const lease of retained) lease.release();
    },
  };
}

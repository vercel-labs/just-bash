import type { ByteString } from "../encoding.js";
import type { RuntimeCommandContext } from "../types.js";

export interface CommandStdio {
  /** Whether stdin is connected to an upstream stage, including an empty pipe. */
  readonly hasInput: boolean;
  read(): Promise<ByteString | null>;
  readAll(): Promise<ByteString>;
  write(chunk: ByteString): Promise<void>;
}

export async function readCommandStdin(
  ctx: RuntimeCommandContext,
): Promise<ByteString> {
  return ctx.stdio ? ctx.stdio.readAll() : ctx.stdin;
}

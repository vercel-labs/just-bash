import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { SecureFetch } from "../../network/fetch.js";
import type { CommandExecOptions, ExecResult } from "../../types.js";
import { BridgeHandler } from "./bridge-handler.js";
import {
  createSharedBuffer,
  OpCode,
  type OpCodeType,
  ProtocolBuffer,
  Status,
} from "./protocol.js";

async function sendOp(
  protocol: ProtocolBuffer,
  opCode: OpCodeType,
  opts?: { path?: string; data?: string; flags?: number },
): Promise<number> {
  protocol.reset();
  protocol.setOpCode(opCode);
  protocol.setPath(opts?.path ?? "");
  protocol.setFlags(opts?.flags ?? 0);
  if (opts?.data !== undefined) {
    protocol.setDataFromString(opts.data);
  }
  protocol.setStatus(Status.READY);
  protocol.notify();

  for (let i = 0; i < 1000; i++) {
    const status = protocol.getStatus();
    if (status === Status.SUCCESS || status === Status.ERROR) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("sendOp timed out waiting for bridge response");
}

describe("BridgeHandler raceDeadline", () => {
  it("HTTP_REQUEST resolves with error when secureFetch never settles", async () => {
    const shared = createSharedBuffer();
    const protocol = new ProtocolBuffer(shared);
    const neverSettle: SecureFetch = () => new Promise<never>(() => {});
    const handler = new BridgeHandler(
      shared,
      new InMemoryFs(),
      "/",
      "test-cmd",
      neverSettle,
    );
    const runPromise = handler.run(200);

    const status = await sendOp(protocol, OpCode.HTTP_REQUEST, {
      path: "https://example.com",
      data: JSON.stringify({ method: "GET" }),
    });

    expect(status).toBe(Status.ERROR);
    const errMsg = protocol.getResultAsString();
    expect(errMsg).toContain("timed out");

    const result = await runPromise;
    expect(result.exitCode).toBe(124);
  });

  it("EXEC_COMMAND resolves with error when exec never settles", async () => {
    const shared = createSharedBuffer();
    const protocol = new ProtocolBuffer(shared);
    const neverSettle: (
      command: string,
      options: CommandExecOptions,
    ) => Promise<ExecResult> = () => new Promise<never>(() => {});
    const handler = new BridgeHandler(
      shared,
      new InMemoryFs(),
      "/",
      "test-cmd",
      undefined,
      0,
      neverSettle,
    );
    const runPromise = handler.run(200);

    const status = await sendOp(protocol, OpCode.EXEC_COMMAND, {
      path: "echo hello",
    });

    expect(status).toBe(Status.ERROR);
    const errMsg = protocol.getResultAsString();
    expect(errMsg).toContain("timed out");

    const result = await runPromise;
    expect(result.exitCode).toBe(124);
  });
});

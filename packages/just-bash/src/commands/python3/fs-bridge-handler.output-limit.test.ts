import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { BridgeHandler } from "../worker-bridge/bridge-handler.js";
import {
  createSharedBuffer,
  OpCode,
  type OpCodeType,
  ProtocolBuffer,
  Status,
} from "../worker-bridge/protocol.js";

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

  for (let i = 0; i < 200; i++) {
    const status = protocol.getStatus();
    if (status === Status.SUCCESS || status === Status.ERROR) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("sendOp timed out waiting for bridge response");
}

describe("BridgeHandler output limits", () => {
  it("passes through stdout/stderr when total output stays within limit", async () => {
    const shared = createSharedBuffer();
    const protocol = new ProtocolBuffer(shared);
    const handler = new BridgeHandler(
      shared,
      new InMemoryFs(),
      "/",
      "python3",
      undefined,
      128,
    );
    const runPromise = handler.run(1000);

    await sendOp(protocol, OpCode.WRITE_STDOUT, { data: "A".repeat(40) });
    await sendOp(protocol, OpCode.WRITE_STDERR, { data: "B".repeat(30) });
    await sendOp(protocol, OpCode.EXIT, { flags: 0 });

    const result = await runPromise;
    expect(result.stdout).toBe("A".repeat(40));
    expect(result.stderr).toBe("B".repeat(30));
    expect(result.exitCode).toBe(0);
  });

  it("enforces aggregate output cap incrementally and exits with error", async () => {
    const shared = createSharedBuffer();
    const protocol = new ProtocolBuffer(shared);
    const handler = new BridgeHandler(
      shared,
      new InMemoryFs(),
      "/",
      "python3",
      undefined,
      128,
    );
    const runPromise = handler.run(1000);

    const s1 = await sendOp(protocol, OpCode.WRITE_STDOUT, {
      data: "X".repeat(100),
    });
    expect(s1).toBe(Status.SUCCESS);
    const s2 = await sendOp(protocol, OpCode.WRITE_STDOUT, {
      data: "Y".repeat(50),
    });
    expect(s2).toBe(Status.ERROR);
    const s3 = await sendOp(protocol, OpCode.WRITE_STDERR, {
      data: "Z".repeat(20),
    });
    expect(s3).toBe(Status.ERROR);
    await sendOp(protocol, OpCode.EXIT, { flags: 0 });

    const result = await runPromise;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("python3: total output size exceeded");
    expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(
      128,
    );
  });
});

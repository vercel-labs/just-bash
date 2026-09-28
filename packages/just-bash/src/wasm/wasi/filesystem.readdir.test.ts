import { describe, expect, it } from "vitest";
import { createCommandContext } from "../../custom-commands.js";
import { ExecutionScope } from "../../execution-scope.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import { resolveLimits } from "../../limits.js";
import { WasiFileSystem } from "./filesystem.js";

const limits = {
  timeoutMs: 1000,
  maxFileBytes: 1024,
  maxMemoryBytes: 65536,
  maxModuleBytes: 1024,
  maxTableElements: 100,
};
const decoder = new TextDecoder();

async function entry(
  bridge: WasiFileSystem,
  cookie: number,
): Promise<{ name: string; next: number } | null> {
  return JSON.parse(
    decoder.decode(
      await bridge.request({ type: "request", op: "readdir", fd: 3, cookie }),
    ),
  ) as { name: string; next: number } | null;
}

describe("WASI directory enumeration", () => {
  it("enumerates once across cookies and refreshes after a namespace change", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [`/file-${index}`, ""]),
    );
    const fs = new InMemoryFs(files);
    const original = fs.readdir.bind(fs);
    let scans = 0;
    fs.readdir = async (path) => {
      scans++;
      return original(path);
    };
    const maxLiveBytes = 64 * 1024;
    const scope = new ExecutionScope(resolveLimits({ maxLiveBytes }));
    const bridge = new WasiFileSystem(
      createCommandContext({ fs, executionScope: scope }),
      limits,
    );
    try {
      const names: string[] = [];
      for (let cookie = 0; cookie < 80; cookie++) {
        const current = await entry(bridge, cookie);
        if (!current) throw new Error("Missing directory entry");
        names.push(current.name);
        expect(current.next).toBe(cookie + 1);
      }
      expect(names).toEqual((await original("/")).sort());
      expect(await entry(bridge, 80)).toBeNull();
      expect(scans).toBe(1);
      expect(scope.remainingLiveBytes).toBeLessThan(maxLiveBytes);

      await bridge.request({
        type: "request",
        op: "mkdir",
        fd: 3,
        path: "new",
      });
      expect((await entry(bridge, 80))?.name).toBe("new");
      expect(scans).toBe(2);

      await bridge.request({ type: "request", op: "close", fd: 3 });
      expect(scope.remainingLiveBytes).toBe(maxLiveBytes);
    } finally {
      bridge.close();
    }
  });

  it("releases an open directory snapshot when execution closes", async () => {
    const maxLiveBytes = 1024;
    const scope = new ExecutionScope(resolveLimits({ maxLiveBytes }));
    const bridge = new WasiFileSystem(
      createCommandContext({
        fs: new InMemoryFs({ "/file": "" }),
        executionScope: scope,
      }),
      limits,
    );
    try {
      expect((await entry(bridge, 0))?.name).toBe("file");
      expect(scope.remainingLiveBytes).toBeLessThan(maxLiveBytes);
    } finally {
      bridge.close();
    }
    expect(scope.remainingLiveBytes).toBe(maxLiveBytes);
  });
});

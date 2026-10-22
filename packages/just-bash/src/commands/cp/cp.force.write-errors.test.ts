import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ReadWriteFs } from "../../fs/read-write-fs/read-write-fs.js";

describe("cp -f with real filesystem failures", () => {
  let root: string;

  function setup(): Bash {
    root = nodeFs.mkdtempSync(path.join(os.tmpdir(), "cp-force-write-"));
    nodeFs.writeFileSync(path.join(root, "src.txt"), "new\n");
    nodeFs.writeFileSync(path.join(root, "dst.txt"), "old\n");
    return new Bash({ fs: new ReadWriteFs({ root }), cwd: "/" });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    nodeFs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    "ENOSPC",
    "EDQUOT",
    "EIO",
    "EACCES",
  ])("keeps the existing destination after a %s staging write failure", async (code) => {
    const bash = setup();
    const originalOpen = nodeFs.promises.open.bind(nodeFs.promises);
    vi.spyOn(nodeFs.promises, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).includes(".just-bash-write-")) {
        vi.spyOn(handle, "write").mockRejectedValue(
          Object.assign(new Error("staging write failed"), { code }),
        );
      }
      return handle;
    });

    const result = await bash.exec("cp -f src.txt dst.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `cp: cannot copy 'src.txt': ${code}: cp '/src.txt'\n`,
    );
    expect(result.exitCode).toBe(1);
    expect(nodeFs.readFileSync(path.join(root, "dst.txt"), "utf8")).toBe(
      "old\n",
    );
    expect(nodeFs.readdirSync(root).sort()).toEqual(["dst.txt", "src.txt"]);
  });

  it.each([
    "EACCES",
    "ETXTBSY",
  ])("retries a confirmed %s destination-open failure", async (code) => {
    const bash = setup();
    const originalOpen = nodeFs.promises.open.bind(nodeFs.promises);
    let failed = false;
    vi.spyOn(nodeFs.promises, "open").mockImplementation(async (...args) => {
      if (!failed && args[0] === path.join(root, "dst.txt")) {
        failed = true;
        throw Object.assign(new Error("destination open failed"), { code });
      }
      return originalOpen(...args);
    });

    const result = await bash.exec("cp -fv src.txt dst.txt");

    expect(result.stdout).toBe("'src.txt' -> '/dst.txt'\nremoved '/dst.txt'\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(failed).toBe(true);
    expect(nodeFs.readFileSync(path.join(root, "dst.txt"), "utf8")).toBe(
      "new\n",
    );
  });
});

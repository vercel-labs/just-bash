import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { CopyDestinationOpenError } from "../../fs/copy-errors.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "../../fs/interface.js";

/**
 * A filesystem whose `cp` fails the way ReadWriteFs reports failures, and
 * whose source read can fail too. `once` makes the first copy fail and lets
 * the retry through, as a destination that was removed would.
 */
function withFailures(
  fs: IFileSystem,
  failures: { cp: string | Error; once?: boolean; read?: string },
): { fs: IFileSystem; calls: { cp: number } } {
  const calls = { cp: 0 };
  const proxy = new Proxy(fs, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      if (prop === "cp") {
        return async (...args: unknown[]) => {
          calls.cp++;
          if (calls.cp === 1 || !failures.once) {
            throw typeof failures.cp === "string"
              ? new Error(failures.cp)
              : failures.cp;
          }
          return value.apply(target, args);
        };
      }
      if (prop === "readFileBuffer" && failures.read !== undefined) {
        return async () => {
          throw new Error(failures.read);
        };
      }
      return value.bind(target);
    },
  }) as IFileSystem;
  return { fs: proxy, calls };
}

function setup(failures: {
  cp: string | Error;
  once?: boolean;
  read?: string;
}) {
  const { fs, calls } = withFailures(
    new InMemoryFs({ "/src.txt": "new\n", "/dst.txt": "old\n" }),
    failures,
  );
  return { bash: new Bash({ fs, cwd: "/" }), calls };
}

describe("cp -f after a failed copy", () => {
  it("replaces the destination after a plain open failure", async () => {
    const { bash, calls } = setup({
      cp: new CopyDestinationOpenError("ETXTBSY", "/dst.txt"),
      once: true,
    });

    const result = await bash.exec("cp -fv src.txt dst.txt");

    expect(result.stdout).toBe("'src.txt' -> '/dst.txt'\nremoved '/dst.txt'\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await bash.readFile("/dst.txt")).toBe("new\n");
    expect(calls.cp).toBe(2);
  });

  it("does not retry when the destination does not exist", async () => {
    const { bash, calls } = setup({ cp: "ENOENT: cp '/src.txt'", once: true });

    const result = await bash.exec("cp -f src.txt dst.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "cp: cannot stat 'src.txt': No such file or directory\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await bash.readFile("/dst.txt")).toBe("old\n");
    expect(calls.cp).toBe(1);
  });

  it("does not retry a refusal the filesystem explains", async () => {
    const { bash, calls } = setup({
      cp: "EACCES: destination changed, cp '/dst.txt'",
      once: true,
    });

    const result = await bash.exec("cp -f src.txt dst.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "cp: cannot copy 'src.txt': EACCES: destination changed, cp '/dst.txt'\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await bash.readFile("/dst.txt")).toBe("old\n");
    expect(calls.cp).toBe(1);
  });

  it("keeps the destination when the source is gone", async () => {
    const { bash, calls } = setup({
      cp: new CopyDestinationOpenError("EACCES", "/dst.txt"),
      once: true,
      read: "ENOENT: no such file or directory, read '/src.txt'",
    });

    const result = await bash.exec("cp -f src.txt dst.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "cp: cannot stat 'src.txt': No such file or directory\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await bash.readFile("/dst.txt")).toBe("old\n");
    expect(calls.cp).toBe(1);
  });

  it("keeps the destination when the source read fails", async () => {
    const { bash, calls } = setup({
      cp: new CopyDestinationOpenError("EACCES", "/dst.txt"),
      once: true,
      read: "EIO: i/o error, read '/src.txt'",
    });

    const result = await bash.exec("cp -f src.txt dst.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "cp: cannot copy 'src.txt': EIO: i/o error, read '/src.txt'\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await bash.readFile("/dst.txt")).toBe("old\n");
    expect(calls.cp).toBe(1);
  });

  it("still replaces the destination past a read limit", async () => {
    const { bash, calls } = setup({
      cp: new CopyDestinationOpenError("EACCES", "/dst.txt"),
      once: true,
      read: "EFBIG: file too large, read '/src.txt' (4 bytes, max 1)",
    });

    const result = await bash.exec("cp -f src.txt dst.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await bash.readFile("/dst.txt")).toBe("new\n");
    expect(calls.cp).toBe(2);
  });
});

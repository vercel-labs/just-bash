import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadWriteFs } from "./read-write-fs.js";

describe.skipIf(process.platform === "win32")(
  "ReadWriteFs special-file metadata operations",
  () => {
    let root: string;
    let rwfs: ReadWriteFs;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-special-"));
      rwfs = new ReadWriteFs({ root });
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("chmod preserves a FIFO instead of opening or replacing it", async () => {
      const fifo = path.join(root, "events.fifo");
      execFileSync("mkfifo", [fifo]);

      await rwfs.chmod("/events.fifo", 0o600);

      const stat = fs.lstatSync(fifo);
      expect(stat.isFIFO()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it("utimes preserves a FIFO and changes only its timestamps", async () => {
      const fifo = path.join(root, "events.fifo");
      const changed = new Date("2020-07-01T00:00:00.000Z");
      execFileSync("mkfifo", [fifo]);

      await rwfs.utimes("/events.fifo", changed, changed);

      const stat = fs.lstatSync(fifo);
      expect(stat.isFIFO()).toBe(true);
      expect(stat.mtimeMs).toBe(changed.getTime());
    });

    it("does not let FIFO metadata operations wedge later mutations", async () => {
      const fifo = path.join(root, "events.fifo");
      execFileSync("mkfifo", [fifo]);

      await rwfs.chmod("/events.fifo", 0o640);
      await rwfs.writeFile("/after.txt", "completed");

      expect(fs.lstatSync(fifo).isFIFO()).toBe(true);
      expect(fs.readFileSync(path.join(root, "after.txt"), "utf8")).toBe(
        "completed",
      );
    });

    it("rejects FIFO content writes without blocking later mutations", async () => {
      const fifo = path.join(root, "events.fifo");
      execFileSync("mkfifo", [fifo]);

      await expect(rwfs.writeFile("/events.fifo", "data")).rejects.toThrow(
        "cannot write special file",
      );
      await expect(rwfs.appendFile("/events.fifo", "data")).rejects.toThrow(
        "cannot append special file",
      );
      await rwfs.writeFile("/after.txt", "completed");

      expect(fs.lstatSync(fifo).isFIFO()).toBe(true);
      expect(fs.readFileSync(path.join(root, "after.txt"), "utf8")).toBe(
        "completed",
      );
    });

    it("rejects copying over a FIFO without replacing it", async () => {
      const fifo = path.join(root, "events.fifo");
      execFileSync("mkfifo", [fifo]);
      fs.writeFileSync(path.join(root, "source.txt"), "data");

      await expect(rwfs.cp("/source.txt", "/events.fifo")).rejects.toThrow(
        "cannot copy over special file '/events.fifo'",
      );

      expect(fs.lstatSync(fifo).isFIFO()).toBe(true);
    });

    it("rejects a recursive copy onto a nested FIFO", async () => {
      fs.mkdirSync(path.join(root, "source"));
      fs.mkdirSync(path.join(root, "destination"));
      fs.writeFileSync(path.join(root, "source/payload.txt"), "data");
      const fifo = path.join(root, "destination/payload.txt");
      execFileSync("mkfifo", [fifo]);

      await expect(
        rwfs.cp("/source", "/destination", { recursive: true }),
      ).rejects.toThrow(
        "cannot copy over special file '/destination/payload.txt'",
      );

      expect(fs.lstatSync(fifo).isFIFO()).toBe(true);
    });

    it("refuses metadata mutation through a multiply-linked FIFO", async () => {
      const fifo = path.join(root, "events.fifo");
      const alias = path.join(root, "events-alias.fifo");
      execFileSync("mkfifo", [fifo]);
      fs.linkSync(fifo, alias);
      const originalMode = fs.lstatSync(alias).mode & 0o777;

      await expect(rwfs.chmod("/events.fifo", 0o600)).rejects.toThrow(
        "cannot chmod multiply-linked special file",
      );
      await expect(rwfs.writeFile("/events.fifo", "data")).rejects.toThrow(
        "cannot write special file",
      );
      await expect(rwfs.appendFile("/events.fifo", "data")).rejects.toThrow(
        "cannot append special file",
      );

      expect(fs.lstatSync(fifo).isFIFO()).toBe(true);
      expect(fs.lstatSync(alias).isFIFO()).toBe(true);
      expect(fs.lstatSync(alias).mode & 0o777).toBe(originalMode);
    });

    it("preserves a Unix socket during chmod and utimes", async () => {
      const socketPath = path.join(root, "service.sock");
      const changed = new Date("2020-08-01T00:00:00.000Z");
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });

      try {
        await rwfs.chmod("/service.sock", 0o600);
        await rwfs.utimes("/service.sock", changed, changed);

        const stat = fs.lstatSync(socketPath);
        expect(stat.isSocket()).toBe(true);
        expect(stat.mode & 0o777).toBe(0o600);
        expect(stat.mtimeMs).toBe(changed.getTime());
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  },
);

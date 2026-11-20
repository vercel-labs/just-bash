import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import { MountableFs } from "./mountable-fs.js";

describe("MountableFs routing", () => {
  it.each([
    ["/mnt/data", "/mnt/database"],
    ["/mnt/database", "/mnt/data"],
  ])("routes sibling prefixes when mounting %s before %s", async (first, second) => {
    const fs = new MountableFs({
      base: new InMemoryFs({ "/mnt/dataset/file.txt": "base" }),
    });
    const data = new InMemoryFs({ "/file.txt": "data" });
    const database = new InMemoryFs({ "/file.txt": "database" });

    for (const mountPoint of [first, second]) {
      fs.mount(mountPoint, mountPoint === "/mnt/data" ? data : database);
    }

    expect(await fs.readFile("/mnt/data/file.txt")).toBe("data");
    expect(await fs.readFile("/mnt/database/file.txt")).toBe("database");
    expect(await fs.readFile("/mnt/dataset/file.txt")).toBe("base");
  });

  it("isolates returned mount descriptors from registrations", async () => {
    const original = new InMemoryFs({ "/file.txt": "original" });
    const fs = new MountableFs();
    fs.mount("/mnt/data", original);

    const descriptor = fs.getMounts()[0];
    expect(descriptor.filesystem).toBe(original);
    descriptor.mountPoint = "/mnt/other";
    descriptor.filesystem = new InMemoryFs({ "/file.txt": "replacement" });

    expect(await fs.readFile("/mnt/data/file.txt")).toBe("original");
    const freshDescriptor = fs.getMounts()[0];
    expect(freshDescriptor.mountPoint).toBe("/mnt/data");
    expect(freshDescriptor.filesystem).toBe(original);
  });
});

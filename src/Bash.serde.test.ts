/**
 * Tests for Bash and InMemoryFs serialization/deserialization
 * with Workflow DevKit's serde protocol.
 *
 * Important: In just-bash, each exec() call is isolated - shell variables
 * do not persist across exec calls by design. Only filesystem state persists.
 */

import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./fs/in-memory-fs/in-memory-fs.js";
import { Bash } from "./index.js";

describe("Bash serde", () => {
  it("should roundtrip Bash instance with filesystem state", async () => {
    // Create and populate a Bash instance
    const bash1 = new Bash();
    await bash1.exec("mkdir -p /data");
    await bash1.exec('echo "hello world" > /data/test.txt');

    // Serialize
    const serialized = Bash[WORKFLOW_SERIALIZE](bash1);

    // Verify serialized structure
    expect(serialized).toHaveProperty("fs");
    expect(serialized).toHaveProperty("state");
    expect(serialized).toHaveProperty("limits");

    // Deserialize
    const bash2 = Bash[WORKFLOW_DESERIALIZE](serialized);

    // Verify filesystem state preserved
    const result1 = await bash2.exec("cat /data/test.txt");
    expect(result1.stdout).toBe("hello world\n");

    // Verify cwd preserved
    expect(bash2.getCwd()).toBe(bash1.getCwd());
  });

  it("should preserve filesystem changes across serialization cycles", async () => {
    let bash = new Bash();

    // Cycle 1: Create file
    await bash.exec('echo "v1" > /data/counter.txt');
    bash = Bash[WORKFLOW_DESERIALIZE](Bash[WORKFLOW_SERIALIZE](bash));

    // Cycle 2: Append
    await bash.exec('echo "v2" >> /data/counter.txt');
    bash = Bash[WORKFLOW_DESERIALIZE](Bash[WORKFLOW_SERIALIZE](bash));

    // Cycle 3: Append again
    await bash.exec('echo "v3" >> /data/counter.txt');
    bash = Bash[WORKFLOW_DESERIALIZE](Bash[WORKFLOW_SERIALIZE](bash));

    // Verify accumulated filesystem state
    const result = await bash.exec("cat /data/counter.txt");
    expect(result.stdout).toBe("v1\nv2\nv3\n");
  });

  it("should preserve execution limits in serialized data", () => {
    const bash1 = new Bash({
      executionLimits: {
        maxLoopIterations: 50,
        maxCallDepth: 10,
        maxCommandCount: 500,
      },
    });

    const serialized = Bash[WORKFLOW_SERIALIZE](bash1);

    // Verify limits are in serialized data
    expect(serialized.limits.maxLoopIterations).toBe(50);
    expect(serialized.limits.maxCallDepth).toBe(10);
    expect(serialized.limits.maxCommandCount).toBe(500);

    // Deserialize and verify
    const bash2 = Bash[WORKFLOW_DESERIALIZE](serialized);

    // Basic functionality still works after deserialize
    // (commands work because constructor registers them)
    expect(bash2.getCwd()).toBe(bash1.getCwd());
  });

  it("should preserve environment variables set via options", async () => {
    const bash1 = new Bash({
      env: { CUSTOM_VAR: "hello" },
    });

    const serialized = Bash[WORKFLOW_SERIALIZE](bash1);
    const bash2 = Bash[WORKFLOW_DESERIALIZE](serialized);

    // Verify env is preserved
    const env = bash2.getEnv();
    expect(env.CUSTOM_VAR).toBe("hello");
  });

  it("should preserve working directory", async () => {
    const bash1 = new Bash({ cwd: "/tmp/myproject" });

    const serialized = Bash[WORKFLOW_SERIALIZE](bash1);
    const bash2 = Bash[WORKFLOW_DESERIALIZE](serialized);

    expect(bash2.getCwd()).toBe("/tmp/myproject");
  });
});

describe("InMemoryFs serde", () => {
  it("should roundtrip InMemoryFs with files and directories", async () => {
    const fs1 = new InMemoryFs();
    await fs1.mkdir("/test/nested", { recursive: true });
    await fs1.writeFile("/test/file.txt", "content");
    await fs1.writeFile("/test/nested/deep.txt", "deep content");

    // Serialize
    const serialized = InMemoryFs[WORKFLOW_SERIALIZE](fs1);

    // Verify serialized structure
    expect(serialized).toHaveProperty("data");
    expect(serialized.data).toBeInstanceOf(Map);

    // Deserialize
    const fs2 = InMemoryFs[WORKFLOW_DESERIALIZE](serialized);

    // Verify files preserved
    expect(await fs2.readFile("/test/file.txt")).toBe("content");
    expect(await fs2.readFile("/test/nested/deep.txt")).toBe("deep content");
    expect(await fs2.exists("/test/nested")).toBe(true);
  });

  it("should preserve file metadata", async () => {
    const fs1 = new InMemoryFs();
    await fs1.writeFile("/test.txt", "content");
    await fs1.chmod("/test.txt", 0o755);

    const serialized = InMemoryFs[WORKFLOW_SERIALIZE](fs1);
    const fs2 = InMemoryFs[WORKFLOW_DESERIALIZE](serialized);

    const stat = await fs2.stat("/test.txt");
    expect(stat.mode).toBe(0o755);
  });

  it("should preserve symlinks", async () => {
    const fs1 = new InMemoryFs();
    await fs1.writeFile("/original.txt", "content");
    await fs1.symlink("/original.txt", "/link.txt");

    const serialized = InMemoryFs[WORKFLOW_SERIALIZE](fs1);
    const fs2 = InMemoryFs[WORKFLOW_DESERIALIZE](serialized);

    // Verify symlink works
    expect(await fs2.readFile("/link.txt")).toBe("content");
    expect(await fs2.readlink("/link.txt")).toBe("/original.txt");
  });

  it("should preserve binary content", async () => {
    const fs1 = new InMemoryFs();
    const binary = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe]);
    fs1.writeFileSync("/binary.bin", binary);

    const serialized = InMemoryFs[WORKFLOW_SERIALIZE](fs1);
    const fs2 = InMemoryFs[WORKFLOW_DESERIALIZE](serialized);

    const content = await fs2.readFileBuffer("/binary.bin");
    expect(content).toEqual(binary);
  });
});

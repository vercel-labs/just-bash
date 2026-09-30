import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(__dirname, "..");

interface PackResult {
  files: Array<{ path: string }>;
}

interface PackageManifest {
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

describe("published package declarations", () => {
  it("keeps native codecs opt-in", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(packageRoot, "package.json"), "utf8"),
    ) as PackageManifest;

    expect(manifest.optionalDependencies).toBeUndefined();
    expect(manifest.peerDependencies).toMatchObject({
      "@mongodb-js/zstd": "^7.0.0",
      "node-liblzma": "^2.2.0",
    });
    expect(manifest.peerDependenciesMeta).toMatchObject({
      "@mongodb-js/zstd": { optional: true },
      "node-liblzma": { optional: true },
    });
  });

  it("includes declaration trees referenced by public declarations", async () => {
    const npmCache = await mkdtemp(resolve(tmpdir(), "just-bash-npm-cache-"));

    try {
      const { stdout } = await execFileAsync(
        "npm",
        ["pack", "--dry-run", "--json", "--ignore-scripts"],
        {
          cwd: packageRoot,
          env: { ...process.env, npm_config_cache: npmCache },
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      const [pack] = JSON.parse(stdout) as PackResult[];
      const files = new Set(pack.files.map((file) => file.path));

      expect(files.has("dist/security/index.d.ts")).toBe(true);
      expect(files.has("dist/security/types.d.ts")).toBe(true);
      expect(files.has("dist/transform/pipeline.d.ts")).toBe(true);
      expect(files.has("dist/transform/plugins/command-collector.d.ts")).toBe(
        true,
      );
      expect(files.has("dist/transform/plugins/tee-plugin.d.ts")).toBe(true);
    } finally {
      await rm(npmCache, { recursive: true, force: true });
    }
  }, 30_000);
});

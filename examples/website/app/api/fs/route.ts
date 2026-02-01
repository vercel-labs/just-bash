import { readdir, readFile } from "fs/promises";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

export const dynamic = "force-static";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DATA_DIR = join(__dirname, "../agent/_agent-data");

// Recursively read all files in a directory
async function readAllFiles(
  dir: string,
  baseDir: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const subFiles = await readAllFiles(fullPath, baseDir);
      Object.assign(result, subFiles);
    } else if (entry.isFile()) {
      // Only include common text file extensions
      const ext = entry.name.split(".").pop()?.toLowerCase();
      const textExtensions = [
        "ts",
        "tsx",
        "js",
        "jsx",
        "mjs",
        "cjs",
        "json",
        "md",
        "txt",
        "yml",
        "yaml",
        "toml",
        "css",
        "scss",
        "html",
        "sh",
        "bash",
        "zsh",
        "py",
        "rb",
        "go",
        "rs",
        "c",
        "h",
        "cpp",
        "hpp",
        "java",
        "xml",
        "svg",
        "env",
        "gitignore",
        "npmignore",
        "eslintrc",
        "prettierrc",
      ];
      // Also allow dotfiles without extensions and known config files
      const isTextFile =
        (ext && textExtensions.includes(ext)) ||
        entry.name.startsWith(".") ||
        entry.name === "LICENSE" ||
        entry.name === "Makefile" ||
        entry.name === "Dockerfile";
      if (!isTextFile) {
        continue;
      }

      try {
        const content = await readFile(fullPath, "utf-8");
        // Use path relative to agent-data as the key, with leading /
        const relativePath = relative(baseDir, fullPath);
        result[relativePath] = content;
      } catch {
        // Skip files that can't be read as UTF-8
      }
    }
  }

  return result;
}

export async function GET() {
  const files = await readAllFiles(AGENT_DATA_DIR, AGENT_DATA_DIR);

  return new Response(JSON.stringify(files), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=172800, s-maxage=172800",
    },
  });
}

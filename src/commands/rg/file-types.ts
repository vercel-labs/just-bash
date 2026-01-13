/**
 * Built-in file type definitions for rg
 *
 * Maps type names to file extensions and glob patterns.
 * Based on ripgrep's default type definitions.
 */

export interface FileType {
  extensions: string[];
  globs: string[];
}

/**
 * Built-in file type definitions
 * Use `rg --type-list` to see all types in real ripgrep
 */
export const FILE_TYPES: Record<string, FileType> = {
  // Web languages
  js: { extensions: [".js", ".mjs", ".cjs", ".jsx"], globs: [] },
  ts: { extensions: [".ts", ".tsx", ".mts", ".cts"], globs: [] },
  html: { extensions: [".html", ".htm", ".xhtml"], globs: [] },
  css: { extensions: [".css", ".scss", ".sass", ".less"], globs: [] },
  json: { extensions: [".json", ".jsonc", ".json5"], globs: [] },
  xml: { extensions: [".xml", ".xsl", ".xslt"], globs: [] },

  // Systems languages
  c: { extensions: [".c", ".h"], globs: [] },
  cpp: {
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"],
    globs: [],
  },
  rust: { extensions: [".rs"], globs: [] },
  go: { extensions: [".go"], globs: [] },
  zig: { extensions: [".zig"], globs: [] },

  // JVM languages
  java: { extensions: [".java"], globs: [] },
  kotlin: { extensions: [".kt", ".kts"], globs: [] },
  scala: { extensions: [".scala", ".sc"], globs: [] },
  clojure: { extensions: [".clj", ".cljc", ".cljs", ".edn"], globs: [] },

  // Scripting languages
  py: { extensions: [".py", ".pyi", ".pyw"], globs: [] },
  rb: {
    extensions: [".rb", ".rake", ".gemspec"],
    globs: ["Rakefile", "Gemfile"],
  },
  php: { extensions: [".php", ".phtml", ".php3", ".php4", ".php5"], globs: [] },
  perl: { extensions: [".pl", ".pm", ".pod", ".t"], globs: [] },
  lua: { extensions: [".lua"], globs: [] },

  // Shell
  sh: {
    extensions: [".sh", ".bash", ".zsh", ".fish"],
    globs: [".bashrc", ".zshrc", ".profile"],
  },
  bat: { extensions: [".bat", ".cmd"], globs: [] },
  ps: { extensions: [".ps1", ".psm1", ".psd1"], globs: [] },

  // Data/Config
  yaml: { extensions: [".yaml", ".yml"], globs: [] },
  toml: { extensions: [".toml"], globs: ["Cargo.toml", "pyproject.toml"] },
  ini: { extensions: [".ini", ".cfg", ".conf"], globs: [] },
  csv: { extensions: [".csv", ".tsv"], globs: [] },

  // Documentation
  md: { extensions: [".md", ".markdown", ".mdown", ".mkd"], globs: [] },
  rst: { extensions: [".rst"], globs: [] },
  txt: { extensions: [".txt", ".text"], globs: [] },
  tex: { extensions: [".tex", ".ltx", ".sty", ".cls"], globs: [] },

  // Other
  sql: { extensions: [".sql"], globs: [] },
  graphql: { extensions: [".graphql", ".gql"], globs: [] },
  proto: { extensions: [".proto"], globs: [] },
  make: {
    extensions: [".mk", ".mak"],
    globs: ["Makefile", "GNUmakefile", "makefile"],
  },
  docker: {
    extensions: [],
    globs: ["Dockerfile", "Dockerfile.*", "*.dockerfile"],
  },
  tf: { extensions: [".tf", ".tfvars"], globs: [] },
};

/**
 * Check if a filename matches any of the specified types
 */
export function matchesType(filename: string, types: string[]): boolean {
  const lowerFilename = filename.toLowerCase();

  for (const typeName of types) {
    const fileType = FILE_TYPES[typeName];
    if (!fileType) continue;

    // Check extensions
    for (const ext of fileType.extensions) {
      if (lowerFilename.endsWith(ext)) {
        return true;
      }
    }

    // Check globs (simple exact match for now)
    for (const glob of fileType.globs) {
      if (glob.includes("*")) {
        // Simple glob matching
        const pattern = glob.replace(/\./g, "\\.").replace(/\*/g, ".*");
        if (new RegExp(`^${pattern}$`, "i").test(filename)) {
          return true;
        }
      } else if (lowerFilename === glob.toLowerCase()) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Format type list for --type-list output
 */
export function formatTypeList(): string {
  const lines: string[] = [];
  for (const [name, type] of Object.entries(FILE_TYPES).sort()) {
    const patterns: string[] = [];
    for (const ext of type.extensions) {
      patterns.push(`*${ext}`);
    }
    for (const glob of type.globs) {
      patterns.push(glob);
    }
    lines.push(`${name}: ${patterns.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

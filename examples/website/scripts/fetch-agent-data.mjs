#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { join } from "path";

const AGENT_DATA_DIR = "app/api/agent/agent-data";

const repos = [
  {
    url: "https://github.com/vercel-labs/just-bash.git",
    dir: "just-bash",
  },
  {
    url: "https://github.com/vercel-labs/bash-tool.git",
    dir: "bash-tool",
  },
];

// Clean and create agent-data directory
if (existsSync(AGENT_DATA_DIR)) {
  rmSync(AGENT_DATA_DIR, { recursive: true });
}

for (const repo of repos) {
  const targetDir = join(AGENT_DATA_DIR, repo.dir);
  console.log(`Cloning ${repo.url} into ${targetDir}...`);

  execSync(
    `git clone --depth 1 --single-branch ${repo.url} ${targetDir}`,
    { stdio: "inherit" }
  );

  // Remove .git directory to save space
  const gitDir = join(targetDir, ".git");
  if (existsSync(gitDir)) {
    rmSync(gitDir, { recursive: true });
  }
}

console.log("Agent data fetched successfully.");

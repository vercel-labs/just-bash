// Use child_process to run shell commands, parse their output, and build a report
const fs = require("node:fs");
const { execSync, spawnSync } = require("node:child_process");

// Gather system info via shell commands
var hostname = execSync("hostname").trim();
var whoami = execSync("whoami").trim();
var pwd = execSync("pwd").trim();
var envOutput = execSync("env").trim();

// Parse env output into a map
var envLines = envOutput.split("\n");
var envVars = {};
for (let i = 0; i < envLines.length; i++) {
  const line = envLines[i];
  const eqIdx = line.indexOf("=");
  if (eqIdx > 0) {
    envVars[line.substring(0, eqIdx)] = line.substring(eqIdx + 1);
  }
}

// List files in current directory
var lsResult = spawnSync("ls", ["-la"]);
var files = lsResult.stdout.trim().split("\n").slice(1); // skip "total" line

var report = {
  hostname: hostname,
  user: whoami,
  cwd: pwd,
  envCount: Object.keys(envVars).length,
  shell: envVars.SHELL || "unknown",
  home: envVars.HOME || "unknown",
  fileCount: files.length,
  files: files.map((line) => {
    var parts = line.split(/\s+/);
    return {
      permissions: parts[0],
      name: parts[parts.length - 1],
    };
  }),
};

fs.writeFileSync("/tmp/system-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

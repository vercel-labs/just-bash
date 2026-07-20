import { readdir, readFile } from "node:fs/promises";

const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
const workflowFiles = (await readdir(workflowDirectory))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .sort();
const errors = [];

function indentation(line) {
  return line.length - line.trimStart().length;
}

for (const filename of workflowFiles) {
  const source = await readFile(new URL(filename, workflowDirectory), "utf8");
  const lines = source.split(/\r?\n/);
  const jobsLine = lines.indexOf("jobs:");
  if (jobsLine < 0) {
    errors.push(`${filename}: missing jobs section`);
    continue;
  }

  const hasWorkflowPermissions = lines
    .slice(0, jobsLine)
    .some((line) => line === "permissions:" || /^permissions:\s*\{/.test(line));

  for (let index = jobsLine + 1; index < lines.length; index++) {
    const jobMatch = lines[index].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (!jobMatch) continue;
    const end = lines.findIndex(
      (line, candidate) =>
        candidate > index && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line),
    );
    const jobLines = lines.slice(index + 1, end < 0 ? lines.length : end);
    const hasJobPermissions = jobLines.some(
      (line) =>
        line === "    permissions:" || /^ {4}permissions:\s*\{/.test(line),
    );
    if (!hasWorkflowPermissions && !hasJobPermissions) {
      errors.push(
        `${filename}: job ${jobMatch[1]} has no explicit permissions`,
      );
    }
  }

  for (let index = 0; index < lines.length; index++) {
    const usesMatch = lines[index].match(
      /^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/,
    );
    if (!usesMatch) continue;
    const reference = usesMatch[1];
    if (reference.startsWith("./")) continue;
    if (!/^[^/@]+\/[^/@]+(?:\/[^@]+)?@[0-9a-f]{40}$/.test(reference)) {
      errors.push(
        `${filename}:${index + 1}: external action is not pinned to a full SHA: ${reference}`,
      );
    }

    if (!reference.startsWith("actions/checkout@")) continue;
    const stepIndent = indentation(lines[index]);
    let end = index + 1;
    while (
      end < lines.length &&
      (lines[end].trim() === "" || indentation(lines[end]) > stepIndent)
    ) {
      end++;
    }
    const checkoutStep = lines.slice(index + 1, end);
    if (
      !checkoutStep.some((line) =>
        /^\s+persist-credentials:\s*false\s*$/.test(line),
      )
    ) {
      errors.push(
        `${filename}:${index + 1}: checkout must set persist-credentials: false`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${workflowFiles.length} workflows: security policy passed`,
  );
}

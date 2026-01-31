/**
 * Bash Workflow Example
 *
 * Demonstrates using just-bash with Workflow DevKit's serialization.
 * The Bash instance is serialized between steps, preserving filesystem state.
 *
 * When this file is processed during workflow discovery, the bundler uses
 * the "workflow" export condition which provides an opaque Bash handle.
 * When step functions run, they use the real Bash implementation.
 */

import { Bash } from "just-bash";

export async function serialBashWorkflow() {
  "use workflow";

  // Step 1: Create bash instance and initialize
  let bash = await createBash();
  console.log(bash);

  // Steps 2-4: Serial steps that modify filesystem
  bash = await appendToLog(bash, "step2");
  bash = await appendToLog(bash, "step3");
  bash = await appendToLog(bash, "step4");

  // Step 5: Get final results
  return await getResults(bash);
}

async function createBash() {
  "use step";
  console.log(Bash);
  console.log((Bash as any).classId);
  const bash = new Bash();
  await bash.exec("mkdir -p /data");
  await bash.exec('echo "created" > /data/log.txt');
  console.log("Created Bash instance with /data/log.txt");
  return bash;
}

async function appendToLog(bash: Bash, label: string) {
  "use step";
  await bash.exec(`echo "${label}: modified" >> /data/log.txt`);
  console.log(`Appended ${label} to log`);
  return bash;
}

async function getResults(bash: Bash) {
  "use step";
  const result = await bash.exec("cat /data/log.txt");
  console.log("Read final results");
  return { log: result.stdout };
}

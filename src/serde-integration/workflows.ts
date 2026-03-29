/**
 * Workflow functions for serde integration tests.
 *
 * These workflows pass Bash/InMemoryFs instances directly between steps.
 * The workflow runtime automatically handles serialization at step boundaries
 * via the WORKFLOW_SERIALIZE/WORKFLOW_DESERIALIZE symbols registered on each class.
 *
 * No manual toJSON()/fromJSON() calls — the serde mechanism is exercised implicitly.
 */
import {
  createBashWithCwd,
  createBashWithEnv,
  createBashWithLimits,
  createBashWithProcessInfo,
  createBasicBash,
  createDefaultBash,
  createInMemoryFs,
  createInMemoryFsWithBinary,
  execAndReturnBash,
  execInBash,
  readFsContent,
} from "./steps.js";

export async function basicSerdeWorkflow() {
  "use workflow";
  // Step 1: create Bash (returns class instance)
  const bash = await createBasicBash();
  // Step 2: exec — Bash is serialized → deserialized at boundary
  const result = await execInBash(bash, "cat /home/user/test.txt");
  return { stdout: result.stdout, exitCode: result.exitCode };
}

export async function filesystemSurvivesStepBoundaryWorkflow() {
  "use workflow";
  const bash = await createBashWithCwd("/home/user");
  // Step A: write file, return mutated Bash
  const { bash: bash1 } = await execAndReturnBash(
    bash,
    "cat > /home/user/output.txt << 'HEREDOC'\nstep-written-content\nHEREDOC",
  );
  // Step B: read back (bash1 was serialized between steps)
  const result = await execInBash(bash1, "cat /home/user/output.txt");
  return { stdout: result.stdout, exitCode: result.exitCode };
}

export async function envVarsSurviveStepBoundaryWorkflow() {
  "use workflow";
  const bash = await createBashWithEnv({
    FOO: "bar",
    SPECIAL: 'hello "world" & <baz>',
  });
  const foo = await execInBash(bash, 'printf "%s" "$FOO"');
  const special = await execInBash(bash, 'printf "%s" "$SPECIAL"');
  return { foo: foo.stdout, special: special.stdout };
}

export async function executionLimitsSurviveWorkflow() {
  "use workflow";
  const bash = await createBashWithLimits(3);
  const result = await execInBash(
    bash,
    "for i in 1 2 3 4 5 6 7 8 9 10; do echo $i; done",
  );
  return { exitCode: result.exitCode, stderr: result.stderr };
}

export async function cwdPreservedWorkflow() {
  "use workflow";
  const bash = await createBashWithCwd("/tmp");
  const result = await execInBash(bash, "pwd");
  return { stdout: result.stdout };
}

export async function processInfoPreservedWorkflow() {
  "use workflow";
  const bash = await createBashWithProcessInfo({
    pid: 42,
    ppid: 1,
    uid: 500,
    gid: 500,
  });
  const pid = await execInBash(bash, "echo $$");
  const uid = await execInBash(bash, "echo $UID");
  return { pid: pid.stdout, uid: uid.stdout };
}

export async function systemFilesRecreatedWorkflow() {
  "use workflow";
  const bash = await createDefaultBash();
  const result = await execInBash(bash, "echo test > /dev/null && echo ok");
  return { stdout: result.stdout, exitCode: result.exitCode };
}

export async function inMemoryFsStandaloneWorkflow() {
  "use workflow";
  const fs = await createInMemoryFs({
    "/data/config.json": '{"key": "value"}',
    "/data/readme.txt": "Hello, world!",
  });
  const config = await readFsContent(fs, "/data/config.json");
  const readme = await readFsContent(fs, "/data/readme.txt");
  return { config, readme };
}

export async function multipleStepBoundariesWorkflow() {
  "use workflow";
  const bash = await createBashWithCwd("/home/user");
  // 3 consecutive step boundaries
  const { bash: bash1 } = await execAndReturnBash(
    bash,
    "cat > /home/user/step1.txt << 'HEREDOC'\none\nHEREDOC",
  );
  const { bash: bash2 } = await execAndReturnBash(
    bash1,
    "cat > /home/user/step2.txt << 'HEREDOC'\ntwo\nHEREDOC",
  );
  const result = await execInBash(
    bash2,
    "cat /home/user/step1.txt && echo '---' && cat /home/user/step2.txt",
  );
  return { stdout: result.stdout, exitCode: result.exitCode };
}

export async function binaryContentWorkflow() {
  "use workflow";
  const fs = await createInMemoryFsWithBinary(
    "/binary.bin",
    new Uint8Array([0x00, 0x01, 0xff, 0x80]),
  );
  const content = await readFsContent(fs, "/binary.bin");
  return { content };
}

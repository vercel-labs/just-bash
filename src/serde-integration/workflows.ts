/**
 * Workflow functions for serde integration tests.
 *
 * These workflows exercise Bash/InMemoryFs serialization through the workflow
 * runtime. The serialized forms (SerializedBash, SerializedInMemoryFs) use only
 * devalue-compatible types and flow through the workflow context as plain data.
 *
 * The pattern: step A creates + serializes → workflow passes data → step B
 * deserializes + operates. Each step boundary forces the data through the
 * workflow runtime's serialization layer (devalue), validating that all types
 * in the serialized form survive the round-trip.
 */
import {
  createAndSerializeBash,
  createAndSerializeInMemoryFs,
  createInMemoryFsWithBinaryAndSerialize,
  deserializeAndExec,
  deserializeExecAndReserialize,
  deserializeFsAndRead,
} from "./steps.js";

export async function basicSerdeWorkflow() {
  "use workflow";
  const serialized = await createAndSerializeBash({
    files: { "/home/user/test.txt": "hello from workflow" },
    env: { WF_VAR: "workflow-value" },
    cwd: "/home/user",
  });
  // serialized passes through workflow runtime (devalue round-trip)
  const result = await deserializeAndExec(serialized, "cat /home/user/test.txt");
  return { stdout: result.stdout, exitCode: result.exitCode };
}

export async function filesystemSurvivesStepBoundaryWorkflow() {
  "use workflow";
  const serialized = await createAndSerializeBash({ cwd: "/home/user" });
  // Step A: exec a write, then re-serialize
  const { serialized: afterWrite } = await deserializeExecAndReserialize(
    serialized,
    "cat > /home/user/output.txt << 'HEREDOC'\nstep-written-content\nHEREDOC",
  );
  // Step B: deserialize and read back (data crossed 2 step boundaries)
  const result = await deserializeAndExec(afterWrite, "cat /home/user/output.txt");
  return { stdout: result.stdout, exitCode: result.exitCode };
}

export async function envVarsSurviveStepBoundaryWorkflow() {
  "use workflow";
  const serialized = await createAndSerializeBash({
    env: {
      FOO: "bar",
      SPECIAL: 'hello "world" & <baz>',
    },
  });
  // Two separate step boundaries — serialized data flows through workflow each time
  const foo = await deserializeAndExec(serialized, 'printf "%s" "$FOO"');
  const special = await deserializeAndExec(serialized, 'printf "%s" "$SPECIAL"');
  return { foo: foo.stdout, special: special.stdout };
}

export async function executionLimitsSurviveWorkflow() {
  "use workflow";
  const serialized = await createAndSerializeBash({ maxCommandCount: 3 });
  const result = await deserializeAndExec(
    serialized,
    "for i in 1 2 3 4 5 6 7 8 9 10; do echo $i; done",
  );
  return { exitCode: result.exitCode, stderr: result.stderr };
}

export async function cwdPreservedWorkflow() {
  "use workflow";
  const serialized = await createAndSerializeBash({ cwd: "/tmp" });
  const result = await deserializeAndExec(serialized, "pwd");
  return { stdout: result.stdout };
}

export async function processInfoPreservedWorkflow() {
  "use workflow";
  const serialized = await createAndSerializeBash({
    processInfo: { pid: 42, ppid: 1, uid: 500, gid: 500 },
  });
  const pid = await deserializeAndExec(serialized, "echo $$");
  const uid = await deserializeAndExec(serialized, "echo $UID");
  return { pid: pid.stdout, uid: uid.stdout };
}

export async function systemFilesRecreatedWorkflow() {
  "use workflow";
  const serialized = await createAndSerializeBash({});
  // Lazy entries (/dev/null) excluded from serde → recreated on fromJSON
  const result = await deserializeAndExec(
    serialized,
    "echo test > /dev/null && echo ok",
  );
  return { stdout: result.stdout, exitCode: result.exitCode };
}

export async function inMemoryFsStandaloneWorkflow() {
  "use workflow";
  const serialized = await createAndSerializeInMemoryFs({
    "/data/config.json": '{"key": "value"}',
    "/data/readme.txt": "Hello, world!",
  });
  // SerializedInMemoryFs flows through workflow runtime
  const config = await deserializeFsAndRead(serialized, "/data/config.json");
  const readme = await deserializeFsAndRead(serialized, "/data/readme.txt");
  return { config, readme };
}

export async function multipleStepBoundariesWorkflow() {
  "use workflow";
  const serialized = await createAndSerializeBash({ cwd: "/home/user" });

  // 3 consecutive step boundaries, each re-serializing
  const { serialized: s1 } = await deserializeExecAndReserialize(
    serialized,
    "cat > /home/user/step1.txt << 'HEREDOC'\none\nHEREDOC",
  );
  const { serialized: s2 } = await deserializeExecAndReserialize(
    s1,
    "cat > /home/user/step2.txt << 'HEREDOC'\ntwo\nHEREDOC",
  );
  const result = await deserializeAndExec(
    s2,
    "cat /home/user/step1.txt && echo '---' && cat /home/user/step2.txt",
  );
  return { stdout: result.stdout, exitCode: result.exitCode };
}

export async function binaryContentWorkflow() {
  "use workflow";
  const serialized = await createInMemoryFsWithBinaryAndSerialize(
    "/binary.bin",
    new Uint8Array([0x00, 0x01, 0xff, 0x80]),
  );
  // Uint8Array in SerializedInMemoryFs must survive devalue round-trip
  const content = await deserializeFsAndRead(serialized, "/binary.bin");
  return { content };
}

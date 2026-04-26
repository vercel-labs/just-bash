# Comparison Tests

Comparison tests validate that just-bash produces the same output as real bash. They use a **fixture-based system** that records bash outputs once and replays them during tests, eliminating platform-specific differences.

## How It Works

1. **Fixtures** are JSON files containing recorded bash outputs (`src/comparison-tests/fixtures/*.fixtures.json`)
2. **Tests** run commands in just-bash and compare against the recorded fixtures
3. **Record mode** runs real bash and saves outputs to fixtures

## Running Tests

```bash
# Run all comparison tests (uses fixtures, no real bash needed)
pnpm test:comparison

# Run a specific test file
pnpm test:run src/comparison-tests/ls.comparison.test.ts

# Re-record fixtures (runs real bash, skips locked fixtures)
pnpm test:comparison:record
# Or: RECORD_FIXTURES=1 pnpm test:comparison

# Force re-record ALL fixtures including locked ones
RECORD_FIXTURES=force pnpm test:comparison
```

## Adding New Tests

### 1. Add the test case

```typescript
// src/comparison-tests/mycommand.comparison.test.ts
import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("mycommand - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should do something", async () => {
    const env = await setupFiles(testDir, {
      "input.txt": "hello world\n",
    });
    await compareOutputs(env, testDir, "mycommand input.txt");
  });
});
```

### 2. Record the fixture

```bash
RECORD_FIXTURES=1 pnpm test:run src/comparison-tests/mycommand.comparison.test.ts
```

This creates `src/comparison-tests/fixtures/mycommand.comparison.fixtures.json`.

### 3. Commit both the test and fixture file

## Updating Fixtures

When bash behavior changes or you need to update expected outputs:

```bash
# Re-record specific test file
RECORD_FIXTURES=1 pnpm test:run src/comparison-tests/ls.comparison.test.ts

# Re-record all fixtures
pnpm test:comparison:record
```

## Handling Platform Differences

The fixture system solves platform differences (macOS vs Linux):

1. **Record once** on any platform
2. **Manually adjust** the fixture to match desired behavior (usually Linux)
3. **Lock the fixture** to prevent accidental overwriting
4. Tests then pass on all platforms

Example: `ls -R` outputs differently on macOS vs Linux:
- macOS: `dir\nfile.txt\n...`
- Linux: `.:\ndir\nfile.txt\n...` (includes ".:" header)

We record on macOS, then edit the fixture to use Linux behavior since our implementation follows Linux.

## Locked Fixtures

Fixtures that have been manually adjusted for platform-specific behavior should be marked as **locked** to prevent accidental overwriting when re-recording:

```json
{
  "fixture_id": {
    "command": "ls -R",
    "files": { ... },
    "stdout": ".:\ndir\nfile.txt\n...",
    "stderr": "",
    "exitCode": 0,
    "locked": true
  }
}
```

When recording:
- `RECORD_FIXTURES=1` skips locked fixtures and reports them
- `RECORD_FIXTURES=force` overwrites all fixtures including locked ones

Currently locked fixtures:
- `ls -R` - Uses Linux-style output with ".:" header
- `cat -n` with multiple files - Uses continuous line numbering (Linux behavior)

## API Reference

### `setupFiles(testDir, files)`

Sets up test files in both real filesystem and BashEnv.

```typescript
const env = await setupFiles(testDir, {
  "file.txt": "content",
  "dir/nested.txt": "nested content",
});
```

### `compareOutputs(env, testDir, command, options?)`

Compares just-bash output against recorded fixture.

```typescript
// Basic usage
await compareOutputs(env, testDir, "cat file.txt");

// With options
await compareOutputs(env, testDir, "wc -l file.txt", {
  normalizeWhitespace: true,  // For BSD/GNU whitespace differences
  compareExitCode: false,     // Skip exit code comparison
});
```

### `runRealBash(command, cwd)`

Runs a command in real bash (for tests that need direct bash access).

```typescript
const result = await runRealBash("echo hello", testDir);
// result: { stdout, stderr, exitCode }
```

## Fixture File Format

```json
{
  "fixture_id_hash": {
    "command": "ls -la",
    "files": {
      "file.txt": "content"
    },
    "stdout": "file.txt\n",
    "stderr": "",
    "exitCode": 0
  }
}
```

The fixture ID is a hash of (command + files), ensuring each unique test case has its own fixture entry.

## Best Practices

1. **Keep tests focused** - One behavior per test
2. **Use meaningful file content** - Makes debugging easier
3. **Test edge cases** - Empty files, special characters, etc.
4. **Use `normalizeWhitespace`** for commands with platform-specific formatting (wc, column widths)
5. **Commit fixtures** - They're part of the test suite
6. **Re-record when needed** - If you change test files/commands, re-record the fixtures

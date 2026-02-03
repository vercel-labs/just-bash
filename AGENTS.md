# Agent instructions

- use `pnpm dev:exec` for evaluating scripts using BashEnv during development. See Debugging info below.
- Install packages via pnpm rather than editing package.json directly
- Bias towards making new test files that are roughly logically grouped rather than letting test files gets too large. Try to stay below 300 lines. Prefer making a new file when you want to add a `describe()`
- Prefer asserting the full STDOUT/STDERR output rather than using toContain or not.toContain
- Always also add `comparison-tests` for major command functionality, but edge cases should always be covered in unit tests which are mush faster (`pnpm test:comparison`)
- When you are unsure about bash/command behavior, create a `comparison-tests` test file to ensure compat.
- `--help` does not need to pass comparison tests and should reflect actual capability
- Commands must handle unknown arguments correctly
- Always ensure all tests pass in the end and there are no compile and lint errors
- Use `pnpm lint:fix`
- Always also run `pnpm knip`
- Strongly prefer running a temporary comparison test or unit test over an ad-hoc script to figure out the behavior of some bash script or API.
- The implementation should align with the real behavior of bash, not what is convenient for TS or TE tests.
- Always make sure to build before using dist
- Biome rules often have the same name as eslint rules (if you are lookinf for one)
- Error / show usage on unknown flags in commands and built-ins (unless real bash also ignores)
- Dependencies that use wasm are not allowed (exception: sql.js for SQLite, approved for security sandboxing). Binary npm packages are fine
- When you implement multiple tasks (such as multiple commands or builtins or discovered bugs), so them one at a time, create tests, validate, and then move on
- Running tests does not require building first

## Debugging

- Don't use `cat > test-direct.ts << 'SCRIPT'` style test scripts because they constantly require 1-off approval.
- Instead use `pnpm dev:exec`
  - use `--real-bash` to also get comparison output from the system bash
  - use `--print-ast` to also print the AST of the program as parsed by our parser.ts

## Commands

- Must have usage statement
- Must error on unknown options (unless bash ignores them)
- Must have extensive unit tests collocated with the command
- Should have comparison tests if there is doubt about behavior

## Interpreter

- We explicitly don't support 64bit integers
- Must never hang. All parsing and execution should have reasonable max limits to avoid runaway compute.

## Prototype Pollution Defense

User-controlled data (stdin, arguments, file content, HTTP headers, environment variables) can become JavaScript object keys. To prevent prototype pollution attacks:

### Rules

1. **Always use `Object.create(null)` for objects with user-controlled keys:**
   ```typescript
   // BAD - vulnerable to prototype pollution
   const obj: Record<string, string> = {};
   obj[userKey] = value;  // userKey could be "__proto__" or "constructor"

   // GOOD - safe from prototype pollution
   const obj: Record<string, string> = Object.create(null);
   obj[userKey] = value;  // null-prototype prevents prototype chain access
   ```

2. **Use `Map<string, T>` instead of plain objects when possible** - Maps don't have prototype pollution issues.

3. **Use helper functions from `src/helpers/env.ts`:**
   - `mapToRecord()` - safely converts Map to null-prototype Record
   - `mapToRecordWithExtras()` - same but merges extra properties
   - `mergeToNullPrototype()` - safely merges objects

4. **Use safe-object utilities from `src/commands/query-engine/safe-object.ts`:**
   - `isSafeKey()` - checks if key is safe (not `__proto__`, `constructor`, `prototype`)
   - `safeSet()` - sets property only if key is safe
   - `safeFromEntries()` - creates null-prototype object from entries

### Common Vulnerable Patterns

- HTTP header parsing (curl, fetch responses)
- CSV/JSON/YAML parsing where keys come from data
- Command argument parsing
- Environment variable handling
- AWK/jq variable and array storage

### Testing

Add prototype pollution tests for any code that stores user-controlled keys:
- Test with keywords: `constructor`, `__proto__`, `prototype`, `hasOwnProperty`, `toString`, `valueOf`
- Verify `Object.prototype` is not modified after processing
- See existing tests in `src/interpreter/prototype-pollution.test.ts` and `src/commands/*/prototype-pollution.test.ts`

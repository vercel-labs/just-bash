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
- Strongly prefer running a temporary comparison test or unit test over an ad-hoc script to figure out the behavior of some bash script or API.
- The implementation should align with the real behavior of bash, not what is convenient for TS or TE tests.
- Always make sure to build before using dist
- Biome rules often have the same name as eslint rules (if you are lookinf for one)
- Error / show usage on unknown flags in commands and built-ins (unless real bash also ignores)
- Dependencies that use wasm are not allowed. Binary npm packages are fine
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

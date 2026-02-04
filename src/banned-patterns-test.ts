/**
 * This file exists solely to test that the banned-patterns lint script
 * correctly detects all patterns and that ignore comments work properly.
 *
 * DO NOT import or use this file anywhere - it's only for lint verification.
 * Each pattern below would be flagged without its corresponding ignore comment.
 */

// Pattern 1: Record<string, T> variable declaration
// @banned-pattern-ignore: test file for banned-patterns script
const _recordTest: Record<string, number> = { a: 1 };

// Pattern 2: Empty object literal assignment
// @banned-pattern-ignore: test file for banned-patterns script
const _emptyObjTest: { [key: string]: number } = {};

// Pattern 3: eval() usage
// @banned-pattern-ignore: test file for banned-patterns script
// biome-ignore lint/security/noGlobalEval: intentional test
const _evalTest: () => unknown = () => eval("1+1");

// Pattern 4: new Function() constructor
// @banned-pattern-ignore: test file for banned-patterns script
const _funcTest: (...args: never) => unknown = new Function("return 1") as (
  ...args: never
) => unknown;

// Pattern 5: for...in loop
// @banned-pattern-ignore: test file for banned-patterns script
for (const key in _recordTest) {
  void key;
}

// Pattern 6: Direct __proto__ access
// @banned-pattern-ignore: test file for banned-patterns script
const _protoTest: unknown = ({} as { __proto__: unknown }).__proto__;

// Pattern 7: constructor.prototype access
// @banned-pattern-ignore: test file for banned-patterns script
const _ctorTest: object = {}.constructor.prototype;

// Make this a module
export {};

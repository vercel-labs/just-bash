import { createRequire } from "node:module";

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

// Pattern 8: Object.fromEntries() without null-prototype wrapper
// @banned-pattern-ignore: test file for banned-patterns script
const _fromEntriesTest: Record<string, unknown> = Object.fromEntries([
  ["a", 1],
]);

// Pattern 9: Array containing empty object literal
// @banned-pattern-ignore: test file for banned-patterns script
const _arrayEmptyObjectTest: object[] = [{}];

// Pattern 10: Metadata spread merge into plain object
// @banned-pattern-ignore: test file for banned-patterns script
let _metadataSpreadTest: Record<string, unknown> = Object.create(null);
_metadataSpreadTest = { ..._metadataSpreadTest, ...{ custom: true } };

// Pattern 11: Object.assign({}, ...) plain-object merge
// @banned-pattern-ignore: test file for banned-patterns script
const _objectAssignPlainTest: Record<string, unknown> = Object.assign(
  {},
  { a: 1 },
);

// Pattern 12: Direct obj.hasOwnProperty() call
// @banned-pattern-ignore: test file for banned-patterns script
// biome-ignore lint/suspicious/noPrototypeBuiltins: intentional banned-pattern test
const _directHasOwnPropertyTest: boolean = _recordTest.hasOwnProperty("a");

// Pattern 13: Dynamic Reflect property key
// @banned-pattern-ignore: test file for banned-patterns script
const _dynamicReflectKey = "polluted";
Reflect.set(_recordTest, _dynamicReflectKey, 1);

// Pattern 14: Dynamic defineProperty/descriptor key
// @banned-pattern-ignore: test file for banned-patterns script
const _dynamicDescriptorKey = "dynamic";
Object.defineProperty(_recordTest, _dynamicDescriptorKey, { value: 1 });

// Pattern 15: Prototype mutation API
// @banned-pattern-ignore: test file for banned-patterns script
Object.setPrototypeOf(_recordTest, null);

// Pattern 16: Dot-path reduce chain
// @banned-pattern-ignore: test file for banned-patterns script
const _dotPathReduce = "a.b".split(".").reduce((acc, part) => `${acc}.${part}`);

// Pattern 17: Reduce accumulator initialized with {}
// @banned-pattern-ignore: test file for banned-patterns script
const _reduceWithPlainObjectSeed = ["x"].reduce((acc) => acc, {});

// Pattern 18: Proxy.revocable() usage
const _proxyRevocableTest: {
  proxy: Record<string, unknown>;
  revoke: () => void;
} =
  // @banned-pattern-ignore: test file for banned-patterns script
  Proxy.revocable(Object.create(null), Object.create(null));

// Pattern 19: Dangerous global constructor shadowing
// @banned-pattern-ignore: test file for banned-patterns script
globalThis.Function = (() => 1) as never;

// Pattern 20: Dynamic import() with non-literal specifier
// @banned-pattern-ignore: test file for banned-patterns script
const _dynamicImportSpecifier = "./not-real-module.js";
void import(_dynamicImportSpecifier);

// Pattern 20b: Dynamic require() with non-literal specifier
const _dynamicRequireSpecifier = "child_process";
// @banned-pattern-ignore: test file for banned-patterns script
require(_dynamicRequireSpecifier);

// Pattern 21: createRequire() usage outside approved worker module
// @banned-pattern-ignore: test file for banned-patterns script
const _requireForPatternTest = createRequire(import.meta.url);

// Pattern 22: Module._load/_resolveFilename access
const _moduleLikeForPatternTest = {
  _load: () => "ok",
  _resolveFilename: () => "ok",
};
// @banned-pattern-ignore: test file for banned-patterns script
void _moduleLikeForPatternTest._load();
// @banned-pattern-ignore: test file for banned-patterns script
void _moduleLikeForPatternTest._resolveFilename();

// Pattern 23: Raw Record<string, unknown> cast in query engine
// Scoped to src/commands/query-engine/ via filePattern — tested by lint probe in value-operations.ts

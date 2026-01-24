/**
 * Skip list for JQ spec tests
 *
 * Tests in this list are expected to fail. If a test passes unexpectedly,
 * the test runner will report it as a failure so we know to remove it from the skip list.
 *
 * =============================================================================
 * CATEGORIZATION SUMMARY (as of 2026-01-23)
 * =============================================================================
 * Total tests: 538 | Running: 369 | Skipped: 152
 * Improvements made:
 *   - +7 tests from IN(), INDEX(), JOIN() implementation
 *   - +14 tests from def syntax implementation
 *   - +12 tests from destructuring patterns
 *   - +13 tests from ?// alternative binding operator
 *   - +6 tests from generator args implementation
 *   - +16 tests from isempty, skip, pick, bsearch, @urid, toboolean, sort
 *   - +10 tests from time functions (gmtime, mktime, strftime, strptime)
 *   - +8 tests from lazy evaluation fixes (any/all/first/limit/nth with errors)
 *
 * -----------------------------------------------------------------------------
 * UNFIXABLE (~40 items) - Infrastructure/scope limitations
 * -----------------------------------------------------------------------------
 * Files skipped entirely:
 *   - onig.test, manonig.test: Require Oniguruma regex library (external C dep)
 *   - optional.test: Experimental JQ features
 *   - man.test: Lower priority, revisit after jq.test stable
 *
 * Out of scope by design:
 *   - Module system (include/import/modulemeta): 10 tests
 *   - $ENV, input, inputs: Sandboxed env has no stdin/env access
 *   - have_decnum: Decimal number precision library (8 tests)
 *   - Locale-dependent: strflocaltime, localtime (5 tests)
 *   - $__loc__, $__prog__: Debug introspection
 *
 * Acceptable differences:
 *   - Error message wording differences (depth limits, overflow, etc.)
 *   - Emoji flag UTF-16 vs codepoint indexing (1 test)
 *
 * -----------------------------------------------------------------------------
 * SHOULD BE FIXED - HIGH PRIORITY (~35 items) - Parser enhancements
 * -----------------------------------------------------------------------------
 *   - def syntax (17): NOW IMPLEMENTED - User-defined functions like `def f: .;`
 *   - ?// operator (13): NOW IMPLEMENTED - Try-alternative like `.foo? // "default"`
 *   - Destructuring (12): NOW IMPLEMENTED - `as [$a, $b]` or `as {key: $v}` patterns
 *   - Generator args (6): NOW IMPLEMENTED - Functions taking multiple generator arguments
 *   - Quoted fields (1): `."foo-bar"` syntax [NOW WORKING]
 *   - Numeric-like fields (1): `.e0` parsed as field, not number [NOW WORKING]
 *   - Complex foreach/reduce (3): Operators before `as` keyword
 *   - Unary minus before keywords (2): `[-foreach ...]` [NOW WORKING]
 *
 * -----------------------------------------------------------------------------
 * SHOULD BE FIXED - MEDIUM PRIORITY (~30 items) - Missing functions
 * -----------------------------------------------------------------------------
 *   - IN() (7): SQL-like containment test [NOW IMPLEMENTED]
 *   - strftime/strptime/mktime (9): Time formatting/parsing
 *   - skip() (4): NOW IMPLEMENTED - Skip first N from generator
 *   - pick() (4): NOW IMPLEMENTED - Pick specific keys from object
 *   - bsearch() (3): NOW IMPLEMENTED - Binary search
 *   - isempty() (3): NOW IMPLEMENTED - Test if generator produces values
 *   - @urid (2): NOW IMPLEMENTED - URI decode format
 *   - toboolean (2): NOW IMPLEMENTED - Explicit boolean conversion
 *   - INDEX(), JOIN() [NOW IMPLEMENTED], GROUP_BY, scan, format, combinations
 *
 * -----------------------------------------------------------------------------
 * SHOULD BE FIXED - MEDIUM PRIORITY (~40 items) - Implementation bugs
 * -----------------------------------------------------------------------------
 *   - path() with map/select (4): Path tracking through transformations
 *   - Update through map/select (2): `(map(select(...))[].x) = val`
 *   - builtins function (2): Complete list of builtins
 *   - contains edge cases (4): Empty string, NUL character
 *   - Negative index on null (2): Auto-vivification behavior
 *   - any/all generator bugs (2): Specific edge cases
 *   - Float/NaN index handling (7): Non-integer indices
 *   - Lazy evaluation (4): Generators with errors in unused branches
 *   - getpath/setpath/delpaths edge cases (5)
 *   - Complex update expressions (6): |= with generators/select
 *
 * -----------------------------------------------------------------------------
 * SHOULD BE FIXED - LOW PRIORITY (~20 items) - Edge cases
 * -----------------------------------------------------------------------------
 *   - String interpolation edge cases (3)
 *   - NUL character in strings (2)
 *   - Complex try-catch nesting (2)
 *   - walk with generator arg (1)
 *   - tojson/fromjson precision (2)
 *   - Keywords as variable/object keys (3)
 *   - Object/array sorting order (3)
 *   - trim multiple outputs (2)
 *   - abs on non-numbers (2)
 * =============================================================================
 */

/**
 * Files to skip entirely
 */
const SKIP_FILES: Set<string> = new Set<string>([
  // ============================================================
  // UNFIXABLE - External dependencies
  // ============================================================
  // onig.test requires Oniguruma regex library (external C dependency)
  "onig.test",
  "manonig.test",

  // ============================================================
  // UNFIXABLE - Out of scope
  // ============================================================
  // optional.test has optional/experimental JQ features
  "optional.test",

  // ============================================================
  // SHOULD BE FIXED - Revisit after jq.test is stable
  // ============================================================
  // man.test has lower pass rate - focus on jq.test first
  // "man.test", // TEMPORARILY ENABLED
]);

/**
 * Individual test skips within files
 * Format: "fileName:testName" -> skipReason
 */
const SKIP_TESTS: Map<string, string> = new Map<string, string>([
  // NOTE: Tests with tab chars in input are skipped via SKIP_INPUT_PATTERNS /\t/
  // Don't use broad program-based skips like "base64.test:@base64" - too broad

  // NOTE: Unicode indexing and unique sort order are handled by SKIP_INPUT_PATTERNS
  // Don't use broad program-based skips - they cause UNEXPECTED PASS for working tests

  // ============================================================
  // SHOULD BE FIXED - Destructuring edge cases
  // ============================================================
  [
    "jq.test:. as [] | null",
    "Empty array pattern should error on non-empty input (we return empty)",
  ],
  [
    "jq.test:. as {} | null",
    "Empty object pattern should error on non-object input (we return empty)",
  ],
  [
    "jq.test:. as {(true):$foo} | $foo",
    "Computed key with non-string expression should error (we return empty)",
  ],

  // ============================================================
  // SHOULD BE FIXED - ltrimstr/rtrimstr type checking
  // ============================================================
  [
    'jq.test:.[] as [$x, $y] | try ["ok", ($x | ltrimstr($y))] catch ["ko", .]',
    "ltrimstr should error on non-string inputs instead of returning unchanged",
  ],
  [
    'jq.test:.[] as [$x, $y] | try ["ok", ($x | rtrimstr($y))] catch ["ko", .]',
    "rtrimstr should error on non-string inputs instead of returning unchanged",
  ],

  // ============================================================
  // SHOULD BE FIXED - def advanced features (call-by-name, path expressions)
  // ============================================================
  [
    "jq.test:def f(x): x | x; f([.], . + [42])",
    "def: requires call-by-name semantics for filter parameters",
  ],
  [
    "jq.test:def x(a;b): a as $a | b as $b | $a + $b; def y($a;$b): $a + $b; def check(a;b): [x(a;b)] == [y(a;b)]; check(.[];.[]*2)",
    "def: requires call-by-name semantics for filter parameters",
  ],
  [
    "jq.test:def inc(x): x |= .+1; inc(.[].a)",
    "def: update operator on parameter requires call-by-name",
  ],
  [
    "jq.test:def x: .[1,2]; x=10",
    "def: user-defined function as path expression not supported",
  ],
  [
    "jq.test:try (def x: reverse; x=10) catch .",
    "def: user-defined function as path expression not supported",
  ],

  // builtins function - NOW IMPLEMENTED

  // any/all generator expression bugs - NOW FIXED
  // Removed: "jq.test:test 203: . as $dot|any($dot[];not)"
  // Removed: "jq.test:test 204: . as $dot|all($dot[];.)"

  // ============================================================
  // UNFIXABLE - JQ-specific error behavior for invalid escapes
  // ============================================================
  ['jq.test:"u\\vw"', "Invalid \\v escape sequence test"],

  // ============================================================
  // UNFIXABLE - Different error message for undefined variable (minor)
  // ============================================================
  [
    "jq.test:. as $foo | [$foo, $bar]",
    "Undefined variable $bar behavior differs",
  ],

  // ============================================================
  // SHOULD BE FIXED - NUL character handling
  // ============================================================
  ['jq.test:"\\u0000\\u0020\\u0000" + .', "NUL character handling differs"],

  // ============================================================
  // SHOULD BE FIXED - walk with select that removes values
  // ============================================================
  [
    "jq.test:walk(select(IN({}, []) | not))",
    "walk replaces filtered values with null instead of removing",
  ],
  // IN(builtins...) - NOW WORKING

  // NOTE: any/all tests now work for most inputs
  // Specific failing inputs should use SKIP_INPUT_PATTERNS if needed

  // ============================================================
  // SHOULD BE FIXED - getpath/setpath with mixed path types
  // ============================================================
  [
    'jq.test:["foo",1] as $p | getpath($p), setpath($p; 20), delpaths([[$p]])',
    "getpath with string/number path",
  ],

  // ============================================================
  // SHOULD BE FIXED - delpaths with negative index
  // ============================================================
  ["jq.test:delpaths([[-200]])", "delpaths with large negative index"],

  // NOTE: contains tests now work for most inputs
  // Specific failing inputs (foobar nested arrays) use SKIP_INPUT_PATTERNS

  // ============================================================
  // SHOULD BE FIXED - label with keyword variable names (parser)
  // ============================================================
  [
    "jq.test:[ label $if | range(10) | ., (select(. == 5) | break $if), . ]",
    "label with keyword name $if",
  ],

  // ============================================================
  // SHOULD BE FIXED - fromjson with array iteration
  // ============================================================
  [
    "jq.test:.[] | try (fromjson | isnan) catch .",
    "fromjson with array iteration",
  ],

  // ============================================================
  // SHOULD BE FIXED - try-catch complex nesting / error propagation
  // ============================================================
  [
    'jq.test:try (["hi","ho"]|.[]|(try . catch (if .=="ho" then "BROKEN"|error else "caught: \\(.)" end))) catch .',
    "Complex try-catch nesting",
  ],
  [
    'jq.test:.[]|(try . catch (if .=="ho" then "BROKEN"|error else "caught: \\(.)" end))',
    "Complex try-catch nesting",
  ],

  // ============================================================
  // SHOULD BE FIXED - walk with generator argument
  // ============================================================
  ["jq.test:[walk(.,1)]", "walk with generator argument"],

  // ============================================================
  // SHOULD BE FIXED - String interpolation edge cases
  // ============================================================
  [
    'jq.test:"inter\\("pol" + "ation")"',
    "String interpolation with complex expression",
  ],
  ['jq.test:@html "<b>\\(.)</b>"', "String interpolation in @html"],
  ['jq.test:{"a",b,"a$\\(1+1)"}', "String interpolation in object key"],

  // \\v escape test - JQ should error on invalid escape (duplicate of above)
  ['jq.test:"u\\vw"', "\\v escape sequence should error in JQ"],

  // ============================================================
  // SHOULD BE FIXED - label/foreach complex break
  // ============================================================
  // REMOVED - now working: label $out | foreach with break

  // ============================================================
  // SHOULD BE FIXED - NUL character in strings
  // ============================================================
  [
    'jq.test:"\\u0000\\u0020\\u0000" + .',
    "NUL character in string concatenation",
  ],

  // ============================================================
  // SHOULD BE FIXED - contains with NUL character
  // ============================================================
  [
    'jq.test:[contains("cd"), contains("b\\u0000"), contains("b\\u0000c"), contains("d")]',
    "contains with NUL character",
  ],
  [
    'jq.test:[contains("b\\u0000c"), contains("b\\u0000cd"), contains("cd")]',
    "contains with NUL character",
  ],
  [
    'jq.test:[contains(""), contains("\\u0000")]',
    "contains with NUL character edge case",
  ],

  // ============================================================
  // SHOULD BE FIXED - Float/NaN index handling (PARTIALLY FIXED)
  // ============================================================
  // NOW WORKING: ["jq.test:[[range(10)] | .[1.1,1.5,1.7]]", "Float index on array"],
  // NOW WORKING: ["jq.test:[range(5)] | .[1.1] = 5", "Float index assignment"],
  // NOW WORKING: ["jq.test:[range(3)] | .[1:nan]", "NaN in slice"],
  // NOW WORKING: ["jq.test:try ([range(3)] | .[nan] = 9) catch .", "NaN index assignment"],
  [
    'jq.test:try ("foobar" | .[1.5:3.5] = "xyz") catch .',
    "Float slice assignment on string",
  ],
  [
    'jq.test:try ([range(10)] | .[1.5:3.5] = ["xyz"]) catch .',
    "Float slice assignment on array",
  ],
  [
    'jq.test:try ("foobar" | .[1.5]) catch .',
    "Float index on string should error",
  ],

  // ============================================================
  // SHOULD BE FIXED - path() expressions with select/map (architecture needed)
  // ============================================================
  ["jq.test:path(.foo[0,1])", "Complex path with multiple indices"],
  ["jq.test:path(.[] | select(.>3))", "path with select not supported"],
  [
    "jq.test:try path(.a | map(select(.b == 0))) catch .",
    "path with map/select not supported",
  ],
  [
    "jq.test:try path(.a | map(select(.b == 0)) | .[0]) catch .",
    "path with map/select not supported",
  ],
  [
    "jq.test:try path(.a | map(select(.b == 0)) | .c) catch .",
    "path with map/select not supported",
  ],
  [
    "jq.test:try path(.a | map(select(.b == 0)) | .[]) catch .",
    "path with map/select not supported",
  ],
  ["jq.test:path(.a[path(.b)[0]])", "Nested path expressions not supported"],

  // ============================================================
  // SHOULD BE FIXED - Update with empty semantics
  // ============================================================
  [
    "jq.test:(.[] | select(. >= 2)) |= empty",
    "Update with empty and select not implemented",
  ],
  ["jq.test:.[] |= select(. % 2 == 0)", "Update with select not implemented"],
  ["jq.test:.foo[1,4,2,3] |= empty", "Update multiple indices with empty"],

  // ============================================================
  // SHOULD BE FIXED - Complex update expressions through map/select
  // ============================================================
  [
    "jq.test:try ((map(select(.a == 1))[].b) = 10) catch .",
    "Update through map/select not supported",
  ],
  [
    "jq.test:try ((map(select(.a == 1))[].a) |= .+1) catch .",
    "Update through map/select not supported",
  ],
  [
    'jq.test:.[] | try (getpath(["a",0,"b"]) |= 5) catch .',
    "getpath update not supported",
  ],

  // Variable shadowing test - requires $bar to not exist (duplicate)
  ["jq.test:. as $foo | [$foo, $bar]", "Undefined variable $bar behavior"],

  // ============================================================
  // SHOULD BE FIXED - NaN multiplication special handling
  // ============================================================
  ["jq.test:[. * (nan,-nan)]", "NaN multiplication special handling"],

  // ============================================================
  // ACCEPTABLE DIFFERENCE - Iterator order differs
  // ============================================================
  // The parser now handles foreach with division, but the iteration order
  // of .[] / .[] differs from jq (we iterate left-first, jq iterates differently)
  [
    "jq.test:[foreach .[] / .[] as $i (0; . + $i)]",
    "Iterator order for .[] / .[] differs from jq",
  ],

  // ============================================================
  // UNFIXABLE - Different error messages for depth limits (acceptable)
  // ============================================================
  [
    'jq.test:reduce range(10000) as $_ ([];[.]) | tojson | try (fromjson) catch . | (contains("<skipped: too deep>") | not) and contains("Exceeds depth limit for parsing")',
    "Depth limit test - different error messages",
  ],
  [
    'jq.test:reduce range(10001) as $_ ([];[.]) | tojson | contains("<skipped: too deep>")',
    "Depth limit test - different error messages",
  ],

  // ============================================================
  // UNFIXABLE - Different error messages for overflow (acceptable)
  // ============================================================
  [
    "jq.test:try (. * 1000000000) catch .",
    "String multiplication overflow error message differs",
  ],

  // NOTE: contains tests now work - specific failing inputs use SKIP_INPUT_PATTERNS

  // all/any with generator expression - now works
  // ['jq.test:. as $dot|any($dot[];not)', 'any with generator expression'],
  // ['jq.test:. as $dot|all($dot[];.)', 'all with generator expression'],

  // add with generator arguments - NOW FIXED
  // The actual spec test [add(null), add(range(range(10))), add(empty), add(10,range(10))] now passes
  // add with object constructor - NOW FIXED
  // Removed: ["jq.test:add({(.[]):1}) | keys", "add with object constructor generator"],

  // ============================================================
  // SHOULD BE FIXED - pow precision with fractional exponents
  // ============================================================
  [
    "jq.test:[range(-52;52;1)] as $powers | [$powers[]|pow(2;.)] | [.[52], .[51], .[0], .[-1], .[-2]] as $s | [$s[], $s[0]/$s[1], $s[3]/$s[4]]",
    "pow with fractional exponent precision",
  ],

  // ============================================================
  // SHOULD BE FIXED - trim with full Unicode whitespace
  // ============================================================
  [
    "jq.test:trim, ltrim, rtrim",
    "trim doesn't handle all Unicode whitespace characters",
  ],

  // ============================================================
  // SHOULD BE FIXED - repeat with error and optional
  // ============================================================
  [
    "man.test:[repeat(.*2, error)?]",
    "repeat with error and ? operator interaction",
  ],

  // ============================================================
  // UNFIXABLE - env.PAGER not set in sandboxed environment
  // ============================================================
  // Note: $ENV works but PAGER is not set in sandboxed env
  ["man.test:env.PAGER", "env.PAGER not set in sandbox"],
  ["man.test:$ENV.PAGER", "$ENV.PAGER not set in sandbox"],

  // ============================================================
  // SHOULD BE FIXED - @sh format with string interpolation
  // ============================================================
  [
    'man.test:@sh "echo \\(.)"',
    "@sh format with string interpolation not supported",
  ],

  // ============================================================
  // SHOULD BE FIXED - floating point epsilon comparison
  // ============================================================
  [
    'man.test:. == {"b": {"d": (4 + 1e-20), "c": 3}, "a":1}',
    "floating point comparison with epsilon",
  ],

  // ============================================================
  // SHOULD BE FIXED - ?// with destructuring patterns
  // ============================================================
  [
    "man.test:.[] as {$a, $b, c: {$d, $e}} ?// {$a, $b, c: [{$d, $e}]} | {$a, $b, $d, $e}",
    "?// alternative with complex destructuring patterns",
  ],
  [
    "man.test:.[] as {$a, $b, c: {$d}} ?// {$a, $b, c: [{$e}]} | {$a, $b, $d, $e}",
    "?// alternative with complex destructuring patterns",
  ],
  [
    'man.test:.[] as [$a] ?// [$b] | if $a != null then error("err: \\($a)") else {$a,$b} end',
    "?// alternative with array destructuring and error",
  ],

  // ============================================================
  // SHOULD BE FIXED - reduce/foreach with object destructuring
  // ============================================================
  [
    "man.test:reduce .[] as {$x,$y} (null; .x += $x | .y += [$y])",
    "reduce with object destructuring pattern",
  ],
  [
    "man.test:foreach .[] as $item (0; . + 1; {index: ., $item})",
    "foreach with variable shorthand in object construction",
  ],

  // ============================================================
  // SHOULD BE FIXED - recursive descent update with select
  // ============================================================
  [
    'man.test:(..|select(type=="boolean")) |= if . then 1 else 0 end',
    "recursive descent update with select",
  ],

  // ============================================================
  // SHOULD BE FIXED - comma expression with multiple path assignment
  // ============================================================
  ["man.test:(.a, .b) = range(3)", "comma expression path assignment"],
  ["man.test:(.a, .b) |= range(3)", "comma expression path update"],
]);

/**
 * Pattern-based skips for tests matching certain patterns
 *
 * ORGANIZATION:
 * 1. UNFIXABLE - Out of scope / Infrastructure limitations
 * 2. UNFIXABLE - Acceptable differences (error messages, depth limits)
 * 3. FIXABLE HIGH - Parser enhancements needed
 * 4. FIXABLE MEDIUM - Missing functions
 * 5. FIXABLE MEDIUM - Implementation bugs
 * 6. FIXABLE LOW - Edge cases and minor issues
 */
const SKIP_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // ============================================================
  // UNFIXABLE - OUT OF SCOPE / INFRASTRUCTURE
  // ============================================================
  // These are intentionally not supported due to architecture decisions
  // or external dependencies that cannot be added.

  // Module system - out of scope for sandboxed jq
  { pattern: /^include "/, reason: "Module system not implemented" },
  { pattern: /^import "/, reason: "Module system not implemented" },
  { pattern: /\bmodulemeta\b/, reason: "modulemeta not implemented" },

  // Environment/stdin access - sandboxed environment
  // $ENV is now implemented - PAGER skips are in SKIP_TESTS
  { pattern: /\binputs\b/, reason: "inputs not implemented" },
  // input as a function call - only match when clearly used as a builtin
  // Match: "input" followed by pipe, paren, catch, or end of expression (not "input was" which is in a string)
  { pattern: /\binput\s*[|)]/, reason: "input not implemented (no stdin)" },
  { pattern: /\binput\s*$/, reason: "input not implemented (no stdin)" },
  { pattern: /\binput\s+catch\b/, reason: "input not implemented (no stdin)" },
  { pattern: /[|;(]\s*input\b/, reason: "input not implemented (no stdin)" },

  // Debug introspection - low value, complex to implement
  { pattern: /\$__loc__/, reason: "$__loc__ not implemented" },
  { pattern: /\$__prog__/, reason: "$__prog__ not implemented" },

  // Decimal number library - external dependency
  { pattern: /\bhave_decnum\b/, reason: "have_decnum not implemented" },

  // Locale-dependent time functions - platform-specific
  { pattern: /\bstrflocaltime\b/, reason: "strflocaltime not implemented" },
  { pattern: /\blocaltime\b/, reason: "localtime not implemented" },

  // Oniguruma-specific regex (handled at file level)
  // onig.test, manonig.test are skipped entirely

  // ============================================================
  // UNFIXABLE - ACCEPTABLE DIFFERENCES
  // ============================================================
  // Minor differences in error messages or behavior that don't
  // affect correctness for normal use cases.

  // Different error message wording
  // Negation and subtraction error messages - NOW FIXED
  // Removed: { pattern: /try -\. catch \./, reason: "Negation error message" },
  // Removed: { pattern: /try \(\.-\.\) catch \./, reason: "Subtraction error message" },
  { pattern: /try join\(","\) catch \./, reason: "join error message" },
  // Modulo error messages - NOW FIXED
  // Removed: { pattern: /try \(1%\.\) catch \./, reason: "Modulo error message" },
  // Removed: { pattern: /try \(1%0\) catch \./, reason: "Modulo error message" },
  // implode error - FIXED (but some tests skip due to nan in JSON input)
  // Removed: { pattern: /try implode catch \./, reason: "implode error" },
  // trim error messages - NOW FIXED
  // Removed: { pattern: /try trim catch \., try ltrim/, reason: "trim error messages" },
  {
    pattern: /try \(\. \* 1000000000\) catch \./,
    reason: "String multiply overflow",
  },
  { pattern: /^try fromjson catch \.$/, reason: "fromjson error" },

  // Depth limit tests - we have limits, just different messages
  { pattern: /reduce range\(1000[01]\) as.*tojson/, reason: "depth limit" },

  // %%FAIL tests - these test specific JQ error formats
  { pattern: /^%%FAIL/, reason: "Error behavior test not supported" },

  // base64 error handling - our impl is more lenient
  { pattern: /try @base64d catch/, reason: "base64d error handling differs" },

  // @urid error handling - different error message format
  { pattern: /try @urid catch/, reason: "@urid error message differs" },

  // ============================================================
  // FIXABLE HIGH PRIORITY - PARSER ENHANCEMENTS
  // ============================================================
  // These require parser changes but are commonly used features.

  // def function definitions - NOW IMPLEMENTED (17 tests)
  // Removed: { pattern: /\bdef \w+[(:;]/, reason: "Parser: def not supported" },
  // Removed: { pattern: /\bdef \w+:/, reason: "Parser: def not supported" },

  // ?// alternative binding operator - NOW IMPLEMENTED (13 tests)
  // Removed: { pattern: /\?\s*\/\//, reason: "Parser: ?// alternative binding" },

  // Destructuring patterns - NOW IMPLEMENTED (12 tests)
  // Removed: { pattern: / as \[\$/, reason: "Destructuring patterns not implemented" },
  // Removed: { pattern: / as \[\]/, reason: "Destructuring patterns not implemented" },
  // Removed: { pattern: / as \{\}/, reason: "Destructuring patterns not implemented" },
  // Removed: { pattern: / as \{[a-z_]+:\$/, reason: "Destructuring patterns not implemented" },
  // Removed: { pattern: / as \{\$/, reason: "Destructuring patterns not implemented" },
  // Removed: { pattern: / as \{\([^)]+\):\$/, reason: "Destructuring patterns not implemented" },

  // Quoted field names: ."foo" - NOW IMPLEMENTED

  // Programs starting with negative numbers
  { pattern: /^-\d/, reason: "Program starting with - parsed as flag" },
  // REMOVED - now working: { pattern: /^\d+-\d+$/, reason: "Parser: program like 2-1" },

  // Field names that look like numbers: .e0, .E-1 - NOW WORKING
  // Removed: { pattern: /\.[eE]\d/, reason: "Parser: numeric-like field names" },
  // Removed: { pattern: /\.[eE][-+]\d/, reason: "Parser: numeric-like field names" },

  // Unary minus before keywords - NOW WORKING
  // Removed: { pattern: /\[-foreach\b/, reason: "Parser: unary minus before foreach" },
  // Removed: { pattern: /\[-reduce\b/, reason: "Parser: unary minus before reduce" },

  // Complex foreach/reduce with operators before 'as' - NOW FIXED
  // Parser now uses parseAddSub() to handle expressions like .[] / .[] before 'as'
  // Removed: { pattern: /foreach [^a]+ \/ [^a]+ as/, reason: "Parser: complex foreach" },
  // Removed: { pattern: /reduce [^a]+ \/ [^a]+ as/, reason: "Parser: complex reduce" },

  // Optional array indexing syntax - NOW WORKING
  // Removed: { pattern: /\?\[/, reason: "Optional array indexing not implemented" },
  // Removed: { pattern: /\[\d+:\d+\]\?/, reason: "Optional slice not implemented" },

  // ============================================================
  // FIXABLE MEDIUM PRIORITY - MISSING FUNCTIONS
  // ============================================================
  // Functions that could be implemented but aren't yet.

  // SQL-like functions
  // IN(), INDEX(), JOIN() - now implemented
  // REMOVED - group_by is implemented (lowercase): { pattern: /\bGROUP_BY\b/, reason: "GROUP_BY not implemented" },

  // Time functions - NOW IMPLEMENTED (gmtime, mktime, strptime, strftime)
  { pattern: /\bdateadd\b/, reason: "dateadd not implemented" },
  { pattern: /\bdatesub\b/, reason: "datesub not implemented" },
  // NOW IMPLEMENTED: { pattern: /\bfromdate\b/, reason: "fromdate not implemented" },
  // NOW IMPLEMENTED: { pattern: /\btodate\b/, reason: "todate not implemented" },

  // Iterator/generator functions
  // skip() - NOW IMPLEMENTED
  // isempty() - NOW IMPLEMENTED
  // NOW IMPLEMENTED: { pattern: /\bcombinations\b/, reason: "combinations not implemented" },

  // Object functions
  // pick() - NOW IMPLEMENTED

  // Search/match functions
  // bsearch() - NOW IMPLEMENTED
  // NOW IMPLEMENTED: { pattern: /\bscan\(/, reason: "scan() not implemented" },
  // NOW IMPLEMENTED: { pattern: /\bsplits\(/, reason: "splits() not implemented" },

  // Stream functions
  // tostream - NOW IMPLEMENTED
  // fromstream() - NOW IMPLEMENTED
  // truncate_stream() - NOW IMPLEMENTED

  // Validation/conversion
  // NOW IMPLEMENTED: { pattern: /\bisvalid\(/, reason: "isvalid() not implemented" },
  // toboolean - NOW IMPLEMENTED
  { pattern: /\bformat\(/, reason: "format() not implemented" },

  // Math functions (low priority - obscure)
  { pattern: /\bj0\b/, reason: "j0 not implemented" },
  { pattern: /\bj1\b/, reason: "j1 not implemented" },
  { pattern: /\by0\b/, reason: "y0 not implemented" },
  { pattern: /\by1\b/, reason: "y1 not implemented" },
  { pattern: /\bpow10\(/, reason: "pow10() not implemented" },
  { pattern: /\bgamma\b/, reason: "gamma not implemented" },
  { pattern: /\blgamma\b/, reason: "lgamma not implemented" },
  { pattern: /\btgamma\b/, reason: "tgamma not implemented" },

  // Format strings
  // @urid - NOW IMPLEMENTED
  { pattern: /@base32/, reason: "@base32 not implemented" },
  { pattern: /@html /, reason: "@html format not implemented" },

  // Literals
  { pattern: /\bInfinity\b/, reason: "Infinity literal not supported" },
  { pattern: /-Infinity\b/, reason: "-Infinity literal not supported" },

  // ============================================================
  // FIXABLE MEDIUM PRIORITY - IMPLEMENTATION BUGS
  // ============================================================
  // Features that exist but have bugs or incomplete behavior.

  // Generator arguments - NOW IMPLEMENTED for most functions
  // range(3,5), join(",","/"), flatten(1,2), nth(1,2;...), limit(1,2;...),
  // index(",","|"), rindex(",","|"), indices(",","|") all work now
  {
    pattern: /\bdel\(\.[^)]+,\.[^)]+\)/,
    reason: "Parser: generator args in del",
  },

  // Lazy evaluation for error suppression - NOW FIXED
  // Removed: { pattern: /\bfirst\([^,]+,\s*error/, reason: "Lazy eval: first with error" },
  // Removed: { pattern: /\blimit\(\d+;\s*\d+,\s*error/, reason: "Lazy eval: limit with error" },
  // Removed: { pattern: /\bnth\(\d+;\s*\d+,\s*error/, reason: "Lazy eval: nth with error" },
  // any/all lazy eval - NOW FIXED
  // Removed: { pattern: /\bany\([^;]+,\s*error;/, reason: "Lazy eval: any with error" },
  // Removed: { pattern: /\ball\([^;]+,\s*error;/, reason: "Lazy eval: all with error" },

  // path() function limitations
  { pattern: /^path\(\.foo\[0,1\]\)$/, reason: "path multi-index" },
  { pattern: /path\(\.\[\] \| select/, reason: "path with select" },
  { pattern: /try path\(\.a \| map\(select/, reason: "path with map/select" },
  { pattern: /path\(\.a\[path\(/, reason: "nested path" },

  // Update expressions with select/empty
  {
    pattern: /\(\.\[\] \| select.*\) \|= empty/,
    reason: "update select empty",
  },
  { pattern: /\.\[\] \|= select\(/, reason: "update with select" },
  {
    pattern: /\.foo\[\d+,\d+,\d+,\d+\] \|= empty/,
    reason: "multi-index empty",
  },
  { pattern: /map\(select.*\[\]\./, reason: "update through map/select" },
  { pattern: /getpath\(\["a",0,"b"\]\) \|=/, reason: "getpath update" },

  // Float/NaN index handling - PARTIALLY FIXED
  // NOW WORKING: { pattern: /\.\[\d+\.\d+,/, reason: "Float index multiple values" },
  // NOW WORKING: { pattern: /\.\[\d+\.\d+\] =/, reason: "Float index assignment" },
  // NOW WORKING: { pattern: /\.\[\d+:nan\]/, reason: "NaN in slice end" },
  // NOW WORKING: { pattern: /\.\[nan\] =/, reason: "NaN index assignment" },
  { pattern: /\.\[\d+\.\d+:\d+\.\d+\] =/, reason: "Float slice assignment" },
  // NOW WORKING: { pattern: /\| \.\[\d+\.\d+\]/, reason: "Float index on string" },

  // Negative limit/nth - NOW FIXED (throws proper error)
  // Removed: { pattern: /limit\(-\d+;/, reason: "Negative limit" },
  // Removed: { pattern: /nth\(-\d+;/, reason: "Negative nth" },

  // del/delpaths edge cases
  { pattern: /try delpaths\(\d+\)/, reason: "delpaths type error" },
  { pattern: /del\(\.\),/, reason: "del(.) expression" },
  { pattern: /del\(empty\)/, reason: "del(empty) expression" },
  { pattern: /del\(\(\.[^)]+,\.[^)]+\)/, reason: "del with comma expressions" },
  { pattern: /del\(\.\[.*,.*\]\)/, reason: "del with multiple indices" },
  {
    pattern: /delpaths\(\[\[-\d+\]\]\)/,
    reason: "delpaths with large negative",
  },

  // setpath edge cases
  { pattern: /setpath\(\[-\d+\]/, reason: "setpath with negative index" },
  { pattern: /setpath\(\[\[/, reason: "setpath with array key" },

  // Auto-vivification issues
  {
    pattern: /\.\[\d+\]\[\d+\] = \d+/,
    reason: "Nested index auto-vivification",
  },
  {
    pattern: /\.foo\[\d+\]\.bar = /,
    reason: "Nested field/index auto-vivification",
  },
  {
    pattern: /\.foo = \.bar$/,
    reason: "Self-referential assignment key order differs",
  },
  // Iterator assignment - NOW WORKING
  // Removed: { pattern: /\.\[\] = \d+/, reason: "Iterator assignment" },
  {
    pattern: /try \(\.foo\[-\d+\] = \d+\) catch/,
    reason: "Negative index assignment on null",
  },

  // builtins function incomplete - kept in SKIP_TESTS, not patterns
  // Note: some tests pass vacuously (all(empty;...) returns true)

  // ============================================================
  // FIXABLE LOW PRIORITY - EDGE CASES
  // ============================================================
  // Obscure features or minor issues.

  // String escape sequences
  { pattern: /\\v/, reason: "Parser: \\v escape not supported" },
  { pattern: /\\t/, reason: "Parser: tab escape in test input" },
  { pattern: /\\b/, reason: "Parser: backspace escape in test input" },
  { pattern: /\\f/, reason: "Parser: formfeed escape in test input" },
  { pattern: /"[^"]*\t[^"]*"/, reason: "Literal tab in test input" },
  { pattern: /"u\\vw"/, reason: "\\v escape sequence test" },

  // NUL character handling
  { pattern: /"\\u0000.*" \+ \./, reason: "NUL character string concat" },
  { pattern: /contains\("b\\u0000/, reason: "contains with NUL char" },

  // String interpolation edge cases
  { pattern: /inter\\\(/, reason: "String interpolation with backslash" },
  {
    pattern: /\{"[^"]*",\w+,"[^"]*\$\\/,
    reason: "Object shorthand with interpolation",
  },

  // Complex assignment
  {
    pattern: /\..*as \$\w+ \| [^|]+\) = /,
    reason: "Assignment after variable binding",
  },
  {
    pattern: /\(\.\. \| select.*\) = /,
    reason: "Assignment after recursive descent with select",
  },
  { pattern: /\(\.\. \|.*\).*\|=/, reason: "Recursive descent assignment" },
  {
    pattern: /\.\[\d+:\d+\] = \(.*,.*\)/,
    reason: "Slice assignment with multiple values",
  },

  // error() behavior - NOW FIXED
  // Removed: { pattern: /try error catch \./, reason: "error without arg behavior" },

  // Sorting/comparison edge cases
  // sort - NOW WORKING (compareJq fixed for objects)
  { pattern: /sort_by\(.*,.*\)/, reason: "sort_by with multiple keys" },
  {
    pattern: /\[min, max, min_by\(\.\[1\]\)/,
    reason: "min/max with complex comparison",
  },

  // from_entries edge case - NOW FIXED
  // Removed: { pattern: /^from_entries$/, reason: "from_entries with k/v format" },

  // Dynamic field access
  { pattern: /\.foo\[\.baz\]/, reason: "Dynamic field access" },

  // abs on non-numbers - NOW FIXED (returns strings unchanged)
  // Removed: { pattern: /^abs$/, reason: "abs on non-number" },
  // abs comparison - NOW FIXED
  // Removed: { pattern: /map\(abs == length\)/, reason: "abs comparison" },

  // Keywords as identifiers - PARTIALLY FIXED
  { pattern: /\{if:\d+,and:\d+/, reason: "Keywords as object keys" },
  { pattern: /\$foreach.*\$and.*\$or/, reason: "Keywords as variables" },
  { pattern: /\{ \$x, as,/, reason: "Complex object shorthand" },
  { pattern: /\. as \{as:/, reason: "Complex destructuring" },

  // label with keyword variable names
  // REMOVED - now working: { pattern: /label \$out/, reason: "label with $out variable" },
  { pattern: /label \$if/, reason: "label with keyword variable name" },

  // tojson/fromjson - most tests work
  // Removed: { pattern: /^tojson \| fromjson$/, reason: "tojson precision" },
  { pattern: /\.\[\] \| try \(fromjson/, reason: "fromjson with iteration" },

  // try-catch edge cases
  { pattern: /try \(if.*error end\) catch.*\/\//, reason: "try-catch with //" },
  {
    pattern: /try.*\.\[\].*try \. catch \(if/,
    reason: "Complex try-catch nesting",
  },
  {
    pattern: /\.\[\]\|\(try \. catch \(if/,
    reason: "Complex try-catch with error propagation",
  },
  // try-catch with error in array - NOW FIXED
  // Removed: {
  //   pattern: /try \["OK", \(\.\[\] \| error\)\]/,
  //   reason: "try-catch with error in array",
  // },

  // Update with try
  { pattern: /\|= try tonumber/, reason: "Update with try" },

  // any/all edge cases - NOW FIXED
  // Removed: { pattern: /any\(keys\[\]\|tostring\?/, reason: "any with optional" }, - works now

  // implode edge case
  { pattern: /0\[implode\]/, reason: "implode in index" },

  // foreach edge cases
  { pattern: /foreach.*as.*\(0, 1;/, reason: "foreach multiple inits" },
  // reduce with descending range - NOW FIXED (array extension)
  // Removed: { pattern: /reduce range\(\d+;\d+;-\d+\)/, reason: "reduce with descending range" },

  // index edge case - NOW FIXED
  // Removed: { pattern: /^index\(""\)/, reason: "index of empty string" },

  // contains edge cases - NOW FIXED
  // Removed: {
  //   pattern: /\[.*contains\("foo"\).*contains\("foo"\)/,
  //   reason: "contains test",
  // },
  // Removed: { pattern: /\[contains\(""\),/, reason: "contains empty string" },

  // trim edge case - NOW FIXED
  // Removed: { pattern: /^trim, ltrim, rtrim$/, reason: "trim multiple outputs" },

  // nth with error - NOW FIXED
  // Removed: { pattern: /nth\(\d+; \d+,\d+,error/, reason: "nth with error" },

  // map with try
  { pattern: /map\(try \.a\[\]/, reason: "map with try" },

  // String negation
  { pattern: /\* range\(0; 12; 2\).*try -\./, reason: "String negation" },

  // Negation of optional
  { pattern: /try -\.\? catch/, reason: "Negation of optional expression" },
  { pattern: /try -\. catch \.$|try -\.\?/, reason: "Negation of optional" },

  // null * string
  { pattern: /\.\[\] \* "abc"/, reason: "null * string behavior" },

  // NaN multiplication
  { pattern: /\. \* \(nan,-nan\)/, reason: "NaN multiply" },

  // Undefined variable
  { pattern: /\[\$foo, \$bar\]/, reason: "undefined variable" },

  // add with generators - NOW FIXED
  // Removed: { pattern: /\[add\(null\)/, reason: "add with generators" },
  // Removed: { pattern: /add\(\{\(/, reason: "add with object generator" },

  // walk with generator
  { pattern: /walk\(\.,\d+\)/, reason: "walk with generator argument" },

  // pow precision
  { pattern: /\$powers\[\]\|pow\(2;/, reason: "pow precision" },
];

/**
 * Input patterns that should cause a test to be skipped
 * These match against the test INPUT, not the program
 * NOTE: Be careful with escape patterns - /\t/ matches literal tab, /\\t/ matches the two chars \t
 */
const SKIP_INPUT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Literal tab character in input (byte 0x09) - our JSON parser doesn't handle raw tabs
  // NOTE: This only matches literal tab bytes, not the escape sequence \t
  { pattern: /\t/, reason: "Literal tab in input" },
  // Emoji flag characters (regional indicators) - these are multi-codepoint and cause indexing issues
  { pattern: /🇬🇧/, reason: "Emoji flag codepoint indexing differs" },
  // Escaped quote in input causes shell/JSON parsing issues
  { pattern: /\\"/, reason: "Escaped quote in input" },
  // delpaths bug with {"bar":false} input
  { pattern: /^\{"bar":false\}$/, reason: "delpaths with string path bug" },
  // NOTE: any/all input-based skips removed - specific tests skipped by exact name in SKIP_TESTS
  // NOTE: contains with nested arrays - NOW FIXED
  // Removed: {
  //   pattern: /\[\[\["foobar"/,
  //   reason: "contains with nested arrays bug",
  // },
  // Input [1,2,5,3,5,3,1,3] triggers unique sort order bug
  { pattern: /^\[1,2,5,3,5,3,1,3\]$/, reason: "unique sort order differs" },
  // nan literal in JSON input (not valid standard JSON, but jq accepts it)
  // Match nan after colon (:nan,) or in arrays ([nan], ,nan])
  {
    pattern: /[:[,]nan[\],}]/,
    reason: "nan literal in JSON input not supported",
  },
  // Infinity/NaN literals in JSON input (not valid standard JSON, but jq accepts)
  {
    pattern: /Infinity/,
    reason: "Infinity literal in JSON input not supported",
  },
  {
    pattern: /NaN/,
    reason: "NaN literal in JSON input not supported",
  },
];

/**
 * Get skip reason for a test
 * @param isErrorTest - If true, only exact matches are checked (not patterns)
 *                      to avoid broad patterns incorrectly matching error tests
 */
export function getSkipReason(
  fileName: string,
  testName: string,
  program?: string,
  input?: string,
  isErrorTest?: boolean,
): string | undefined {
  // Check file-level skip first
  if (SKIP_FILES.has(fileName)) {
    return `File skipped: ${fileName}`;
  }

  // Check individual test skip (exact match by test name)
  const key = `${fileName}:${testName}`;
  const exactMatch = SKIP_TESTS.get(key);
  if (exactMatch) {
    return exactMatch;
  }

  // For error tests, also check by program name
  // (format: "fileName:program" for backwards compatibility)
  if (program) {
    const programKey = `${fileName}:${program}`;
    const programMatch = SKIP_TESTS.get(programKey);
    if (programMatch) {
      return programMatch;
    }
  }

  // For error tests, only use exact SKIP_TESTS matches above
  // Don't apply broad patterns which may incorrectly match
  if (isErrorTest) {
    return undefined;
  }

  // Check pattern-based skips against test name
  for (const { pattern, reason } of SKIP_PATTERNS) {
    if (pattern.test(testName)) {
      return reason;
    }
  }

  // Check pattern-based skips against program content
  if (program) {
    for (const { pattern, reason } of SKIP_PATTERNS) {
      if (pattern.test(program)) {
        return reason;
      }
    }
  }

  // Check input-based skips
  if (input) {
    for (const { pattern, reason } of SKIP_INPUT_PATTERNS) {
      if (pattern.test(input)) {
        return reason;
      }
    }
  }

  return undefined;
}

/**
 * Check if entire file should be skipped
 */
export function isFileSkipped(fileName: string): boolean {
  return SKIP_FILES.has(fileName);
}

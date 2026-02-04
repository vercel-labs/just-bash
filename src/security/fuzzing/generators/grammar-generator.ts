/**
 * Grammar-Based Bash Syntax Generator
 *
 * Uses fc.letrec to generate random valid bash syntax based on the grammar.
 * This provides true fuzzing by exploring the syntax space systematically
 * rather than using predefined patterns.
 */

import fc from "fast-check";

// =============================================================================
// TOKENS - Basic building blocks
// =============================================================================

/** Valid bash identifier (variable name) */
export const identifier: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_"),
    fc.stringOf(
      fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_",
      ),
      { maxLength: 10 },
    ),
  )
  .map(([first, rest]) => first + rest);

/** Strict pollution identifiers - only dangerous names, no regular identifiers */
export const strictPollutionIdentifier: fc.Arbitrary<string> = fc.oneof(
  // Core pollution targets (highest weight)
  {
    weight: 10,
    arbitrary: fc.constantFrom("__proto__", "constructor", "prototype"),
  },
  // Object method pollution
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      "__defineGetter__",
      "__defineSetter__",
      "__lookupGetter__",
      "__lookupSetter__",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
      "toString",
      "valueOf",
    ),
  },
);

/** Dangerous/special identifier names for prototype pollution testing */
export const dangerousIdentifier: fc.Arbitrary<string> = fc.oneof(
  // Strict pollution names (high weight)
  { weight: 8, arbitrary: strictPollutionIdentifier },
  // Regular identifier (lower weight for variety in general grammar)
  { weight: 2, arbitrary: identifier },
);

/** Chained property paths for deep pollution attempts */
export const pollutionChain: fc.Arbitrary<string> = fc.oneof(
  // Direct chains
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      "__proto__",
      "constructor",
      "constructor.prototype",
      "__proto__.__proto__",
      "constructor.constructor",
      "prototype.constructor",
      "__proto__.constructor",
      "constructor.__proto__",
    ),
  },
  // Dynamic chains with array notation
  {
    weight: 3,
    arbitrary: fc
      .tuple(
        fc.constantFrom("__proto__", "constructor", "prototype"),
        fc.constantFrom("__proto__", "constructor", "prototype", "0", "1"),
      )
      .map(([a, b]) => `${a}[${b}]`),
  },
  // Triple chains
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        fc.constantFrom("__proto__", "constructor"),
        fc.constantFrom("__proto__", "constructor", "prototype"),
        fc.constantFrom("__proto__", "constructor", "prototype"),
      )
      .map(([a, b, c]) => `${a}.${b}.${c}`),
  },
);

/** Integer literal */
export const integerLiteral: fc.Arbitrary<string> = fc.oneof(
  { weight: 10, arbitrary: fc.integer({ min: -1000, max: 1000 }).map(String) },
  {
    weight: 2,
    arbitrary: fc.constantFrom("0", "-1", "1", "2147483647", "-2147483648"),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom("0x10", "0X1F", "010", "2#101", "16#FF"),
  },
);

/** Simple word (no special characters) */
export const simpleWord: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./",
  ),
  { minLength: 1, maxLength: 15 },
);

/** Command name */
export const commandName: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      "echo",
      "printf",
      "cat",
      "ls",
      "test",
      "true",
      "false",
      ":",
      "[",
    ),
  },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      "read",
      "export",
      "local",
      "declare",
      "unset",
      "set",
      "shift",
    ),
  },
  { weight: 2, arbitrary: simpleWord },
);

// =============================================================================
// GRAMMAR - Recursive bash syntax using fc.letrec
// =============================================================================

/** Grammar type for bash syntax generation */
export interface BashGrammarArbitraries {
  script: fc.Arbitrary<string>;
  statement: fc.Arbitrary<string>;
  pipeline: fc.Arbitrary<string>;
  command: fc.Arbitrary<string>;
  simpleCommand: fc.Arbitrary<string>;
  compoundCommand: fc.Arbitrary<string>;
  word: fc.Arbitrary<string>;
  expansion: fc.Arbitrary<string>;
  arithmeticExpr: fc.Arbitrary<string>;
}

/**
 * Create a grammar-based bash script generator.
 * @param _maxDepth - Maximum nesting depth (currently unused, for future depth control)
 */
export function createBashGrammar(_maxDepth = 3): BashGrammarArbitraries {
  return fc.letrec<{
    script: string;
    statement: string;
    pipeline: string;
    command: string;
    simpleCommand: string;
    compoundCommand: string;
    word: string;
    expansion: string;
    arithmeticExpr: string;
  }>((tie) => ({
    // Script: multiple statements
    script: fc
      .array(tie("statement"), { minLength: 1, maxLength: 3 })
      .map((stmts) => stmts.join("\n")),

    // Statement: pipelines connected by && or ||
    statement: fc.oneof(
      { weight: 5, arbitrary: tie("pipeline") },
      {
        weight: 2,
        arbitrary: fc
          .tuple(tie("pipeline"), fc.constantFrom("&&", "||"), tie("pipeline"))
          .map(([p1, op, p2]) => `${p1} ${op} ${p2}`),
      },
      {
        weight: 1,
        arbitrary: tie("pipeline").map((p) => `${p} &`),
      },
    ),

    // Pipeline: commands connected by |
    pipeline: fc.oneof(
      { weight: 5, arbitrary: tie("command") },
      {
        weight: 2,
        arbitrary: fc
          .tuple(tie("command"), tie("command"))
          .map(([c1, c2]) => `${c1} | ${c2}`),
      },
      {
        weight: 1,
        arbitrary: tie("command").map((c) => `! ${c}`),
      },
    ),

    // Command: simple or compound
    command: fc.oneof(
      { weight: 5, arbitrary: tie("simpleCommand") },
      { weight: 2, arbitrary: tie("compoundCommand") },
    ),

    // Simple command: [assignments] name [args] [redirections]
    simpleCommand: fc.oneof(
      // Basic command with args
      {
        weight: 4,
        arbitrary: fc
          .tuple(commandName, fc.array(tie("word"), { maxLength: 3 }))
          .map(([name, args]) =>
            args.length > 0 ? `${name} ${args.join(" ")}` : name,
          ),
      },
      // Assignment + command
      {
        weight: 2,
        arbitrary: fc
          .tuple(identifier, tie("word"), commandName)
          .map(([name, value, cmd]) => `${name}=${value} ${cmd}`),
      },
      // Dangerous assignment (pollution target)
      {
        weight: 5,
        arbitrary: fc
          .tuple(dangerousIdentifier, tie("word"))
          .map(([name, value]) => `${name}=${value}`),
      },
      // Associative array with dangerous key
      {
        weight: 4,
        arbitrary: fc
          .tuple(identifier, dangerousIdentifier, tie("word"))
          .map(([arr, key, val]) => `${arr}[${key}]=${val}`),
      },
      // Declare associative array with pollution
      {
        weight: 3,
        arbitrary: fc
          .tuple(identifier, dangerousIdentifier, tie("word"))
          .map(([arr, key, val]) => `declare -A ${arr}; ${arr}[${key}]=${val}`),
      },
      // Nameref to dangerous name
      {
        weight: 3,
        arbitrary: fc
          .tuple(identifier, dangerousIdentifier)
          .map(([ref, target]) => `declare -n ${ref}=${target}`),
      },
      // Export dangerous variable
      {
        weight: 2,
        arbitrary: fc
          .tuple(dangerousIdentifier, tie("word"))
          .map(([name, val]) => `export ${name}=${val}`),
      },
      // Local dangerous variable
      {
        weight: 2,
        arbitrary: fc
          .tuple(dangerousIdentifier, tie("word"))
          .map(([name, val]) => `local ${name}=${val}`),
      },
      // With redirection
      {
        weight: 1,
        arbitrary: fc
          .tuple(
            commandName,
            fc.constantFrom(
              "> /dev/null",
              "2>&1",
              "< /dev/null",
              "&> /dev/null",
            ),
          )
          .map(([cmd, redir]) => `${cmd} ${redir}`),
      },
    ),

    // Compound command: control structures
    compoundCommand: fc.oneof(
      // If statement
      {
        weight: 3,
        arbitrary: fc
          .tuple(tie("pipeline"), tie("statement"))
          .map(([cond, body]) => `if ${cond}; then ${body}; fi`),
      },
      // For loop
      {
        weight: 3,
        arbitrary: fc
          .tuple(
            identifier,
            fc.array(tie("word"), { minLength: 1, maxLength: 5 }),
            tie("statement"),
          )
          .map(
            ([v, words, body]) =>
              `for ${v} in ${words.join(" ")}; do ${body}; done`,
          ),
      },
      // C-style for loop
      {
        weight: 2,
        arbitrary: fc
          .tuple(
            tie("arithmeticExpr"),
            tie("arithmeticExpr"),
            tie("arithmeticExpr"),
            tie("statement"),
          )
          .map(
            ([init, cond, upd, body]) =>
              `for ((${init}; ${cond}; ${upd})); do ${body}; done`,
          ),
      },
      // While loop
      {
        weight: 2,
        arbitrary: fc
          .tuple(tie("pipeline"), tie("statement"))
          .map(([cond, body]) => `while ${cond}; do ${body}; done`),
      },
      // Until loop
      {
        weight: 1,
        arbitrary: fc
          .tuple(tie("pipeline"), tie("statement"))
          .map(([cond, body]) => `until ${cond}; do ${body}; done`),
      },
      // Case statement
      {
        weight: 1,
        arbitrary: fc
          .tuple(tie("word"), tie("word"), tie("statement"))
          .map(([w, pat, body]) => `case ${w} in ${pat}) ${body};; esac`),
      },
      // Subshell
      {
        weight: 2,
        arbitrary: tie("statement").map((s) => `(${s})`),
      },
      // Group
      {
        weight: 2,
        arbitrary: tie("statement").map((s) => `{ ${s}; }`),
      },
      // Arithmetic command
      {
        weight: 2,
        arbitrary: tie("arithmeticExpr").map((e) => `((${e}))`),
      },
      // Conditional command
      {
        weight: 2,
        arbitrary: fc
          .tuple(fc.constantFrom("-n", "-z", "-e", "-f", "-d"), tie("word"))
          .map(([op, w]) => `[[ ${op} ${w} ]]`),
      },
      // Function definition
      {
        weight: 1,
        arbitrary: fc
          .tuple(dangerousIdentifier, tie("statement"))
          .map(([name, body]) => `${name}() { ${body}; }`),
      },
    ),

    // Word: basic or with expansion
    word: fc.oneof(
      { weight: 5, arbitrary: simpleWord },
      { weight: 3, arbitrary: tie("expansion") },
      // Single quoted
      {
        weight: 2,
        arbitrary: simpleWord.map((w) => `'${w}'`),
      },
      // Double quoted with expansion
      {
        weight: 2,
        arbitrary: fc
          .tuple(simpleWord, tie("expansion"))
          .map(([w, e]) => `"${w}${e}"`),
      },
      // Brace expansion
      {
        weight: 1,
        arbitrary: fc
          .tuple(simpleWord, simpleWord)
          .map(([a, b]) => `{${a},${b}}`),
      },
      // Range expansion
      {
        weight: 1,
        arbitrary: fc
          .tuple(
            fc.integer({ min: 0, max: 10 }),
            fc.integer({ min: 0, max: 20 }),
          )
          .map(([a, b]) => `{${a}..${b}}`),
      },
    ),

    // Expansion: parameter, command, arithmetic
    expansion: fc.oneof(
      // Simple variable
      { weight: 3, arbitrary: identifier.map((v) => `$${v}`) },
      // Dangerous variable expansion (pollution target)
      { weight: 5, arbitrary: dangerousIdentifier.map((v) => `$${v}`) },
      // Special variables
      {
        weight: 2,
        arbitrary: fc.constantFrom(
          "$?",
          "$!",
          "$$",
          "$#",
          "$@",
          "$*",
          "$0",
          "$1",
        ),
      },
      // Braced variable
      { weight: 2, arbitrary: identifier.map((v) => `\${${v}}`) },
      // Braced dangerous variable
      { weight: 4, arbitrary: dangerousIdentifier.map((v) => `\${${v}}`) },
      // Default value with dangerous name
      {
        weight: 3,
        arbitrary: fc
          .tuple(dangerousIdentifier, simpleWord)
          .map(([v, d]) => `\${${v}:-${d}}`),
      },
      // Indirect expansion (pollution vector)
      {
        weight: 4,
        arbitrary: dangerousIdentifier.map((v) => `\${!${v}}`),
      },
      // Indirect expansion with @ suffix
      {
        weight: 3,
        arbitrary: dangerousIdentifier.map((v) => `\${!${v}@}`),
      },
      // Array with dangerous index
      {
        weight: 4,
        arbitrary: fc
          .tuple(identifier, dangerousIdentifier)
          .map(([arr, idx]) => `\${${arr}[${idx}]}`),
      },
      // Dangerous array element
      {
        weight: 3,
        arbitrary: fc
          .tuple(dangerousIdentifier, fc.integer({ min: 0, max: 10 }))
          .map(([v, i]) => `\${${v}[${i}]}`),
      },
      // Length of dangerous variable
      { weight: 2, arbitrary: dangerousIdentifier.map((v) => `\${#${v}}`) },
      // Substring of dangerous variable
      {
        weight: 2,
        arbitrary: fc
          .tuple(dangerousIdentifier, fc.integer({ min: 0, max: 10 }))
          .map(([v, n]) => `\${${v}:${n}}`),
      },
      // Pattern removal on dangerous variable
      {
        weight: 2,
        arbitrary: fc
          .tuple(
            dangerousIdentifier,
            simpleWord,
            fc.constantFrom("#", "##", "%", "%%"),
          )
          .map(([v, p, op]) => `\${${v}${op}${p}}`),
      },
      // Command substitution
      {
        weight: 1,
        arbitrary: commandName.map((c) => `$(${c})`),
      },
      // Arithmetic expansion
      {
        weight: 2,
        arbitrary: tie("arithmeticExpr").map((e) => `$((${e}))`),
      },
      // Array length
      { weight: 1, arbitrary: identifier.map((v) => `\${#${v}[@]}`) },
      // Dangerous array length
      { weight: 2, arbitrary: dangerousIdentifier.map((v) => `\${#${v}[@]}`) },
    ),

    // Arithmetic expression
    arithmeticExpr: fc.oneof(
      // Number
      { weight: 5, arbitrary: integerLiteral },
      // Variable
      { weight: 4, arbitrary: identifier },
      // Binary operation
      {
        weight: 3,
        arbitrary: fc
          .tuple(
            fc.oneof(identifier, integerLiteral),
            fc.constantFrom(
              "+",
              "-",
              "*",
              "/",
              "%",
              "**",
              "&",
              "|",
              "^",
              "<<",
              ">>",
            ),
            fc.oneof(identifier, integerLiteral),
          )
          .map(([l, op, r]) => `${l} ${op} ${r}`),
      },
      // Comparison
      {
        weight: 2,
        arbitrary: fc
          .tuple(
            fc.oneof(identifier, integerLiteral),
            fc.constantFrom("<", "<=", ">", ">=", "==", "!="),
            fc.oneof(identifier, integerLiteral),
          )
          .map(([l, op, r]) => `${l} ${op} ${r}`),
      },
      // Unary operation
      {
        weight: 2,
        arbitrary: fc
          .tuple(fc.constantFrom("!", "~", "-", "++", "--"), identifier)
          .map(([op, v]) => `${op}${v}`),
      },
      // Assignment
      {
        weight: 2,
        arbitrary: fc
          .tuple(
            identifier,
            fc.constantFrom("=", "+=", "-=", "*=", "/="),
            fc.oneof(identifier, integerLiteral),
          )
          .map(([v, op, e]) => `${v} ${op} ${e}`),
      },
      // Ternary
      {
        weight: 1,
        arbitrary: fc
          .tuple(identifier, integerLiteral, integerLiteral)
          .map(([c, t, f]) => `${c} ? ${t} : ${f}`),
      },
      // Grouped
      {
        weight: 1,
        arbitrary: fc
          .tuple(
            fc.oneof(identifier, integerLiteral),
            fc.constantFrom("+", "-", "*"),
            fc.oneof(identifier, integerLiteral),
          )
          .map(([l, op, r]) => `(${l} ${op} ${r})`),
      },
    ),
  }));
}

// =============================================================================
// EXPORTED GENERATORS
// =============================================================================

const grammar = createBashGrammar(3);

/** Generate a random bash script */
export const bashScript: fc.Arbitrary<string> = grammar.script;

/** Generate a random bash statement */
export const bashStatement: fc.Arbitrary<string> = grammar.statement;

/** Generate a random bash command */
export const bashCommand: fc.Arbitrary<string> = grammar.command;

/** Generate a random bash word with possible expansions */
export const bashWord: fc.Arbitrary<string> = grammar.word;

/** Generate a random bash expansion */
export const bashExpansion: fc.Arbitrary<string> = grammar.expansion;

/** Generate a random arithmetic expression */
export const bashArithmetic: fc.Arbitrary<string> = grammar.arithmeticExpr;

/** Generate a random compound command (control structure) */
export const bashCompound: fc.Arbitrary<string> = grammar.compoundCommand;

/** Generate a random simple command */
export const bashSimpleCommand: fc.Arbitrary<string> = grammar.simpleCommand;

// =============================================================================
// PROTOTYPE POLLUTION FOCUSED GENERATORS
// =============================================================================

/** Generate pollution-focused assignment statements (always uses strict pollution names) */
export const pollutionAssignment: fc.Arbitrary<string> = fc.oneof(
  // Direct assignment to dangerous name
  {
    weight: 5,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, fc.oneof(simpleWord, identifier))
      .map(([name, val]) => `${name}=${val}`),
  },
  // Array assignment with dangerous key
  {
    weight: 5,
    arbitrary: fc
      .tuple(identifier, strictPollutionIdentifier, simpleWord)
      .map(([arr, key, val]) => `${arr}[${key}]=${val}`),
  },
  // Associative array declaration + assignment
  {
    weight: 4,
    arbitrary: fc
      .tuple(identifier, strictPollutionIdentifier, simpleWord)
      .map(([arr, key, val]) => `declare -A ${arr}; ${arr}[${key}]=${val}`),
  },
  // Nameref pointing to dangerous name
  {
    weight: 4,
    arbitrary: fc
      .tuple(identifier, strictPollutionIdentifier)
      .map(([ref, target]) => `declare -n ${ref}=${target}; ${ref}=polluted`),
  },
  // Export dangerous variable
  {
    weight: 3,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, simpleWord)
      .map(([name, val]) => `export ${name}=${val}`),
  },
  // Read into dangerous variable
  {
    weight: 2,
    arbitrary: strictPollutionIdentifier.map(
      (name) => `echo "polluted" | read ${name}`,
    ),
  },
  // Printf -v into dangerous variable
  {
    weight: 2,
    arbitrary: strictPollutionIdentifier.map(
      (name) => `printf -v ${name} '%s' "polluted"`,
    ),
  },
);

/** Generate pollution-focused expansion patterns (always uses strict pollution names) */
export const pollutionExpansion: fc.Arbitrary<string> = fc.oneof(
  // Direct dangerous variable
  { weight: 5, arbitrary: strictPollutionIdentifier.map((v) => `$${v}`) },
  // Braced dangerous variable
  { weight: 5, arbitrary: strictPollutionIdentifier.map((v) => `\${${v}}`) },
  // Indirect expansion of dangerous name
  { weight: 5, arbitrary: strictPollutionIdentifier.map((v) => `\${!${v}}`) },
  // Indirect with @ suffix
  { weight: 4, arbitrary: strictPollutionIdentifier.map((v) => `\${!${v}@}`) },
  // Array with dangerous index
  {
    weight: 4,
    arbitrary: fc
      .tuple(identifier, strictPollutionIdentifier)
      .map(([arr, idx]) => `\${${arr}[${idx}]}`),
  },
  // Dangerous array subscript
  {
    weight: 3,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, fc.constantFrom("0", "@", "*"))
      .map(([arr, idx]) => `\${${arr}[${idx}]}`),
  },
  // Default value pollution
  {
    weight: 3,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, strictPollutionIdentifier)
      .map(([v, d]) => `\${${v}:-${d}}`),
  },
  // Assign default pollution
  {
    weight: 3,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, simpleWord)
      .map(([v, d]) => `\${${v}:=${d}}`),
  },
  // Error if unset with dangerous name
  {
    weight: 2,
    arbitrary: strictPollutionIdentifier.map((v) => `\${${v}:?error}`),
  },
);

/** Generate complete pollution test scripts (always uses strict pollution names) */
export const pollutionScript: fc.Arbitrary<string> = fc.oneof(
  // Assignment then echo
  {
    weight: 5,
    arbitrary: fc
      .tuple(pollutionAssignment, pollutionExpansion)
      .map(([assign, expand]) => `${assign}; echo ${expand}`),
  },
  // Multiple pollution attempts
  {
    weight: 3,
    arbitrary: fc
      .array(pollutionAssignment, { minLength: 2, maxLength: 4 })
      .map((assigns) => assigns.join("; ")),
  },
  // Pollution in loop
  {
    weight: 2,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, pollutionAssignment)
      .map(
        ([v, assign]) =>
          `for ${v} in __proto__ constructor prototype; do ${assign}; done`,
      ),
  },
  // Pollution in function
  {
    weight: 2,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, pollutionAssignment)
      .map(([name, body]) => `${name}() { ${body}; }; ${name}`),
  },
  // Eval with pollution
  {
    weight: 2,
    arbitrary: pollutionAssignment.map((assign) => `eval '${assign}'`),
  },
);

// =============================================================================
// COMMAND-SPECIFIC GENERATORS
// =============================================================================

/** Safe filename for testing (no special chars that could cause issues) */
const safeFilename: fc.Arbitrary<string> = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_-"), {
    minLength: 1,
    maxLength: 12,
  })
  .map((s) => s || "file");

/** Safe path component */
const safePath: fc.Arbitrary<string> = fc.oneof(
  safeFilename,
  safeFilename.map((f) => `${f}.txt`),
  safeFilename.map((f) => `${f}.json`),
  fc.constantFrom(".", "..", "/tmp", "/home/user"),
);

/** Number for counts/limits */
const smallNumber: fc.Arbitrary<number> = fc.integer({ min: 1, max: 20 });

/** Text content for input */
const textContent: fc.Arbitrary<string> = fc.oneof(
  simpleWord,
  fc.constantFrom("hello", "world", "test", "foo", "bar", "line1\\nline2"),
);

// --- Text Processing Commands ---

/** cat command variations */
export const catCommand: fc.Arbitrary<string> = fc.oneof(
  safePath.map((p) => `cat ${p}`),
  fc.tuple(safePath, safePath).map(([a, b]) => `cat ${a} ${b}`),
  safePath.map((p) => `cat -n ${p}`),
  safePath.map((p) => `cat -A ${p}`),
  textContent.map((t) => `echo "${t}" | cat`),
);

/** head/tail command variations */
export const headTailCommand: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(fc.constantFrom("head", "tail"), safePath)
    .map(([c, p]) => `${c} ${p}`),
  fc
    .tuple(fc.constantFrom("head", "tail"), smallNumber, safePath)
    .map(([c, n, p]) => `${c} -n ${n} ${p}`),
  fc
    .tuple(fc.constantFrom("head", "tail"), smallNumber)
    .map(([c, n]) => `echo "line1\\nline2\\nline3" | ${c} -n ${n}`),
);

/** grep command variations */
export const grepCommand: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(simpleWord, safePath).map(([pat, p]) => `grep "${pat}" ${p}`),
  fc.tuple(simpleWord, safePath).map(([pat, p]) => `grep -i "${pat}" ${p}`),
  fc.tuple(simpleWord, safePath).map(([pat, p]) => `grep -v "${pat}" ${p}`),
  fc.tuple(simpleWord, safePath).map(([pat, p]) => `grep -c "${pat}" ${p}`),
  fc.tuple(simpleWord, safePath).map(([pat, p]) => `grep -n "${pat}" ${p}`),
  fc.tuple(simpleWord, safePath).map(([pat, p]) => `grep -l "${pat}" ${p}`),
  fc.tuple(simpleWord, safePath).map(([pat, p]) => `grep -E "${pat}" ${p}`),
  simpleWord.map((pat) => `echo "test line" | grep "${pat}"`),
);

/** sed command variations */
export const sedCommand: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(simpleWord, simpleWord, safePath)
    .map(([a, b, p]) => `sed 's/${a}/${b}/' ${p}`),
  fc
    .tuple(simpleWord, simpleWord, safePath)
    .map(([a, b, p]) => `sed 's/${a}/${b}/g' ${p}`),
  fc.tuple(smallNumber, safePath).map(([n, p]) => `sed -n '${n}p' ${p}`),
  fc.tuple(smallNumber, safePath).map(([n, p]) => `sed '${n}d' ${p}`),
  simpleWord.map((w) => `echo "hello world" | sed 's/hello/${w}/'`),
);

/** awk command variations */
export const awkCommand: fc.Arbitrary<string> = fc.oneof(
  safePath.map((p) => `awk '{print}' ${p}`),
  safePath.map((p) => `awk '{print $1}' ${p}`),
  safePath.map((p) => `awk '{print $NF}' ${p}`),
  safePath.map((p) => `awk '{print NR, $0}' ${p}`),
  fc.tuple(simpleWord, safePath).map(([pat, p]) => `awk '/${pat}/' ${p}`),
  safePath.map((p) => `awk -F: '{print $1}' ${p}`),
  safePath.map((p) => `awk 'BEGIN{sum=0} {sum+=1} END{print sum}' ${p}`),
  fc.constant(`echo "1 2 3" | awk '{print $1 + $2 + $3}'`),
);

/** sort command variations */
export const sortCommand: fc.Arbitrary<string> = fc.oneof(
  safePath.map((p) => `sort ${p}`),
  safePath.map((p) => `sort -r ${p}`),
  safePath.map((p) => `sort -n ${p}`),
  safePath.map((p) => `sort -u ${p}`),
  safePath.map((p) => `sort -k1 ${p}`),
  fc.constant(`echo "c\\nb\\na" | sort`),
);

/** uniq command variations */
export const uniqCommand: fc.Arbitrary<string> = fc.oneof(
  safePath.map((p) => `uniq ${p}`),
  safePath.map((p) => `uniq -c ${p}`),
  safePath.map((p) => `uniq -d ${p}`),
  safePath.map((p) => `uniq -u ${p}`),
  fc.constant(`echo "a\\na\\nb\\nb\\nc" | uniq -c`),
);

/** wc command variations */
export const wcCommand: fc.Arbitrary<string> = fc.oneof(
  safePath.map((p) => `wc ${p}`),
  safePath.map((p) => `wc -l ${p}`),
  safePath.map((p) => `wc -w ${p}`),
  safePath.map((p) => `wc -c ${p}`),
  fc.constant(`echo "hello world" | wc -w`),
);

/** cut command variations */
export const cutCommand: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(smallNumber, safePath).map(([n, p]) => `cut -f${n} ${p}`),
  fc.tuple(smallNumber, safePath).map(([n, p]) => `cut -d: -f${n} ${p}`),
  fc.tuple(smallNumber, safePath).map(([n, p]) => `cut -c${n} ${p}`),
  fc.constant(`echo "a:b:c" | cut -d: -f2`),
);

/** tr command variations */
export const trCommand: fc.Arbitrary<string> = fc.oneof(
  fc.constant(`echo "hello" | tr 'a-z' 'A-Z'`),
  fc.constant(`echo "hello" | tr -d 'l'`),
  fc.constant(`echo "hello" | tr -s 'l'`),
  fc.constant(`echo "hello  world" | tr -s ' '`),
);

// --- File Operations ---

/** ls command variations */
export const lsCommand: fc.Arbitrary<string> = fc.oneof(
  fc.constant("ls"),
  safePath.map((p) => `ls ${p}`),
  safePath.map((p) => `ls -l ${p}`),
  safePath.map((p) => `ls -la ${p}`),
  safePath.map((p) => `ls -lh ${p}`),
  safePath.map((p) => `ls -R ${p}`),
  safePath.map((p) => `ls -1 ${p}`),
);

/** File manipulation commands */
export const fileManipCommand: fc.Arbitrary<string> = fc.oneof(
  safeFilename.map((f) => `touch ${f}`),
  safeFilename.map((f) => `mkdir -p ${f}`),
  safeFilename.map((f) => `rm -f ${f}`),
  safeFilename.map((f) => `rmdir ${f}`),
  fc.tuple(safeFilename, safeFilename).map(([a, b]) => `cp ${a} ${b}`),
  fc.tuple(safeFilename, safeFilename).map(([a, b]) => `mv ${a} ${b}`),
  fc.tuple(safeFilename, safeFilename).map(([a, b]) => `ln -s ${a} ${b}`),
);

/** stat/file commands */
export const statCommand: fc.Arbitrary<string> = fc.oneof(
  safePath.map((p) => `stat ${p}`),
  safePath.map((p) => `file ${p}`),
  safePath.map((p) => `readlink ${p}`),
  safePath.map((p) => `du ${p}`),
  safePath.map((p) => `du -h ${p}`),
);

/** find command variations */
export const findCommand: fc.Arbitrary<string> = fc.oneof(
  safePath.map((p) => `find ${p}`),
  fc.tuple(safePath, safeFilename).map(([p, n]) => `find ${p} -name "${n}"`),
  fc
    .tuple(safePath, safeFilename)
    .map(([p, n]) => `find ${p} -type f -name "*.${n}"`),
  safePath.map((p) => `find ${p} -type d`),
  safePath.map((p) => `find ${p} -maxdepth 2`),
);

// --- Data Processing ---

/** jq command variations */
export const jqCommand: fc.Arbitrary<string> = fc.oneof(
  fc.constant(`echo '{"a":1}' | jq '.'`),
  fc.constant(`echo '{"a":1}' | jq '.a'`),
  fc.constant(`echo '[1,2,3]' | jq '.[]'`),
  fc.constant(`echo '{"a":{"b":1}}' | jq '.a.b'`),
  fc.constant(`echo '[{"a":1},{"a":2}]' | jq '.[].a'`),
  safePath.map((p) => `jq '.' ${p}`),
);

/** base64 command variations */
export const base64Command: fc.Arbitrary<string> = fc.oneof(
  textContent.map((t) => `echo "${t}" | base64`),
  textContent.map((t) => `echo "${t}" | base64 | base64 -d`),
  safePath.map((p) => `base64 ${p}`),
);

/** gzip command variations */
export const gzipCommand: fc.Arbitrary<string> = fc.oneof(
  textContent.map((t) => `echo "${t}" | gzip | gzip -d`),
  safePath.map((p) => `gzip -c ${p}`),
  safePath.map((p) => `gzip -l ${p}`),
);

// --- Output Commands ---

/** echo command variations */
export const echoCommand: fc.Arbitrary<string> = fc.oneof(
  textContent.map((t) => `echo "${t}"`),
  textContent.map((t) => `echo -n "${t}"`),
  textContent.map((t) => `echo -e "${t}"`),
  fc
    .array(textContent, { minLength: 1, maxLength: 3 })
    .map((a) => `echo ${a.join(" ")}`),
);

/** printf command variations */
export const printfCommand: fc.Arbitrary<string> = fc.oneof(
  textContent.map((t) => `printf "%s\\n" "${t}"`),
  fc.integer({ min: 0, max: 1000 }).map((n) => `printf "%d\\n" ${n}`),
  fc.integer({ min: 0, max: 1000 }).map((n) => `printf "%05d\\n" ${n}`),
  fc.constant(`printf "%s %s\\n" hello world`),
);

/** seq command variations */
export const seqCommand: fc.Arbitrary<string> = fc.oneof(
  smallNumber.map((n) => `seq ${n}`),
  fc
    .tuple(smallNumber, smallNumber)
    .map(([a, b]) => `seq ${a} ${Math.max(a, b)}`),
  fc
    .tuple(smallNumber, smallNumber)
    .map(([a, b]) => `seq -s, 1 ${Math.max(a, b)}`),
);

/** expr command variations */
export const exprCommand: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(smallNumber, smallNumber).map(([a, b]) => `expr ${a} + ${b}`),
  fc.tuple(smallNumber, smallNumber).map(([a, b]) => `expr ${a} \\* ${b}`),
  fc
    .tuple(smallNumber, smallNumber)
    .map(([a, b]) => `expr ${a} / ${Math.max(1, b)}`),
  fc.tuple(textContent, simpleWord).map(([s, p]) => `expr "${s}" : "${p}"`),
);

// --- Utility Commands ---

/** date command variations */
export const dateCommand: fc.Arbitrary<string> = fc.oneof(
  fc.constant("date"),
  fc.constant("date +%Y-%m-%d"),
  fc.constant("date +%H:%M:%S"),
  fc.constant("date +%s"),
  fc.constant("date -u"),
);

/** Environment commands */
export const envCommand: fc.Arbitrary<string> = fc.oneof(
  fc.constant("env"),
  fc.constant("hostname"),
  fc.constant("whoami"),
  fc.constant("pwd"),
  fc.constant("which bash"),
  safeFilename.map((f) => `which ${f}`),
);

/** Path manipulation */
export const pathCommand: fc.Arbitrary<string> = fc.oneof(
  safePath.map((p) => `basename ${p}`),
  safePath.map((p) => `dirname ${p}`),
  safePath.map((p) => `realpath ${p}`),
);

/** test command variations */
export const testCommand: fc.Arbitrary<string> = fc.oneof(
  safePath.map((p) => `test -e ${p}`),
  safePath.map((p) => `test -f ${p}`),
  safePath.map((p) => `test -d ${p}`),
  safePath.map((p) => `[ -e ${p} ]`),
  safePath.map((p) => `[[ -e ${p} ]]`),
  fc.tuple(smallNumber, smallNumber).map(([a, b]) => `test ${a} -eq ${b}`),
  fc.tuple(smallNumber, smallNumber).map(([a, b]) => `[ ${a} -lt ${b} ]`),
  textContent.map((t) => `test -n "${t}"`),
  textContent.map((t) => `test -z "${t}"`),
);

/** xargs command variations */
export const xargsCommand: fc.Arbitrary<string> = fc.oneof(
  fc.constant(`echo "a b c" | xargs echo`),
  fc.constant(`echo "a\\nb\\nc" | xargs -n1 echo`),
  fc.constant(`echo "1 2 3" | xargs -I{} echo "item: {}"`),
);

/** diff command variations */
export const diffCommand: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(safePath, safePath).map(([a, b]) => `diff ${a} ${b}`),
  fc.tuple(safePath, safePath).map(([a, b]) => `diff -u ${a} ${b}`),
  fc.tuple(safePath, safePath).map(([a, b]) => `diff -q ${a} ${b}`),
);

// =============================================================================
// AWK GRAMMAR GENERATOR
// =============================================================================

/** AWK field reference */
const awkField: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom("$0", "$1", "$2", "$3", "$NF") },
  { weight: 2, arbitrary: smallNumber.map((n) => `$${n}`) },
  { weight: 1, arbitrary: fc.constantFrom("$(NF-1)", "$(NF-2)") },
);

/** AWK variable name */
const awkVar: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: identifier },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      "NR",
      "NF",
      "FS",
      "RS",
      "OFS",
      "ORS",
      "FILENAME",
      "FNR",
    ),
  },
);

/** AWK dangerous variable name (for pollution testing) */
const awkDangerousVar: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: strictPollutionIdentifier },
  // Array subscript with pollution key
  {
    weight: 3,
    arbitrary: fc
      .tuple(identifier, strictPollutionIdentifier)
      .map(([arr, key]) => `${arr}["${key}"]`),
  },
  // Pollution key as variable
  {
    weight: 2,
    arbitrary: strictPollutionIdentifier.map((p) => `"${p}"`),
  },
);

/** AWK string literal */
const awkString: fc.Arbitrary<string> = simpleWord.map((s) => `"${s}"`);

/** AWK regex pattern */
const awkRegex: fc.Arbitrary<string> = fc.oneof(
  simpleWord.map((s) => `/${s}/`),
  fc.constantFrom("/^/", "/$/", "/./", "/[0-9]+/", "/[a-z]+/", "/\\s+/"),
);

/** AWK expression */
const awkExpr: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: awkField },
  { weight: 3, arbitrary: awkVar },
  { weight: 3, arbitrary: awkString },
  { weight: 2, arbitrary: integerLiteral },
  // Arithmetic
  {
    weight: 2,
    arbitrary: fc
      .tuple(awkField, fc.constantFrom("+", "-", "*", "/", "%"), awkField)
      .map(([a, op, b]) => `${a} ${op} ${b}`),
  },
  // String concatenation
  {
    weight: 2,
    arbitrary: fc.tuple(awkField, awkField).map(([a, b]) => `${a} ${b}`),
  },
  // Comparison
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        awkField,
        fc.constantFrom("==", "!=", "<", ">", "<=", ">="),
        awkField,
      )
      .map(([a, op, b]) => `${a} ${op} ${b}`),
  },
  // Regex match
  {
    weight: 2,
    arbitrary: fc
      .tuple(awkField, fc.constantFrom("~", "!~"), awkRegex)
      .map(([f, op, r]) => `${f} ${op} ${r}`),
  },
  // Built-in functions
  {
    weight: 2,
    arbitrary: fc.oneof(
      awkField.map((f) => `length(${f})`),
      awkField.map((f) => `tolower(${f})`),
      awkField.map((f) => `toupper(${f})`),
      fc.tuple(awkField, awkRegex).map(([f, r]) => `gsub(${r}, "", ${f})`),
      fc.tuple(awkField, awkRegex).map(([f, r]) => `sub(${r}, "", ${f})`),
      fc.tuple(awkField, awkString).map(([f, s]) => `index(${f}, ${s})`),
      fc
        .tuple(awkField, smallNumber, smallNumber)
        .map(([f, a, b]) => `substr(${f}, ${a}, ${b})`),
      fc.tuple(awkField, awkString).map(([f, s]) => `split(${f}, arr, ${s})`),
    ),
  },
  // Ternary
  {
    weight: 1,
    arbitrary: fc
      .tuple(awkField, awkField, awkField)
      .map(([c, t, f]) => `${c} ? ${t} : ${f}`),
  },
);

/** AWK print statement */
const awkPrint: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.constant("print") },
  { weight: 5, arbitrary: awkExpr.map((e) => `print ${e}`) },
  {
    weight: 3,
    arbitrary: fc
      .array(awkExpr, { minLength: 2, maxLength: 4 })
      .map((es) => `print ${es.join(", ")}`),
  },
  {
    weight: 2,
    arbitrary: fc
      .tuple(awkString, fc.array(awkExpr, { minLength: 1, maxLength: 3 }))
      .map(([fmt, args]) => `printf ${fmt}, ${args.join(", ")}`),
  },
);

/** AWK action (statement list) */
const awkAction: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: awkPrint },
  // Assignment
  {
    weight: 3,
    arbitrary: fc.tuple(awkVar, awkExpr).map(([v, e]) => `${v} = ${e}`),
  },
  // Increment/decrement
  {
    weight: 2,
    arbitrary: fc
      .tuple(awkVar, fc.constantFrom("++", "--"))
      .map(([v, op]) => `${v}${op}`),
  },
  // If statement
  {
    weight: 2,
    arbitrary: fc
      .tuple(awkExpr, awkPrint)
      .map(([cond, body]) => `if (${cond}) ${body}`),
  },
  // Multiple statements
  {
    weight: 2,
    arbitrary: fc.tuple(awkPrint, awkPrint).map(([a, b]) => `${a}; ${b}`),
  },
  // next/exit
  { weight: 1, arbitrary: fc.constantFrom("next", "exit", "exit 1") },
);

/** AWK pattern */
const awkPattern: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.constant("") }, // No pattern (match all)
  { weight: 3, arbitrary: awkRegex },
  { weight: 2, arbitrary: awkExpr },
  { weight: 2, arbitrary: fc.constantFrom("BEGIN", "END") },
  // Range pattern
  {
    weight: 1,
    arbitrary: fc.tuple(awkRegex, awkRegex).map(([a, b]) => `${a}, ${b}`),
  },
);

/** AWK rule (pattern + action) */
const awkRule: fc.Arbitrary<string> = fc.oneof(
  // Pattern only (implicit print)
  {
    weight: 2,
    arbitrary: awkPattern.filter(
      (p) => p !== "" && p !== "BEGIN" && p !== "END",
    ),
  },
  // Action only
  { weight: 3, arbitrary: awkAction.map((a) => `{ ${a} }`) },
  // Pattern + action
  {
    weight: 5,
    arbitrary: fc
      .tuple(awkPattern, awkAction)
      .map(([p, a]) => (p ? `${p} { ${a} }` : `{ ${a} }`)),
  },
);

/** Complete AWK program */
export const awkProgram: fc.Arbitrary<string> = fc.oneof(
  // Single rule
  { weight: 5, arbitrary: awkRule },
  // BEGIN + rule
  {
    weight: 2,
    arbitrary: fc
      .tuple(awkAction, awkRule)
      .map(([b, r]) => `BEGIN { ${b} } ${r}`),
  },
  // Rule + END
  {
    weight: 2,
    arbitrary: fc
      .tuple(awkRule, awkAction)
      .map(([r, e]) => `${r} END { ${e} }`),
  },
  // Multiple rules
  {
    weight: 2,
    arbitrary: fc
      .array(awkRule, { minLength: 2, maxLength: 3 })
      .map((rules) => rules.join(" ")),
  },
);

/** AWK command with program and optional input */
export const awkGrammarCommand: fc.Arbitrary<string> = fc.oneof(
  awkProgram.map((p) => `echo "a b c" | awk '${p}'`),
  awkProgram.map((p) => `echo "1:2:3" | awk -F: '${p}'`),
  fc.tuple(awkProgram, safePath).map(([p, f]) => `awk '${p}' ${f}`),
  fc.tuple(awkProgram, safePath).map(([p, f]) => `awk -F, '${p}' ${f}`),
);

/** AWK pollution-focused expression */
const awkPollutionExpr: fc.Arbitrary<string> = fc.oneof(
  // Direct dangerous variable access
  { weight: 5, arbitrary: awkDangerousVar },
  // Assignment to dangerous variable
  {
    weight: 5,
    arbitrary: fc
      .tuple(awkDangerousVar, awkExpr)
      .map(([v, e]) => `${v} = ${e}`),
  },
  // Array with pollution key
  {
    weight: 4,
    arbitrary: fc
      .tuple(identifier, strictPollutionIdentifier, awkExpr)
      .map(([arr, key, val]) => `${arr}["${key}"] = ${val}`),
  },
  // Pollution key in string concatenation
  {
    weight: 3,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, awkField)
      .map(([p, f]) => `"${p}" ${f}`),
  },
  // gsub/sub with pollution pattern
  {
    weight: 3,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, strictPollutionIdentifier)
      .map(([a, b]) => `gsub(/${a}/, "${b}")`),
  },
  // Index with pollution string
  {
    weight: 2,
    arbitrary: fc
      .tuple(awkField, strictPollutionIdentifier)
      .map(([f, p]) => `index(${f}, "${p}")`),
  },
  // Split with pollution separator
  {
    weight: 2,
    arbitrary: fc
      .tuple(awkField, strictPollutionIdentifier)
      .map(([f, p]) => `split(${f}, arr, "${p}")`),
  },
);

/** AWK pollution-focused action */
const awkPollutionAction: fc.Arbitrary<string> = fc.oneof(
  // Print pollution variable
  { weight: 5, arbitrary: awkPollutionExpr.map((e) => `print ${e}`) },
  // Assign to pollution variable
  { weight: 5, arbitrary: awkPollutionExpr },
  // Print pollution string literal
  {
    weight: 3,
    arbitrary: strictPollutionIdentifier.map((p) => `print "${p}"`),
  },
  // Printf with pollution
  {
    weight: 2,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, awkPollutionExpr)
      .map(([p, e]) => `printf "${p}: %s\\n", ${e}`),
  },
);

/** AWK pollution-focused rule */
const awkPollutionRule: fc.Arbitrary<string> = fc.oneof(
  // Action with pollution
  { weight: 5, arbitrary: awkPollutionAction.map((a) => `{ ${a} }`) },
  // Pattern matching pollution string
  {
    weight: 3,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, awkPollutionAction)
      .map(([p, a]) => `/${p}/ { ${a} }`),
  },
  // BEGIN with pollution setup
  {
    weight: 2,
    arbitrary: awkPollutionAction.map((a) => `BEGIN { ${a} }`),
  },
  // END with pollution
  {
    weight: 2,
    arbitrary: awkPollutionAction.map((a) => `END { ${a} }`),
  },
);

/** AWK pollution-focused program */
export const awkPollutionProgram: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: awkPollutionRule },
  // Multiple pollution rules
  {
    weight: 3,
    arbitrary: fc
      .array(awkPollutionRule, { minLength: 2, maxLength: 3 })
      .map((rules) => rules.join(" ")),
  },
  // BEGIN + pollution rule
  {
    weight: 2,
    arbitrary: fc
      .tuple(awkPollutionAction, awkPollutionRule)
      .map(([b, r]) => `BEGIN { ${b} } ${r}`),
  },
);

/** AWK pollution-focused command */
export const awkPollutionCommand: fc.Arbitrary<string> = fc.oneof(
  // With pollution-laden input
  {
    weight: 5,
    arbitrary: awkPollutionProgram.map(
      (p) => `echo "__proto__ constructor prototype" | awk '${p}'`,
    ),
  },
  // Pollution keys as field separator
  {
    weight: 3,
    arbitrary: awkPollutionProgram.map(
      (p) => `echo "a__proto__b" | awk -F__proto__ '${p}'`,
    ),
  },
  // Variable assignment from shell
  {
    weight: 3,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, awkPollutionProgram)
      .map(([v, p]) => `awk -v ${v}=polluted '${p}'`),
  },
  // Multiple pollution variables
  {
    weight: 2,
    arbitrary: awkPollutionProgram.map(
      (p) =>
        `awk -v __proto__=a -v constructor=b -v prototype=c '${p}' </dev/null`,
    ),
  },
);

// =============================================================================
// SED GRAMMAR GENERATOR
// =============================================================================

/** SED address (line number or regex) */
const sedAddress: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: smallNumber.map(String) },
  { weight: 2, arbitrary: fc.constantFrom("$", "1", "2") },
  { weight: 3, arbitrary: simpleWord.map((s) => `/${s}/`) },
  { weight: 1, arbitrary: fc.constantFrom("/^/", "/$/", "/./") },
);

/** SED address range */
const sedRange: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.constant("") }, // No address
  { weight: 3, arbitrary: sedAddress },
  // Range
  {
    weight: 2,
    arbitrary: fc.tuple(sedAddress, sedAddress).map(([a, b]) => `${a},${b}`),
  },
);

/** SED replacement flags */
const sedFlags: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc.constant("g"),
  fc.constant("i"),
  fc.constant("p"),
  fc.constant("gi"),
  fc.constant("gp"),
  smallNumber.map(String),
);

/** SED s command (substitute) */
const sedSubstitute: fc.Arbitrary<string> = fc.oneof(
  // Basic substitution
  {
    weight: 5,
    arbitrary: fc
      .tuple(simpleWord, simpleWord, sedFlags)
      .map(([pat, repl, flags]) => `s/${pat}/${repl}/${flags}`),
  },
  // With backreference
  {
    weight: 2,
    arbitrary: fc
      .tuple(simpleWord, sedFlags)
      .map(([pat, flags]) => `s/\\(${pat}\\)/[\\1]/${flags}`),
  },
  // Delete pattern
  {
    weight: 2,
    arbitrary: simpleWord.map((pat) => `s/${pat}//g`),
  },
  // With different delimiter
  {
    weight: 1,
    arbitrary: fc
      .tuple(simpleWord, simpleWord)
      .map(([pat, repl]) => `s|${pat}|${repl}|g`),
  },
);

/** SED command */
const sedCmd: fc.Arbitrary<string> = fc.oneof(
  // Substitute (most common)
  { weight: 10, arbitrary: sedSubstitute },
  // Delete
  { weight: 3, arbitrary: fc.constant("d") },
  // Print
  { weight: 3, arbitrary: fc.constant("p") },
  // Quit
  { weight: 1, arbitrary: fc.constant("q") },
  // Next
  { weight: 2, arbitrary: fc.constant("n") },
  // Append text
  {
    weight: 2,
    arbitrary: simpleWord.map((t) => `a\\${t}`),
  },
  // Insert text
  {
    weight: 2,
    arbitrary: simpleWord.map((t) => `i\\${t}`),
  },
  // Change text
  {
    weight: 1,
    arbitrary: simpleWord.map((t) => `c\\${t}`),
  },
  // Transliterate
  {
    weight: 2,
    arbitrary: fc.constantFrom("y/abc/ABC/", "y/a-z/A-Z/", "y/aeiou/AEIOU/"),
  },
  // Print line number
  { weight: 1, arbitrary: fc.constant("=") },
);

/** SED expression (address + command) */
const sedExpr: fc.Arbitrary<string> = fc.oneof(
  // Command only
  { weight: 3, arbitrary: sedCmd },
  // Address + command
  {
    weight: 5,
    arbitrary: fc
      .tuple(sedRange, sedCmd)
      .map(([addr, cmd]) => (addr ? `${addr}${cmd}` : cmd)),
  },
  // Negated address
  {
    weight: 1,
    arbitrary: fc
      .tuple(sedAddress, sedCmd)
      .map(([addr, cmd]) => `${addr}!${cmd}`),
  },
);

/** Complete SED program */
export const sedProgram: fc.Arbitrary<string> = fc.oneof(
  // Single expression
  { weight: 5, arbitrary: sedExpr },
  // Multiple expressions with semicolon
  {
    weight: 3,
    arbitrary: fc
      .array(sedExpr, { minLength: 2, maxLength: 3 })
      .map((exprs) => exprs.join(";")),
  },
);

/** SED command with program and input */
export const sedGrammarCommand: fc.Arbitrary<string> = fc.oneof(
  sedProgram.map((p) => `echo "hello world" | sed '${p}'`),
  sedProgram.map((p) => `echo "line1\\nline2\\nline3" | sed '${p}'`),
  fc.tuple(sedProgram, safePath).map(([p, f]) => `sed '${p}' ${f}`),
  // With -n flag (quiet mode)
  sedProgram.map((p) => `echo "test" | sed -n '${p}'`),
  // With -E flag (extended regex)
  sedProgram.map((p) => `echo "test" | sed -E '${p}'`),
  // Multiple -e expressions
  {
    weight: 1,
    arbitrary: fc
      .tuple(sedExpr, sedExpr)
      .map(([a, b]) => `echo "test" | sed -e '${a}' -e '${b}'`),
  },
);

/** SED pollution-focused substitution */
const sedPollutionSubstitute: fc.Arbitrary<string> = fc.oneof(
  // Substitute with pollution pattern
  {
    weight: 5,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, simpleWord)
      .map(([pat, repl]) => `s/${pat}/${repl}/g`),
  },
  // Replace with pollution string
  {
    weight: 5,
    arbitrary: fc
      .tuple(simpleWord, strictPollutionIdentifier)
      .map(([pat, repl]) => `s/${pat}/${repl}/g`),
  },
  // Both pattern and replacement are pollution
  {
    weight: 5,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, strictPollutionIdentifier)
      .map(([pat, repl]) => `s/${pat}/${repl}/g`),
  },
  // Backreference with pollution
  {
    weight: 3,
    arbitrary: strictPollutionIdentifier.map((p) => `s/\\(${p}\\)/[\\1]/g`),
  },
  // Chain of pollution replacements
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        strictPollutionIdentifier,
        strictPollutionIdentifier,
        strictPollutionIdentifier,
      )
      .map(([a, b, c]) => `s/${a}/${b}/g;s/${b}/${c}/g`),
  },
);

/** SED pollution-focused command */
const sedPollutionCmd: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: sedPollutionSubstitute },
  // Append pollution text
  {
    weight: 3,
    arbitrary: strictPollutionIdentifier.map((p) => `a\\${p}`),
  },
  // Insert pollution text
  {
    weight: 3,
    arbitrary: strictPollutionIdentifier.map((p) => `i\\${p}`),
  },
  // Change to pollution text
  {
    weight: 2,
    arbitrary: strictPollutionIdentifier.map((p) => `c\\${p}`),
  },
  // Transliterate involving pollution chars
  {
    weight: 2,
    arbitrary: fc.constantFrom("y/_/-/", "y/aeiou/AEIOU/"),
  },
);

/** SED pollution-focused expression */
const sedPollutionExpr: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: sedPollutionCmd },
  // Address matching pollution pattern
  {
    weight: 3,
    arbitrary: fc
      .tuple(strictPollutionIdentifier, sedPollutionCmd)
      .map(([addr, cmd]) => `/${addr}/${cmd}`),
  },
  // Range with pollution pattern
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        strictPollutionIdentifier,
        strictPollutionIdentifier,
        sedPollutionCmd,
      )
      .map(([a, b, cmd]) => `/${a}/,/${b}/${cmd}`),
  },
);

/** SED pollution-focused program */
export const sedPollutionProgram: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: sedPollutionExpr },
  // Multiple pollution expressions
  {
    weight: 3,
    arbitrary: fc
      .array(sedPollutionExpr, { minLength: 2, maxLength: 3 })
      .map((exprs) => exprs.join(";")),
  },
);

/** SED pollution-focused command */
export const sedPollutionCommand: fc.Arbitrary<string> = fc.oneof(
  // Input contains pollution strings
  {
    weight: 5,
    arbitrary: sedPollutionProgram.map(
      (p) => `echo "__proto__ constructor prototype" | sed '${p}'`,
    ),
  },
  // Multiple pollution inputs
  {
    weight: 3,
    arbitrary: sedPollutionProgram.map(
      (p) =>
        `printf "%s\\n" __proto__ constructor prototype valueOf | sed '${p}'`,
    ),
  },
  // Pollution in here-string
  {
    weight: 3,
    arbitrary: sedPollutionProgram.map(
      (p) => `sed '${p}' <<< "__proto__=polluted"`,
    ),
  },
  // File with pollution content
  {
    weight: 2,
    arbitrary: fc
      .tuple(sedPollutionProgram, safePath)
      .map(([prog, f]) => `sed '${prog}' ${f}`),
  },
);

// =============================================================================
// JQ GRAMMAR GENERATOR
// =============================================================================

/** JQ identifier (object key) */
const jqKey: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: identifier },
  {
    weight: 2,
    arbitrary: fc.constantFrom("name", "value", "id", "type", "data", "items"),
  },
  // Quoted key for special chars
  { weight: 1, arbitrary: simpleWord.map((s) => `"${s}"`) },
);

/** JQ simple filter */
const jqSimpleFilter: fc.Arbitrary<string> = fc.oneof(
  // Identity
  { weight: 3, arbitrary: fc.constant(".") },
  // Object key access
  { weight: 5, arbitrary: jqKey.map((k) => `.${k}`) },
  // Array index
  { weight: 3, arbitrary: smallNumber.map((n) => `.[${n}]`) },
  // Array iterator
  { weight: 3, arbitrary: fc.constant(".[]") },
  // Object key iterator
  { weight: 2, arbitrary: fc.constant("keys") },
  { weight: 2, arbitrary: fc.constant("keys[]") },
  // Optional access
  { weight: 2, arbitrary: jqKey.map((k) => `.${k}?`) },
  { weight: 2, arbitrary: fc.constant(".[]?") },
);

/** JQ built-in function */
const jqBuiltin: fc.Arbitrary<string> = fc.oneof(
  // Type functions
  fc.constantFrom("type", "keys", "values", "length", "empty", "error"),
  // Array functions
  fc.constantFrom(
    "first",
    "last",
    "nth(0)",
    "reverse",
    "sort",
    "unique",
    "flatten",
    "group_by(.)",
    "min",
    "max",
    "add",
  ),
  // String functions
  fc.constantFrom(
    "ascii_downcase",
    "ascii_upcase",
    'ltrimstr("a")',
    'rtrimstr("a")',
    'split(" ")',
    'join(" ")',
    'test("a")',
    'match("a")',
  ),
  // Object functions
  fc.constantFrom("to_entries", "from_entries", "with_entries(.)"),
  // Math
  fc.constantFrom("floor", "ceil", "round", "sqrt", "fabs"),
  // Conditionals
  fc.constantFrom("not", "select(. > 0)", "select(. != null)"),
);

/** JQ expression */
const jqExpr: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: jqSimpleFilter },
  { weight: 3, arbitrary: jqBuiltin },
  // Chained filters
  {
    weight: 4,
    arbitrary: fc
      .tuple(jqSimpleFilter, jqSimpleFilter)
      .map(([a, b]) => `${a} | ${b}`),
  },
  // Object construction
  {
    weight: 2,
    arbitrary: fc.tuple(jqKey, jqSimpleFilter).map(([k, v]) => `{${k}: ${v}}`),
  },
  // Array construction
  {
    weight: 2,
    arbitrary: fc
      .array(jqSimpleFilter, { minLength: 1, maxLength: 3 })
      .map((fs) => `[${fs.join(", ")}]`),
  },
  // Comparison
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        jqSimpleFilter,
        fc.constantFrom("==", "!=", "<", ">", "<=", ">="),
        jqSimpleFilter,
      )
      .map(([a, op, b]) => `${a} ${op} ${b}`),
  },
  // Arithmetic
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        jqSimpleFilter,
        fc.constantFrom("+", "-", "*", "/"),
        jqSimpleFilter,
      )
      .map(([a, op, b]) => `${a} ${op} ${b}`),
  },
  // Conditional
  {
    weight: 1,
    arbitrary: fc
      .tuple(jqSimpleFilter, jqSimpleFilter, jqSimpleFilter)
      .map(([c, t, f]) => `if ${c} then ${t} else ${f} end`),
  },
  // Try-catch
  {
    weight: 1,
    arbitrary: jqSimpleFilter.map((f) => `try ${f} catch "error"`),
  },
  // Map
  {
    weight: 2,
    arbitrary: jqSimpleFilter.map((f) => `map(${f})`),
  },
  // Select
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        jqSimpleFilter,
        fc.constantFrom("!=", "=="),
        fc.constantFrom("null", "0", '""'),
      )
      .map(([f, op, v]) => `select(${f} ${op} ${v})`),
  },
);

/** Complete JQ filter */
export const jqFilter: fc.Arbitrary<string> = fc.oneof(
  // Single expression
  { weight: 5, arbitrary: jqExpr },
  // Piped expressions
  {
    weight: 3,
    arbitrary: fc
      .array(jqExpr, { minLength: 2, maxLength: 3 })
      .map((exprs) => exprs.join(" | ")),
  },
  // Comma-separated (multiple outputs)
  {
    weight: 2,
    arbitrary: fc.tuple(jqExpr, jqExpr).map(([a, b]) => `${a}, ${b}`),
  },
);

/** JQ command with filter and JSON input */
export const jqGrammarCommand: fc.Arbitrary<string> = fc.oneof(
  // Simple object
  jqFilter.map((f) => `echo '{"a":1,"b":2}' | jq '${f}'`),
  // Array
  jqFilter.map((f) => `echo '[1,2,3]' | jq '${f}'`),
  // Nested object
  jqFilter.map((f) => `echo '{"a":{"b":1}}' | jq '${f}'`),
  // Array of objects
  jqFilter.map((f) => `echo '[{"a":1},{"a":2}]' | jq '${f}'`),
  // With file
  fc
    .tuple(jqFilter, safePath)
    .map(([f, p]) => `jq '${f}' ${p}`),
  // Raw output
  jqFilter.map((f) => `echo '{"a":"test"}' | jq -r '${f}'`),
  // Compact output
  jqFilter.map((f) => `echo '{"a":1}' | jq -c '${f}'`),
  // Slurp mode
  jqFilter.map((f) => `echo '1\\n2\\n3' | jq -s '${f}'`),
);

/** JQ pollution key (dangerous object keys) */
const jqPollutionKey: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: strictPollutionIdentifier },
  // Quoted pollution key
  {
    weight: 3,
    arbitrary: strictPollutionIdentifier.map((p) => `"${p}"`),
  },
);

/** JQ pollution simple filter (accessing dangerous keys) */
const jqPollutionSimpleFilter: fc.Arbitrary<string> = fc.oneof(
  // Direct access to pollution key
  { weight: 5, arbitrary: jqPollutionKey.map((k) => `.${k}`) },
  // Optional access to pollution key
  { weight: 4, arbitrary: jqPollutionKey.map((k) => `.${k}?`) },
  // Nested pollution access
  {
    weight: 4,
    arbitrary: fc
      .tuple(jqPollutionKey, jqPollutionKey)
      .map(([a, b]) => `.${a}.${b}`),
  },
  // Array of pollution keys
  {
    weight: 3,
    arbitrary: fc
      .tuple(jqPollutionKey, fc.integer({ min: 0, max: 5 }))
      .map(([k, i]) => `.${k}[${i}]`),
  },
  // Iterate over pollution key array
  {
    weight: 3,
    arbitrary: jqPollutionKey.map((k) => `.${k}[]`),
  },
  // Has pollution key
  {
    weight: 2,
    arbitrary: jqPollutionKey.map((k) => `has("${k}")`),
  },
  // Get path containing pollution
  {
    weight: 2,
    arbitrary: jqPollutionKey.map((k) => `getpath(["${k}"])`),
  },
  // Set path with pollution
  {
    weight: 2,
    arbitrary: fc
      .tuple(jqPollutionKey, simpleWord)
      .map(([k, v]) => `setpath(["${k}"]; "${v}")`),
  },
  // Delete pollution key
  {
    weight: 2,
    arbitrary: jqPollutionKey.map((k) => `del(.${k})`),
  },
);

/** JQ pollution expression */
const jqPollutionExpr: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: jqPollutionSimpleFilter },
  // Object construction with pollution keys
  {
    weight: 5,
    arbitrary: fc
      .tuple(jqPollutionKey, jqSimpleFilter)
      .map(([k, v]) => `{"${k}": ${v}}`),
  },
  // Multiple pollution keys in object
  {
    weight: 4,
    arbitrary: fc
      .tuple(jqPollutionKey, jqPollutionKey)
      .map(([a, b]) => `{"${a}": 1, "${b}": 2}`),
  },
  // Update pollution key
  {
    weight: 3,
    arbitrary: fc
      .tuple(jqPollutionKey, simpleWord)
      .map(([k, v]) => `.${k} = "${v}"`),
  },
  // Update with pollution value
  {
    weight: 3,
    arbitrary: fc
      .tuple(jqKey, jqPollutionKey)
      .map(([k, v]) => `.${k} = "${v}"`),
  },
  // Pipe through pollution filter
  {
    weight: 3,
    arbitrary: fc
      .tuple(jqSimpleFilter, jqPollutionSimpleFilter)
      .map(([a, b]) => `${a} | ${b}`),
  },
  // Map with pollution
  {
    weight: 2,
    arbitrary: jqPollutionSimpleFilter.map((f) => `map(${f})`),
  },
  // Select with pollution
  {
    weight: 2,
    arbitrary: jqPollutionKey.map((k) => `select(.${k} != null)`),
  },
  // With_entries accessing pollution
  {
    weight: 2,
    arbitrary: jqPollutionKey.map(
      (k) => `with_entries(select(.key == "${k}"))`,
    ),
  },
  // Recursive descent with pollution
  {
    weight: 2,
    arbitrary: jqPollutionKey.map((k) => `.. | .${k}? // empty`),
  },
);

/** JQ pollution-focused program */
export const jqPollutionFilter: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: jqPollutionExpr },
  // Piped pollution expressions
  {
    weight: 3,
    arbitrary: fc
      .array(jqPollutionExpr, { minLength: 2, maxLength: 3 })
      .map((exprs) => exprs.join(" | ")),
  },
  // Alternative with pollution
  {
    weight: 2,
    arbitrary: fc
      .tuple(jqPollutionExpr, jqPollutionExpr)
      .map(([a, b]) => `(${a}) // (${b})`),
  },
);

/** JQ pollution-focused command */
export const jqPollutionCommand: fc.Arbitrary<string> = fc.oneof(
  // JSON with pollution keys
  {
    weight: 5,
    arbitrary: jqPollutionFilter.map(
      (f) =>
        `echo '{"__proto__":{"polluted":true},"constructor":1}' | jq '${f}'`,
    ),
  },
  // Nested pollution structure
  {
    weight: 4,
    arbitrary: jqPollutionFilter.map(
      (f) => `echo '{"a":{"__proto__":1},"b":{"constructor":2}}' | jq '${f}'`,
    ),
  },
  // Array with pollution objects
  {
    weight: 4,
    arbitrary: jqPollutionFilter.map(
      (f) =>
        `echo '[{"__proto__":1},{"constructor":2},{"prototype":3}]' | jq '${f}'`,
    ),
  },
  // Pollution in values
  {
    weight: 3,
    arbitrary: jqPollutionFilter.map(
      (f) => `echo '{"key":"__proto__","value":"constructor"}' | jq '${f}'`,
    ),
  },
  // Deep nesting with pollution
  {
    weight: 3,
    arbitrary: jqPollutionFilter.map(
      (f) => `echo '{"__proto__":{"__proto__":{"constructor":1}}}' | jq '${f}'`,
    ),
  },
  // Pollution with toString/valueOf
  {
    weight: 2,
    arbitrary: jqPollutionFilter.map(
      (f) =>
        `echo '{"toString":"evil","valueOf":"bad","__proto__":null}' | jq '${f}'`,
    ),
  },
  // Raw output with pollution
  {
    weight: 2,
    arbitrary: jqPollutionFilter.map(
      (f) => `echo '{"__proto__":"test"}' | jq -r '${f}'`,
    ),
  },
);

// --- Combined Command Generator ---

/** Generate a random command from all supported commands */
export const supportedCommand: fc.Arbitrary<string> = fc.oneof(
  // Text processing (higher weight - most commonly used)
  { weight: 3, arbitrary: catCommand },
  { weight: 3, arbitrary: grepCommand },
  { weight: 2, arbitrary: sedCommand },
  { weight: 2, arbitrary: awkCommand },
  { weight: 2, arbitrary: sortCommand },
  { weight: 2, arbitrary: cutCommand },
  { weight: 2, arbitrary: headTailCommand },
  { weight: 1, arbitrary: uniqCommand },
  { weight: 1, arbitrary: wcCommand },
  { weight: 1, arbitrary: trCommand },
  // File operations
  { weight: 2, arbitrary: lsCommand },
  { weight: 1, arbitrary: fileManipCommand },
  { weight: 1, arbitrary: statCommand },
  { weight: 1, arbitrary: findCommand },
  // Data processing
  { weight: 2, arbitrary: jqCommand },
  { weight: 1, arbitrary: base64Command },
  { weight: 1, arbitrary: gzipCommand },
  // Output
  { weight: 3, arbitrary: echoCommand },
  { weight: 2, arbitrary: printfCommand },
  { weight: 1, arbitrary: seqCommand },
  { weight: 1, arbitrary: exprCommand },
  // Utility
  { weight: 1, arbitrary: dateCommand },
  { weight: 1, arbitrary: envCommand },
  { weight: 1, arbitrary: pathCommand },
  { weight: 2, arbitrary: testCommand },
  { weight: 1, arbitrary: xargsCommand },
  { weight: 1, arbitrary: diffCommand },
);

/** Generate a pipeline of supported commands */
export const commandPipeline: fc.Arbitrary<string> = fc.oneof(
  supportedCommand,
  fc.tuple(supportedCommand, supportedCommand).map(([a, b]) => `${a} | ${b}`),
  fc
    .tuple(supportedCommand, supportedCommand, supportedCommand)
    .map(([a, b, c]) => `${a} | ${b} | ${c}`),
);

/** Generate a script using multiple supported commands */
export const commandScript: fc.Arbitrary<string> = fc
  .array(supportedCommand, { minLength: 1, maxLength: 4 })
  .map((cmds) => cmds.join("\n"));

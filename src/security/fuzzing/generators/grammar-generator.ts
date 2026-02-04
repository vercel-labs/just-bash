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

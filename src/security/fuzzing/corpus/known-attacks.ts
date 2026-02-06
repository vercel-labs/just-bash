/**
 * Known Attack Corpus
 *
 * Seed corpus of known attack patterns to ensure coverage.
 * These attacks should all be blocked or handled gracefully.
 */

export interface AttackCase {
  /** Name of the attack */
  name: string;
  /** The attack script */
  script: string;
  /** Category of attack */
  category:
    | "sandbox_escape"
    | "dos"
    | "prototype_pollution"
    | "arithmetic"
    | "injection";
  /** Expected behavior: "blocked" means error/rejection, "limited" means gracefully hit limits */
  expected: "blocked" | "limited" | "safe";
  /** Optional description */
  description?: string;
}

/**
 * Known sandbox escape attempts.
 */
export const SANDBOX_ESCAPES: AttackCase[] = [
  {
    name: "cat /etc/passwd",
    script: "cat /etc/passwd 2>&1 || true",
    category: "sandbox_escape",
    expected: "blocked",
    description: "Direct file read of sensitive system file",
  },
  {
    name: "path traversal /etc/passwd",
    script: "cat ../../../etc/passwd 2>&1 || true",
    category: "sandbox_escape",
    expected: "blocked",
    description: "Path traversal to read sensitive file",
  },
  {
    name: "command substitution passwd",
    script: "echo $(cat /etc/passwd) 2>&1 || true",
    category: "sandbox_escape",
    expected: "blocked",
    description: "File read via command substitution",
  },
  {
    name: "source /etc/passwd",
    script: "source /etc/passwd 2>&1 || true",
    category: "sandbox_escape",
    expected: "blocked",
    description: "Source sensitive file as script",
  },
  {
    name: "eval cat",
    script: 'eval "cat /etc/passwd" 2>&1 || true',
    category: "sandbox_escape",
    expected: "blocked",
    description: "Eval-based file read",
  },
  {
    name: "proc environ",
    script: "cat /proc/self/environ 2>&1 || true",
    category: "sandbox_escape",
    expected: "blocked",
    description: "Read process environment from /proc",
  },
  {
    name: "symlink escape",
    script: "ln -s /etc/passwd link && cat link 2>&1 || true",
    category: "sandbox_escape",
    expected: "blocked",
    description: "Symlink-based escape attempt",
  },
  {
    name: "home directory escape",
    script: "cat ~/.bashrc 2>&1 || true",
    category: "sandbox_escape",
    expected: "blocked",
    description: "Read user home directory files",
  },
  {
    name: "glob escape",
    script: "ls /etc/* 2>&1 || true",
    category: "sandbox_escape",
    expected: "blocked",
    description: "Glob pattern to list system files",
  },
  {
    name: "redirect from sensitive file",
    script: "cat < /etc/passwd 2>&1 || true",
    category: "sandbox_escape",
    expected: "blocked",
    description: "Input redirection from sensitive file",
  },
];

/**
 * Known DOS/resource exhaustion attacks.
 */
export const DOS_ATTACKS: AttackCase[] = [
  {
    name: "infinite while loop",
    script: "while :; do :; done",
    category: "dos",
    expected: "limited",
    description: "Classic infinite loop",
  },
  {
    name: "infinite until loop",
    script: "until false; do :; done",
    category: "dos",
    expected: "limited",
    description: "Until loop that never exits",
  },
  {
    name: "infinite for loop",
    script: "for ((;;)); do :; done",
    category: "dos",
    expected: "limited",
    description: "C-style infinite for loop",
  },
  {
    name: "recursive function",
    script: "f() { f; }; f",
    category: "dos",
    expected: "limited",
    description: "Unbounded recursive function",
  },
  {
    name: "mutual recursion",
    script: "a() { b; }; b() { a; }; a",
    category: "dos",
    expected: "limited",
    description: "Mutually recursive functions",
  },
  {
    name: "fork bomb attempt",
    script: ":(){ :|:& };:",
    category: "dos",
    expected: "limited",
    description: "Fork bomb (should fail to fork)",
  },
  {
    name: "brace explosion",
    script: "echo {1..100}{1..100}{1..100}",
    category: "dos",
    expected: "limited",
    description: "Combinatorial brace expansion",
  },
  {
    name: "command count bomb",
    script: "for i in $(seq 1 100000); do echo $i; done",
    category: "dos",
    expected: "limited",
    description: "Excessive command count",
  },
  {
    name: "nested command substitution",
    script:
      "echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo $(echo 1))))))))))",
    category: "dos",
    expected: "limited",
    description: "Deeply nested command substitution",
  },
  {
    name: "deep arithmetic nesting",
    script: "echo $(($(($(($(($(($(($(($(($(($((1)))))))))))))))))))))",
    category: "dos",
    expected: "limited",
    description: "Deeply nested arithmetic",
  },
  {
    name: "glob bomb",
    script: "shopt -s globstar; ls **/* 2>&1 || true",
    category: "dos",
    expected: "limited",
    description: "Recursive glob expansion",
  },
];

/**
 * Known prototype pollution attacks.
 */
export const POLLUTION_ATTACKS: AttackCase[] = [
  {
    name: "__proto__ assignment",
    script: "__proto__=polluted; echo $__proto__",
    category: "prototype_pollution",
    expected: "safe",
    description: "Direct __proto__ variable assignment",
  },
  {
    name: "constructor assignment",
    script: "constructor=polluted; echo $constructor",
    category: "prototype_pollution",
    expected: "safe",
    description: "Direct constructor variable assignment",
  },
  {
    name: "associative array __proto__",
    script: "declare -A obj; obj[__proto__]=polluted; echo ${obj[__proto__]}",
    category: "prototype_pollution",
    expected: "safe",
    description: "Associative array __proto__ key",
  },
  {
    name: "indirect __proto__",
    script: 'name=__proto__; declare "$name"=polluted; echo ${!name}',
    category: "prototype_pollution",
    expected: "safe",
    description: "Indirect variable name pollution",
  },
  {
    name: "export __proto__",
    script: "export __proto__=polluted; printenv __proto__ || true",
    category: "prototype_pollution",
    expected: "safe",
    description: "Export __proto__ to environment",
  },
];

/**
 * Known arithmetic edge cases.
 */
export const ARITHMETIC_ATTACKS: AttackCase[] = [
  {
    name: "division by zero",
    script: "echo $((1/0)) 2>&1 || true",
    category: "arithmetic",
    expected: "safe",
    description: "Division by zero should error gracefully",
  },
  {
    name: "modulo by zero",
    script: "echo $((1%0)) 2>&1 || true",
    category: "arithmetic",
    expected: "safe",
    description: "Modulo by zero should error gracefully",
  },
  {
    name: "integer overflow",
    script: "echo $((2147483647 + 1))",
    category: "arithmetic",
    expected: "safe",
    description: "32-bit integer overflow",
  },
  {
    name: "integer underflow",
    script: "echo $((-2147483648 - 1))",
    category: "arithmetic",
    expected: "safe",
    description: "32-bit integer underflow",
  },
  {
    name: "large exponent",
    script: "echo $((2**63)) 2>&1 || true",
    category: "arithmetic",
    expected: "safe",
    description: "Large exponentiation",
  },
  {
    name: "shift overflow",
    script: "echo $((1 << 100)) 2>&1 || true",
    category: "arithmetic",
    expected: "safe",
    description: "Bit shift by large amount",
  },
];

/**
 * Known injection attacks.
 */
export const INJECTION_ATTACKS: AttackCase[] = [
  {
    name: "command injection via variable",
    script: 'cmd="echo pwned"; $cmd',
    category: "injection",
    expected: "safe",
    description: "Variable containing command",
  },
  {
    name: "semicolon injection",
    script: 'x="a; echo pwned"; echo $x',
    category: "injection",
    expected: "safe",
    description: "Semicolon in variable value",
  },
  {
    name: "backtick injection",
    script: "x='`echo pwned`'; echo $x",
    category: "injection",
    expected: "safe",
    description: "Backtick in variable value",
  },
  {
    name: "nested eval",
    script: "eval 'eval \"echo test\"'",
    category: "injection",
    expected: "safe",
    description: "Nested eval execution",
  },
  {
    name: "variable in arithmetic",
    script: "x='1+1'; echo $(($x))",
    category: "injection",
    expected: "safe",
    description: "Expression in variable",
  },
];

/**
 * Complete corpus of known attacks.
 */
export const KNOWN_ATTACK_CORPUS: AttackCase[] = [
  ...SANDBOX_ESCAPES,
  ...DOS_ATTACKS,
  ...POLLUTION_ATTACKS,
  ...ARITHMETIC_ATTACKS,
  ...INJECTION_ATTACKS,
];

/**
 * Get attacks by category.
 */
export function getAttacksByCategory(
  category: AttackCase["category"],
): AttackCase[] {
  return KNOWN_ATTACK_CORPUS.filter((a) => a.category === category);
}

/**
 * Get attacks by expected behavior.
 */
export function getAttacksByExpected(
  expected: AttackCase["expected"],
): AttackCase[] {
  return KNOWN_ATTACK_CORPUS.filter((a) => a.expected === expected);
}

/**
 * Sandbox Oracle
 *
 * Detects sandbox escape attempts in fuzz results.
 */

import type { FuzzResult } from "../runners/fuzz-runner.js";

/**
 * Patterns that indicate sensitive file content was leaked.
 */
const SENSITIVE_PATTERNS = [
  // /etc/passwd format: username:x:uid:gid:...
  /^[a-z_][a-z0-9_-]*:[x*]:(\d+):(\d+):/m,
  // /etc/shadow format
  /^[a-z_][a-z0-9_-]*:[$*!].*:/m,
  // SSH private key
  /-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/,
  // Environment variables leak
  /^(PATH|HOME|USER|SHELL|PWD)=/m,
  // /proc content
  /\/proc\/\d+\//,
  // AWS credentials
  /AWS_ACCESS_KEY_ID=/,
  /AWS_SECRET_ACCESS_KEY=/,
  // Generic secrets
  /password\s*[=:]/i,
  /secret\s*[=:]/i,
  /api[_-]?key\s*[=:]/i,
];

/**
 * Patterns that indicate JavaScript native code was accessed.
 */
const JS_NATIVE_PATTERNS = [
  // Function constructor
  /function\s+Function\s*\(/,
  /\[native code\]/,
  // Object prototype
  /\[object Object\]/,
  /\[object Function\]/,
  // Process access
  /process\.env/,
  /process\.exit/,
  // Require/import
  /require\s*\(/,
  /import\s*\(/,
];

/**
 * Result of sandbox oracle check.
 */
export interface SandboxOracleResult {
  /** Whether the sandbox was potentially escaped */
  escaped: boolean;
  /** Specific issues detected */
  issues: SandboxIssue[];
}

/**
 * A specific sandbox issue detected.
 */
export interface SandboxIssue {
  /** Type of issue */
  type:
    | "sensitive_file_leak"
    | "js_native_access"
    | "defense_violation"
    | "unexpected_file_access"
    | "environment_leak";
  /** Description of the issue */
  description: string;
  /** Evidence (matched content) */
  evidence?: string;
}

/**
 * Oracle for detecting sandbox escape attempts.
 */
export class SandboxOracle {
  /**
   * Check a fuzz result for sandbox escape indicators.
   */
  check(result: FuzzResult): SandboxOracleResult {
    const issues: SandboxIssue[] = [];

    // Check for defense-in-depth violations
    if (result.violations.length > 0) {
      for (const violation of result.violations) {
        issues.push({
          type: "defense_violation",
          description: `Defense-in-depth violation: ${violation.message}`,
          evidence: violation.path,
        });
      }
    }

    // Check stdout and stderr for sensitive content
    const output = (result.stdout || "") + (result.stderr || "");

    // Check for sensitive file content
    for (const pattern of SENSITIVE_PATTERNS) {
      const match = output.match(pattern);
      if (match) {
        issues.push({
          type: "sensitive_file_leak",
          description: `Sensitive file content detected in output`,
          evidence: match[0].substring(0, 100),
        });
      }
    }

    // Check for JS native access
    for (const pattern of JS_NATIVE_PATTERNS) {
      const match = output.match(pattern);
      if (match) {
        issues.push({
          type: "js_native_access",
          description: `JavaScript native code access detected`,
          evidence: match[0].substring(0, 100),
        });
      }
    }

    // Check for environment variable leaks (common attack vector)
    if (/^[A-Z_]+=.+$/m.test(output) && !/^(TERM|LANG|LC_)/.test(output)) {
      const envMatches = output.match(/^[A-Z_]+=.+$/gm);
      if (envMatches && envMatches.length > 3) {
        issues.push({
          type: "environment_leak",
          description: `Environment variables leaked in output`,
          evidence: envMatches.slice(0, 3).join(", "),
        });
      }
    }

    return {
      escaped: issues.length > 0,
      issues,
    };
  }

  /**
   * Check if output contains any sensitive patterns.
   */
  containsSensitiveData(output: string): boolean {
    return SENSITIVE_PATTERNS.some((p) => p.test(output));
  }

  /**
   * Check if output contains JavaScript native code indicators.
   */
  containsNativeCode(output: string): boolean {
    return JS_NATIVE_PATTERNS.some((p) => p.test(output));
  }

  /**
   * Get a summary of issues.
   */
  summarize(result: SandboxOracleResult): string {
    if (!result.escaped) {
      return "No sandbox escape detected";
    }

    const summary = result.issues
      .map((i) => `- ${i.type}: ${i.description}`)
      .join("\n");

    return `Sandbox escape detected:\n${summary}`;
  }
}

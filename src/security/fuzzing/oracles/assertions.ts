/**
 * Reusable security assertions for fuzz testing and manual tests.
 *
 * These assertions check for common security issues like native code exposure
 * and prototype pollution indicators.
 */

import { expect } from "vitest";

/**
 * Patterns that indicate JavaScript native code was exposed.
 * These should NEVER appear in bash/jq output.
 */
const NATIVE_CODE_PATTERNS = [
  // Native function indicator
  /\[native code\]/,
  // Function signatures that look like JS
  /function\s+\w+\s*\(\s*\)\s*\{/,
  // Object prototype access
  /\[object Function\]/,
  // JS object toString leak
  /\[object Object\]/,
  // Common JS native functions
  /function\s+(toString|valueOf|hasOwnProperty|constructor)\s*\(/,
];

/**
 * Patterns that indicate prototype pollution may have occurred.
 */
const POLLUTION_INDICATOR_PATTERNS = [
  // Accessing prototype chain
  /Object\.prototype/,
  /Function\.prototype/,
  // Process/global access
  /process\.env/,
  /process\.exit/,
  /globalThis/,
  // Module system
  /require\s*\(\s*['"`]/,
  /import\s*\(\s*['"`]/,
];

export interface SecurityCheckResult {
  safe: boolean;
  issues: string[];
}

/**
 * Check if output contains native JavaScript code indicators.
 */
export function checkForNativeCode(output: string): SecurityCheckResult {
  const issues: string[] = [];

  for (const pattern of NATIVE_CODE_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      issues.push(`Native code exposed: "${match[0].substring(0, 50)}"`);
    }
  }

  return { safe: issues.length === 0, issues };
}

/**
 * Check if output contains prototype pollution indicators.
 */
export function checkForPollutionIndicators(
  output: string,
): SecurityCheckResult {
  const issues: string[] = [];

  for (const pattern of POLLUTION_INDICATOR_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      issues.push(`Pollution indicator: "${match[0].substring(0, 50)}"`);
    }
  }

  return { safe: issues.length === 0, issues };
}

/**
 * Combined security check for output.
 */
export function checkOutputSecurity(output: string): SecurityCheckResult {
  const nativeCheck = checkForNativeCode(output);
  const pollutionCheck = checkForPollutionIndicators(output);

  return {
    safe: nativeCheck.safe && pollutionCheck.safe,
    issues: [...nativeCheck.issues, ...pollutionCheck.issues],
  };
}

/**
 * Assert that output does not contain native JavaScript code.
 * Use this in tests to verify bash/jq output is safe.
 *
 * @example
 * const result = await env.exec("echo ${__proto__}");
 * assertNoNativeCode(result.stdout);
 * assertNoNativeCode(result.stderr);
 */
export function assertNoNativeCode(
  output: string | undefined,
  context?: string,
): void {
  const result = checkForNativeCode(output || "");
  const message = context
    ? `${context}: ${result.issues.join(", ")}`
    : result.issues.join(", ");
  expect(result.safe, message).toBe(true);
}

/**
 * Assert that output does not contain prototype pollution indicators.
 *
 * @example
 * const result = await env.exec("echo ${constructor}");
 * assertNoPollutionIndicators(result.stdout);
 */
export function assertNoPollutionIndicators(
  output: string | undefined,
  context?: string,
): void {
  const result = checkForPollutionIndicators(output || "");
  const message = context
    ? `${context}: ${result.issues.join(", ")}`
    : result.issues.join(", ");
  expect(result.safe, message).toBe(true);
}

/**
 * Assert that output is safe from all known security issues.
 * Combines native code and pollution indicator checks.
 *
 * @example
 * const result = await env.exec(script);
 * assertOutputSafe(result.stdout, "stdout");
 * assertOutputSafe(result.stderr, "stderr");
 */
export function assertOutputSafe(
  output: string | undefined,
  context?: string,
): void {
  const result = checkOutputSecurity(output || "");
  const message = context
    ? `${context}: ${result.issues.join(", ")}`
    : result.issues.join(", ");
  expect(result.safe, message).toBe(true);
}

/**
 * Assert that a bash execution result is safe.
 * Checks both stdout and stderr.
 *
 * @example
 * const result = await env.exec(script);
 * assertExecResultSafe(result);
 */
export function assertExecResultSafe(result: {
  stdout?: string;
  stderr?: string;
}): void {
  assertOutputSafe(result.stdout, "stdout");
  assertOutputSafe(result.stderr, "stderr");
}

/**
 * Security Violation Logger
 *
 * Utility for tracking and reporting security violations from the
 * defense-in-depth box. Useful for monitoring, alerting, and debugging.
 *
 * IMPORTANT: This is for monitoring a SECONDARY defense layer.
 * Violations indicate potential escape attempts but the primary
 * security should prevent these from being exploitable.
 */

import type { SecurityViolation, SecurityViolationType } from "./types.js";

/**
 * Options for the security violation logger.
 */
export interface SecurityViolationLoggerOptions {
  /**
   * Maximum number of violations to store per type.
   * Default: 100
   */
  maxViolationsPerType?: number;

  /**
   * Whether to include stack traces in logged violations.
   * Default: true
   */
  includeStackTraces?: boolean;

  /**
   * Custom handler called for each violation.
   */
  onViolation?: (violation: SecurityViolation) => void;

  /**
   * Whether to log violations to console (for debugging).
   * Default: false
   */
  logToConsole?: boolean;
}

/**
 * Summary of violations by type.
 */
export interface ViolationSummary {
  type: SecurityViolationType;
  count: number;
  firstSeen: number;
  lastSeen: number;
  paths: string[];
}

/**
 * Security Violation Logger
 *
 * Collects and summarizes security violations for analysis.
 */
export class SecurityViolationLogger {
  private violations: SecurityViolation[] = [];
  private violationsByType: Map<SecurityViolationType, SecurityViolation[]> =
    new Map();
  private options: Required<SecurityViolationLoggerOptions>;

  constructor(options: SecurityViolationLoggerOptions = {}) {
    this.options = {
      maxViolationsPerType: options.maxViolationsPerType ?? 100,
      includeStackTraces: options.includeStackTraces ?? true,
      onViolation: options.onViolation ?? (() => {}),
      logToConsole: options.logToConsole ?? false,
    };
  }

  /**
   * Record a security violation.
   * This method is designed to be passed as the onViolation callback.
   */
  record(violation: SecurityViolation): void {
    // Optionally strip stack trace
    const processedViolation = this.options.includeStackTraces
      ? violation
      : { ...violation, stack: undefined };

    // Store in main list (most recent first)
    this.violations.unshift(processedViolation);

    // Store by type
    let typeList = this.violationsByType.get(violation.type);
    if (!typeList) {
      typeList = [];
      this.violationsByType.set(violation.type, typeList);
    }

    // Add to type list with cap
    if (typeList.length < this.options.maxViolationsPerType) {
      typeList.push(processedViolation);
    }

    // Log to console if enabled
    if (this.options.logToConsole) {
      console.warn(
        `[SecurityViolation] ${violation.type}: ${violation.message}`,
        violation.path,
      );
    }

    // Call custom handler
    this.options.onViolation(processedViolation);
  }

  /**
   * Get all recorded violations.
   */
  getViolations(): SecurityViolation[] {
    return [...this.violations];
  }

  /**
   * Get violations of a specific type.
   */
  getViolationsByType(type: SecurityViolationType): SecurityViolation[] {
    return [...(this.violationsByType.get(type) ?? [])];
  }

  /**
   * Get a summary of all violations by type.
   */
  getSummary(): ViolationSummary[] {
    const summaries: ViolationSummary[] = [];

    for (const [type, violations] of this.violationsByType) {
      if (violations.length === 0) continue;

      const paths = new Set<string>();
      let firstSeen = Number.POSITIVE_INFINITY;
      let lastSeen = 0;

      for (const v of violations) {
        paths.add(v.path);
        firstSeen = Math.min(firstSeen, v.timestamp);
        lastSeen = Math.max(lastSeen, v.timestamp);
      }

      summaries.push({
        type,
        count: violations.length,
        firstSeen,
        lastSeen,
        paths: Array.from(paths),
      });
    }

    // Sort by count descending
    summaries.sort((a, b) => b.count - a.count);

    return summaries;
  }

  /**
   * Get total violation count.
   */
  getTotalCount(): number {
    return this.violations.length;
  }

  /**
   * Check if any violations have been recorded.
   */
  hasViolations(): boolean {
    return this.violations.length > 0;
  }

  /**
   * Clear all recorded violations.
   */
  clear(): void {
    this.violations = [];
    this.violationsByType.clear();
  }

  /**
   * Create a callback function suitable for DefenseInDepthConfig.onViolation.
   */
  createCallback(): (violation: SecurityViolation) => void {
    return (violation) => this.record(violation);
  }
}

/**
 * Create a simple violation callback that logs to console.
 */
export function createConsoleViolationCallback(): (
  violation: SecurityViolation,
) => void {
  return (violation) => {
    console.warn(
      `[DefenseInDepth] Security violation detected:`,
      `\n  Type: ${violation.type}`,
      `\n  Path: ${violation.path}`,
      `\n  Message: ${violation.message}`,
      violation.executionId ? `\n  ExecutionId: ${violation.executionId}` : "",
    );
  };
}

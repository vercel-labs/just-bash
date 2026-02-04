/**
 * Fuzz Runner
 *
 * Core executor for fuzz tests with timeout and memory monitoring.
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { Bash } from "../../../Bash.js";
import type { BashExecResult } from "../../../types.js";
import type { SecurityViolation } from "../../types.js";
import { DEFAULT_FUZZ_CONFIG, type FuzzingConfig } from "../config.js";

/**
 * Result of a fuzz test execution.
 */
export interface FuzzResult {
  /** The script that was executed */
  script: string;

  /** Whether execution completed without timeout */
  completed: boolean;

  /** Whether execution timed out */
  timedOut: boolean;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Memory delta during execution in bytes */
  memoryDeltaBytes: number;

  /** The bash execution result (if completed) */
  bashResult?: BashExecResult;

  /** Any error that occurred */
  error?: Error;

  /** Defense-in-depth violations detected */
  violations: SecurityViolation[];

  /** Whether the execution hit a limit gracefully */
  hitLimit: boolean;

  /** Exit code from bash (if available) */
  exitCode?: number;

  /** Stderr output (if available) */
  stderr?: string;

  /** Stdout output (if available) */
  stdout?: string;
}

/**
 * Fuzz runner that executes bash scripts with timeout and memory monitoring.
 */
export class FuzzRunner {
  private config: FuzzingConfig;
  private scriptCount = 0;

  constructor(config?: Partial<FuzzingConfig>) {
    this.config = { ...DEFAULT_FUZZ_CONFIG, ...config };

    // Clear the script log file at start if configured
    if (this.config.scriptLogFile) {
      try {
        writeFileSync(
          this.config.scriptLogFile,
          `# Fuzz test scripts - ${new Date().toISOString()}\n# Config: numRuns=${this.config.numRuns}, timeout=${this.config.timeoutMs}ms\n\n`,
        );
      } catch {
        // Ignore errors if file can't be written
      }
    }

    // Note: failure log is append-only, never cleared
  }

  /**
   * Log script at start of execution (in case test times out).
   */
  private logScriptStart(script: string): void {
    if (!this.config.scriptLogFile) return;

    this.scriptCount++;
    try {
      appendFileSync(
        this.config.scriptLogFile,
        `# [${this.scriptCount}] RUNNING...\n${script}\n`,
      );
    } catch {
      // Ignore errors if file can't be written
    }
  }

  /**
   * Log script completion status.
   */
  private logScriptEnd(result: FuzzResult): void {
    if (!this.config.scriptLogFile) return;

    const status = result.timedOut
      ? "TIMEOUT"
      : result.hitLimit
        ? "LIMIT"
        : result.error
          ? "ERROR"
          : "OK";

    try {
      appendFileSync(
        this.config.scriptLogFile,
        `# -> ${status} (${result.durationMs}ms)\n\n`,
      );
    } catch {
      // Ignore errors if file can't be written
    }
  }

  /**
   * Run a fuzz test with the given script.
   */
  async run(script: string): Promise<FuzzResult> {
    // Log script at start (in case of vitest-level timeout)
    this.logScriptStart(script);

    const violations: SecurityViolation[] = [];
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    // Create bash instance with fuzzing config
    const bash = new Bash({
      executionLimits: this.config.executionLimits,
      defenseInDepth: this.config.defenseInDepth
        ? {
            enabled: true,
            auditMode: false,
            onViolation: (v) => violations.push(v),
          }
        : false,
    });

    const result: FuzzResult = {
      script,
      completed: false,
      timedOut: false,
      durationMs: 0,
      memoryDeltaBytes: 0,
      violations,
      hitLimit: false,
    };

    try {
      // Execute with timeout
      const execPromise = bash.exec(script);
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), this.config.timeoutMs),
      );

      const raceResult = await Promise.race([execPromise, timeoutPromise]);

      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;

      result.durationMs = endTime - startTime;
      result.memoryDeltaBytes = endMemory - startMemory;

      if (raceResult === "timeout") {
        result.timedOut = true;
        result.completed = false;
      } else {
        result.completed = true;
        result.bashResult = raceResult;
        result.exitCode = raceResult.exitCode;
        result.stderr = raceResult.stderr;
        result.stdout = raceResult.stdout;

        // Check if execution hit a limit gracefully
        result.hitLimit =
          raceResult.exitCode === 126 ||
          raceResult.stderr.includes("maximum") ||
          raceResult.stderr.includes("limit") ||
          raceResult.stderr.includes("too many") ||
          raceResult.stderr.includes("exceeded");
      }
    } catch (error) {
      const endTime = Date.now();
      const endMemory = process.memoryUsage().heapUsed;

      result.durationMs = endTime - startTime;
      result.memoryDeltaBytes = endMemory - startMemory;
      result.error = error instanceof Error ? error : new Error(String(error));
      result.completed = true; // Error is a form of completion

      // Check if error indicates a limit was hit
      const errorMsg = result.error.message.toLowerCase();
      result.hitLimit =
        errorMsg.includes("limit") ||
        errorMsg.includes("maximum") ||
        errorMsg.includes("exceeded");
    }

    // Log script completion
    this.logScriptEnd(result);

    return result;
  }

  /**
   * Run multiple scripts and collect results.
   */
  async runBatch(scripts: string[]): Promise<FuzzResult[]> {
    const results: FuzzResult[] = [];
    for (const script of scripts) {
      results.push(await this.run(script));
    }
    return results;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): FuzzingConfig {
    return { ...this.config };
  }

  /**
   * Log a test failure to the failure log file.
   * Call this when an assertion fails to record the failing script.
   */
  logFailure(result: FuzzResult, reason: string): void {
    if (!this.config.failureLogFile) return;

    try {
      const entry = [
        `# ===== FAILURE =====`,
        `# Reason: ${reason}`,
        `# Time: ${new Date().toISOString()}`,
        `# Duration: ${result.durationMs}ms`,
        `# Completed: ${result.completed}`,
        `# Timed out: ${result.timedOut}`,
        `# Hit limit: ${result.hitLimit}`,
        `# Exit code: ${result.exitCode}`,
        result.error ? `# Error: ${result.error.message}` : "",
        `# Script:`,
        result.script,
        `# Stdout:`,
        result.stdout || "(empty)",
        `# Stderr:`,
        result.stderr || "(empty)",
        `# ====================\n\n`,
      ]
        .filter(Boolean)
        .join("\n");

      appendFileSync(this.config.failureLogFile, entry);
    } catch {
      // Ignore errors if file can't be written
    }
  }
}

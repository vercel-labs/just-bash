/**
 * Fuzz Runner
 *
 * Core executor for fuzz tests with timeout and memory monitoring.
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Bash } from "../../../Bash.js";
import type { BashExecResult } from "../../../types.js";
import type { SecurityViolation } from "../../types.js";
import {
  createFuzzConfig,
  DEFAULT_FUZZ_CONFIG,
  type FuzzingConfig,
} from "../config.js";
import {
  type CoverageSnapshot,
  FeatureCoverage,
} from "../coverage/feature-coverage.js";

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

  /** Feature coverage snapshot (if coverage enabled) */
  coverage?: CoverageSnapshot;
}

/**
 * Fuzz runner that executes bash scripts with timeout and memory monitoring.
 */
export class FuzzRunner {
  private config: FuzzingConfig;
  private scriptCount = 0;
  private instanceId = randomUUID();
  private logFile?: string;
  private initialization?: Promise<void>;
  private caseIds = new WeakMap<FuzzResult, number>();

  constructor(config?: Partial<FuzzingConfig>) {
    this.config = {
      ...DEFAULT_FUZZ_CONFIG,
      ...config,
      seed: createFuzzConfig(config).seed,
    };
    const identity = this.config.scriptLogFile ?? this.config.failureLogFile;
    if (identity) {
      this.logFile = join(
        process.env.TEST_DIAGNOSTICS_DIR ?? dirname(identity),
        `${basename(identity)}-${process.pid}-${this.instanceId}.jsonl`,
      );
    }
  }

  private async initializeLog(file: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify({
        type: "metadata",
        schemaVersion: 1,
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        pid: process.pid,
        instanceId: this.instanceId,
        suite: this.config.scriptLogFile ?? this.config.failureLogFile,
        seed: this.config.seed,
        numRuns: this.config.numRuns,
        timeoutMs: this.config.timeoutMs,
        memoryLimitBytes: this.config.memoryLimitBytes,
        executionLimits: this.config.executionLimits,
        defenseInDepth: this.config.defenseInDepth,
        cpuThresholdPercent: this.config.cpuThresholdPercent,
        memoryThresholdPercent: this.config.memoryThresholdPercent,
        enableCoverage: this.config.enableCoverage ?? false,
      })}\n`,
      { flag: "wx" },
    );
  }

  private async appendRecord(record: object): Promise<void> {
    if (!this.logFile) return;
    this.initialization ??= this.initializeLog(this.logFile);
    await this.initialization;
    await appendFile(this.logFile, `${JSON.stringify(record)}\n`);
  }

  getDiagnosticsPath(): string | undefined {
    return this.logFile;
  }

  /**
   * Run a fuzz test with the given script.
   */
  async run(script: string, label?: string): Promise<FuzzResult> {
    this.scriptCount += 1;
    const caseId = this.scriptCount;
    try {
      await this.appendRecord({
        type: "start",
        caseId,
        label,
        script,
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
      });
    } catch (error) {
      throw new Error(
        `Fuzz diagnostic start write failed (${this.logFile}); case ${caseId} was not executed`,
        { cause: error },
      );
    }

    const violations: SecurityViolation[] = [];
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    // Create coverage collector if enabled
    const coverageCollector = this.config.enableCoverage
      ? new FeatureCoverage()
      : undefined;

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
      coverage: coverageCollector,
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

    // Use AbortController to cancel exec on timeout
    const controller = new AbortController();
    let timerId: ReturnType<typeof setTimeout> | undefined;

    try {
      const execPromise = bash.exec(script, {
        signal: controller.signal,
      });
      const timeoutPromise = new Promise<"timeout">((resolve) => {
        timerId = setTimeout(() => {
          controller.abort();
          resolve("timeout");
        }, this.config.timeoutMs);
      });

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
    } finally {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
    }

    // Capture coverage snapshot if enabled
    if (coverageCollector) {
      result.coverage = coverageCollector.snapshot();
    }

    this.caseIds.set(result, caseId);
    try {
      await this.appendRecord({
        type: "end",
        caseId,
        durationMs: result.durationMs,
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        completed: result.completed,
        timedOut: result.timedOut,
        hitLimit: result.hitLimit,
        exitCode: result.exitCode,
        error: result.error?.message,
        status: result.timedOut
          ? "TIMEOUT"
          : result.hitLimit
            ? "LIMIT"
            : result.error
              ? "ERROR"
              : "OK",
      });
    } catch (error) {
      console.error(
        `Fuzz diagnostic completion write failed (${this.logFile}): ${String(error)}`,
      );
    }

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
   * Log an assertion failure with its case's diagnostics.
   * Call this when an assertion fails to record the failing script.
   */
  async logFailure(result: FuzzResult, reason: string): Promise<void> {
    if (!this.config.failureLogFile) return;

    try {
      await this.appendRecord({
        type: "assertion-failure",
        caseId: this.caseIds.get(result),
        reason,
        timestamp: new Date().toISOString(),
        script: result.script,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error?.message,
      });
    } catch (error) {
      console.error(
        `Fuzz diagnostic failure write failed (${this.logFile}): ${String(error)}`,
      );
    }
  }
}

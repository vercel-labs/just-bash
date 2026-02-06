/**
 * Feature Coverage Collector
 *
 * Lightweight coverage tracking for fuzzing instrumentation.
 * Records which interpreter features a script exercises.
 */

import type { FeatureCoverageWriter } from "../../../types.js";

/**
 * Snapshot of coverage state at a point in time.
 */
export interface CoverageSnapshot {
  /** Set of feature strings that were hit */
  features: Set<string>;
  /** Hit count per feature */
  counts: Map<string, number>;
}

/**
 * Collects feature coverage hits during script execution.
 * Implements FeatureCoverageWriter for use in interpreter contexts.
 */
export class FeatureCoverage implements FeatureCoverageWriter {
  private features = new Set<string>();
  private counts = new Map<string, number>();

  hit(feature: string): void {
    this.features.add(feature);
    this.counts.set(feature, (this.counts.get(feature) || 0) + 1);
  }

  /**
   * Returns a snapshot of coverage and resets internal state.
   */
  snapshot(): CoverageSnapshot {
    const snap: CoverageSnapshot = {
      features: new Set(this.features),
      counts: new Map(this.counts),
    };
    this.features.clear();
    this.counts.clear();
    return snap;
  }

  /**
   * Returns current features without resetting.
   */
  getFeatures(): ReadonlySet<string> {
    return this.features;
  }

  /**
   * Reset all coverage data.
   */
  reset(): void {
    this.features.clear();
    this.counts.clear();
  }
}

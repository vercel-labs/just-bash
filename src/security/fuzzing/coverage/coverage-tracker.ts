/**
 * Coverage Tracker
 *
 * Aggregates coverage across multiple fuzz runs and identifies
 * newly discovered features.
 */

import type { CoverageSnapshot } from "./feature-coverage.js";
import { ALL_KNOWN_FEATURES, FEATURE_CATEGORIES } from "./known-features.js";

/**
 * Coverage report for a category.
 */
export interface CategoryReport {
  category: string;
  covered: number;
  total: number;
  percent: number;
  uncovered: string[];
}

/**
 * Full coverage report.
 */
export interface CoverageReport {
  totalCovered: number;
  totalKnown: number;
  totalPercent: number;
  categories: CategoryReport[];
  corpus: CorpusEntry[];
}

/**
 * A script in the corpus that discovered new coverage.
 */
export interface CorpusEntry {
  script: string;
  newFeatures: string[];
}

/**
 * Tracks cumulative feature coverage across multiple fuzz runs.
 */
export class CoverageTracker {
  private knownFeatures: ReadonlySet<string>;
  private cumulativeCoverage = new Set<string>();
  private corpus: CorpusEntry[] = [];

  constructor(knownFeatures: readonly string[] = ALL_KNOWN_FEATURES) {
    this.knownFeatures = new Set(knownFeatures);
  }

  /**
   * Record a run's coverage snapshot.
   * Returns array of newly-discovered features (empty if no new coverage).
   */
  recordRun(snapshot: CoverageSnapshot, script: string): string[] {
    const newFeatures: string[] = [];
    for (const feature of snapshot.features) {
      if (!this.cumulativeCoverage.has(feature)) {
        this.cumulativeCoverage.add(feature);
        newFeatures.push(feature);
      }
    }
    if (newFeatures.length > 0) {
      this.corpus.push({ script, newFeatures });
    }
    return newFeatures;
  }

  /**
   * Get scripts that discovered new coverage.
   */
  getCorpus(): readonly CorpusEntry[] {
    return this.corpus;
  }

  /**
   * Get cumulative covered features.
   */
  getCoveredFeatures(): ReadonlySet<string> {
    return this.cumulativeCoverage;
  }

  /**
   * Generate a coverage report with per-category breakdown.
   */
  report(): CoverageReport {
    const categories: CategoryReport[] = [];

    for (const [category, features] of Object.entries(FEATURE_CATEGORIES)) {
      const covered = features.filter((f) =>
        this.cumulativeCoverage.has(f),
      ).length;
      const total = features.length;
      const uncovered = features.filter(
        (f) => !this.cumulativeCoverage.has(f),
      );
      categories.push({
        category,
        covered,
        total,
        percent: total > 0 ? (covered / total) * 100 : 100,
        uncovered,
      });
    }

    const totalCovered = this.cumulativeCoverage.size;
    const totalKnown = this.knownFeatures.size;

    return {
      totalCovered,
      totalKnown,
      totalPercent: totalKnown > 0 ? (totalCovered / totalKnown) * 100 : 100,
      categories,
      corpus: this.corpus,
    };
  }

  /**
   * Reset all tracked coverage.
   */
  reset(): void {
    this.cumulativeCoverage.clear();
    this.corpus = [];
  }
}

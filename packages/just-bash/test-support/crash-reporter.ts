import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Reporter, TestCase, TestModule } from "vitest/node";

type ReportedEntity = { name: string; starts: number; completions: number };

export default class CrashReporter implements Reporter {
  private root: string;
  private file: string;
  private modules = new Map<string, ReportedEntity>();
  private tests = new Map<string, ReportedEntity>();
  private sequence = 0;

  constructor() {
    const root = process.env.TEST_DIAGNOSTICS_DIR;
    if (!root) throw new Error("CrashReporter requires TEST_DIAGNOSTICS_DIR");
    this.root = root;
    this.file = join(root, `vitest-${process.pid}-${randomUUID()}.jsonl`);
  }

  private async record(event: string, details: object): Promise<void> {
    this.sequence += 1;
    await appendFile(
      this.file,
      `${JSON.stringify({
        schemaVersion: 1,
        sequence: this.sequence,
        event,
        timestamp: new Date().toISOString(),
        ...details,
      })}\n`,
    );
  }

  onTestRunStart: NonNullable<Reporter["onTestRunStart"]> = async (
    specifications,
  ) => {
    await mkdir(this.root, { recursive: true });
    this.modules.clear();
    this.tests.clear();
    await this.record("run-start", {
      pid: process.pid,
      nodeVersion: process.version,
      modules: specifications.map((specification) => specification.moduleId),
    });
  };

  async onTestModuleQueued(module: TestModule): Promise<void> {
    await this.record("module-queued", {
      id: module.id,
      module: module.moduleId,
    });
  }

  async onTestModuleStart(module: TestModule): Promise<void> {
    const entity = this.modules.get(module.id) ?? {
      name: module.moduleId,
      starts: 0,
      completions: 0,
    };
    entity.starts += 1;
    this.modules.set(module.id, entity);
    await this.record("module-start", {
      id: module.id,
      module: module.moduleId,
    });
  }

  async onTestModuleEnd(module: TestModule): Promise<void> {
    const entity = this.modules.get(module.id) ?? {
      name: module.moduleId,
      starts: 0,
      completions: 0,
    };
    entity.completions += 1;
    this.modules.set(module.id, entity);
    await this.record("module-end", { id: module.id, state: module.state() });
  }

  async onTestCaseReady(test: TestCase): Promise<void> {
    const entity = this.tests.get(test.id) ?? {
      name: test.fullName,
      starts: 0,
      completions: 0,
    };
    entity.starts += 1;
    this.tests.set(test.id, entity);
    await this.record("test-start", {
      id: test.id,
      moduleId: test.module.id,
      name: test.fullName,
    });
  }

  async onTestCaseResult(test: TestCase): Promise<void> {
    const entity = this.tests.get(test.id) ?? {
      name: test.fullName,
      starts: 0,
      completions: 0,
    };
    entity.completions += 1;
    this.tests.set(test.id, entity);
    await this.record("test-end", { id: test.id, result: test.result() });
  }

  onTestRunEnd: NonNullable<Reporter["onTestRunEnd"]> = async (
    modules,
    errors,
    reason,
  ) => {
    const unfinishedModules = [...this.modules]
      .filter(([, entity]) => entity.starts > entity.completions)
      .map(([id, entity]) => ({ id, ...entity }));
    const unfinishedTests = [...this.tests]
      .filter(([, entity]) => entity.starts > entity.completions)
      .map(([id, entity]) => ({ id, ...entity }));
    await this.record("run-end", {
      reason,
      errors,
      unfinishedModules,
      unfinishedTests,
      unfinishedStatus: "started without a reported completion",
    });
    if (
      reason !== "passed" ||
      errors.length ||
      modules.some((module) => !module.ok())
    ) {
      console.error(
        `Test diagnostics: ${unfinishedModules.length} modules and ${unfinishedTests.length} tests started without a reported completion; ${errors.length} unhandled errors. Records: ${this.root}`,
      );
    }
  };
}

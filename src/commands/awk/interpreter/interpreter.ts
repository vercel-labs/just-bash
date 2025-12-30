/**
 * AWK Interpreter
 *
 * Main interpreter class that orchestrates AWK program execution.
 */

import type { AwkPattern, AwkProgram, AwkRule } from "../ast.js";
import type { AwkRuntimeContext } from "./context.js";
import { evalExpr } from "./expressions.js";
import { setCurrentLine } from "./fields.js";
import { isTruthy, matchRegex } from "./helpers.js";
import { executeBlock } from "./statements.js";

export class AwkInterpreter {
  private ctx: AwkRuntimeContext;
  private program: AwkProgram | null = null;
  private rangeStates: boolean[] = [];

  constructor(ctx: AwkRuntimeContext) {
    this.ctx = ctx;
  }

  /**
   * Initialize the interpreter with a program.
   * Must be called before executeBegin/executeLine/executeEnd.
   */
  execute(program: AwkProgram): void {
    this.program = program;
    this.ctx.output = "";

    // Register user-defined functions
    for (const func of program.functions) {
      this.ctx.functions.set(func.name, func);
    }

    // Initialize range states
    this.rangeStates = program.rules.map(() => false);
  }

  /**
   * Execute all BEGIN blocks.
   */
  async executeBegin(): Promise<void> {
    if (!this.program) return;

    for (const rule of this.program.rules) {
      if (rule.pattern?.type === "begin") {
        await executeBlock(this.ctx, rule.action.statements);
        if (this.ctx.shouldExit) break;
      }
    }
  }

  /**
   * Execute rules for a single input line.
   */
  async executeLine(line: string): Promise<void> {
    if (!this.program || this.ctx.shouldExit) return;

    // Update context with new line
    setCurrentLine(this.ctx, line);
    this.ctx.NR++;
    this.ctx.FNR++;
    this.ctx.shouldNext = false;

    for (let i = 0; i < this.program.rules.length; i++) {
      if (this.ctx.shouldExit || this.ctx.shouldNext || this.ctx.shouldNextFile)
        break;

      const rule = this.program.rules[i];

      // Skip BEGIN/END rules
      if (rule.pattern?.type === "begin" || rule.pattern?.type === "end") {
        continue;
      }

      if (await this.matchesRule(rule, i)) {
        await executeBlock(this.ctx, rule.action.statements);
      }
    }
  }

  /**
   * Execute all END blocks.
   */
  async executeEnd(): Promise<void> {
    if (!this.program || this.ctx.shouldExit) return;

    for (const rule of this.program.rules) {
      if (rule.pattern?.type === "end") {
        await executeBlock(this.ctx, rule.action.statements);
        if (this.ctx.shouldExit) break;
      }
    }
  }

  /**
   * Get the accumulated output.
   */
  getOutput(): string {
    return this.ctx.output;
  }

  /**
   * Get the exit code.
   */
  getExitCode(): number {
    return this.ctx.exitCode;
  }

  /**
   * Get the runtime context (for access to control flow flags, etc.)
   */
  getContext(): AwkRuntimeContext {
    return this.ctx;
  }

  /**
   * Check if a rule matches the current line.
   */
  private async matchesRule(
    rule: AwkRule,
    ruleIndex: number,
  ): Promise<boolean> {
    const pattern = rule.pattern;

    // No pattern - always matches
    if (!pattern) return true;

    switch (pattern.type) {
      case "begin":
      case "end":
        return false;

      case "regex_pattern":
        return matchRegex(pattern.pattern, this.ctx.line);

      case "expr_pattern":
        return isTruthy(await evalExpr(this.ctx, pattern.expression));

      case "range": {
        const startMatches = await this.matchPattern(pattern.start);
        const endMatches = await this.matchPattern(pattern.end);

        if (!this.rangeStates[ruleIndex]) {
          if (startMatches) {
            this.rangeStates[ruleIndex] = true;
            // Check if end also matches (single line range)
            if (endMatches) {
              this.rangeStates[ruleIndex] = false;
            }
            return true;
          }
          return false;
        } else {
          // In range
          if (endMatches) {
            this.rangeStates[ruleIndex] = false;
          }
          return true;
        }
      }

      default:
        return false;
    }
  }

  /**
   * Check if a pattern matches.
   */
  private async matchPattern(pattern: AwkPattern): Promise<boolean> {
    switch (pattern.type) {
      case "regex_pattern":
        return matchRegex(pattern.pattern, this.ctx.line);
      case "expr_pattern":
        return isTruthy(await evalExpr(this.ctx, pattern.expression));
      default:
        return false;
    }
  }
}

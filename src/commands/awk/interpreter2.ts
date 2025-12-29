/**
 * AWK Interpreter
 *
 * Tree-walking interpreter that executes an AWK AST.
 */

import { ExecutionLimitError } from "../../interpreter/errors.js";
import { applyNumericBinaryOp } from "../../shared/operators.js";
import type {
  AwkArrayAccess,
  AwkBlock,
  AwkExpr,
  AwkFieldRef,
  AwkFunctionDef,
  AwkPattern,
  AwkProgram,
  AwkRule,
  AwkStmt,
  AwkVariable,
} from "./ast.js";
import { awkBuiltins, formatPrintf } from "./builtins.js";

const DEFAULT_MAX_ITERATIONS = 10000;

export type AwkValue = string | number;

export interface AwkRuntimeContext {
  // Built-in variables
  FS: string;
  OFS: string;
  ORS: string;
  NR: number;
  NF: number;
  FNR: number;
  FILENAME: string;
  RSTART: number;
  RLENGTH: number;
  SUBSEP: string;

  // Current line data
  fields: string[];
  line: string;

  // User variables and arrays
  vars: Record<string, AwkValue>;
  arrays: Record<string, Record<string, AwkValue>>;

  // User-defined functions (from AST)
  functions: Map<string, AwkFunctionDef>;

  // For getline support
  lines?: string[];
  lineIndex?: number;
  fieldSep: RegExp;

  // Execution limits
  maxIterations: number;

  // Control flow
  exitCode: number;
  shouldExit: boolean;
  shouldNext: boolean;
  loopBreak: boolean;
  loopContinue: boolean;
  returnValue?: AwkValue;
  hasReturn: boolean;

  // Output buffer
  output: string;

  // Random function override for testing
  random?: () => number;
}

export function createRuntimeContext(
  fieldSep: RegExp = /\s+/,
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
): AwkRuntimeContext {
  return {
    FS: " ",
    OFS: " ",
    ORS: "\n",
    NR: 0,
    NF: 0,
    FNR: 0,
    FILENAME: "",
    RSTART: 0,
    RLENGTH: -1,
    SUBSEP: "\x1c",

    fields: [],
    line: "",

    vars: {},
    arrays: {},
    functions: new Map(),

    fieldSep,
    maxIterations,

    exitCode: 0,
    shouldExit: false,
    shouldNext: false,
    loopBreak: false,
    loopContinue: false,
    hasReturn: false,

    output: "",
  };
}

export class AwkInterpreter {
  private ctx: AwkRuntimeContext;
  private program: AwkProgram | null = null;
  private rangeStates: boolean[] = [];

  constructor(ctx: AwkRuntimeContext) {
    this.ctx = ctx;
  }

  execute(program: AwkProgram): string {
    this.program = program;
    this.ctx.output = "";

    // Register user-defined functions
    for (const func of program.functions) {
      this.ctx.functions.set(func.name, func);
    }

    // Initialize range states
    this.rangeStates = program.rules.map(() => false);

    return this.ctx.output;
  }

  executeBegin(): void {
    if (!this.program) return;

    for (const rule of this.program.rules) {
      if (rule.pattern?.type === "begin") {
        this.executeBlock(rule.action);
        if (this.ctx.shouldExit) break;
      }
    }
  }

  executeLine(line: string): void {
    if (!this.program || this.ctx.shouldExit) return;

    // Update context with new line
    this.ctx.line = line;
    this.ctx.NR++;
    this.ctx.FNR++;
    this.ctx.fields = this.splitFields(line);
    this.ctx.NF = this.ctx.fields.length;
    this.ctx.shouldNext = false;

    for (let i = 0; i < this.program.rules.length; i++) {
      if (this.ctx.shouldExit || this.ctx.shouldNext) break;

      const rule = this.program.rules[i];

      // Skip BEGIN/END rules
      if (rule.pattern?.type === "begin" || rule.pattern?.type === "end") {
        continue;
      }

      if (this.matchesRule(rule, i)) {
        this.executeBlock(rule.action);
      }
    }
  }

  executeEnd(): void {
    if (!this.program || this.ctx.shouldExit) return;

    for (const rule of this.program.rules) {
      if (rule.pattern?.type === "end") {
        this.executeBlock(rule.action);
        if (this.ctx.shouldExit) break;
      }
    }
  }

  getOutput(): string {
    return this.ctx.output;
  }

  getExitCode(): number {
    return this.ctx.exitCode;
  }

  private splitFields(line: string): string[] {
    if (this.ctx.FS === " ") {
      // Default FS: split on runs of whitespace, skip leading/trailing
      return line.trim().split(/\s+/).filter(Boolean);
    }
    return line.split(this.ctx.fieldSep);
  }

  private matchesRule(rule: AwkRule, ruleIndex: number): boolean {
    const pattern = rule.pattern;

    // No pattern - always matches
    if (!pattern) return true;

    switch (pattern.type) {
      case "begin":
      case "end":
        return false;

      case "regex_pattern":
        return this.matchRegex(pattern.pattern, this.ctx.line);

      case "expr_pattern":
        return this.isTruthy(this.evalExpr(pattern.expression));

      case "range": {
        const startMatches = this.matchPattern(pattern.start);
        const endMatches = this.matchPattern(pattern.end);

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

  private matchPattern(pattern: AwkPattern): boolean {
    switch (pattern.type) {
      case "regex_pattern":
        return this.matchRegex(pattern.pattern, this.ctx.line);
      case "expr_pattern":
        return this.isTruthy(this.evalExpr(pattern.expression));
      default:
        return false;
    }
  }

  private matchRegex(pattern: string, text: string): boolean {
    try {
      return new RegExp(pattern).test(text);
    } catch {
      return false;
    }
  }

  private executeBlock(block: AwkBlock): void {
    for (const stmt of block.statements) {
      this.executeStmt(stmt);
      if (
        this.ctx.shouldExit ||
        this.ctx.shouldNext ||
        this.ctx.loopBreak ||
        this.ctx.loopContinue ||
        this.ctx.hasReturn
      ) {
        break;
      }
    }
  }

  private executeStmt(stmt: AwkStmt): void {
    switch (stmt.type) {
      case "block":
        this.executeBlock(stmt);
        break;

      case "expr_stmt":
        this.evalExpr(stmt.expression);
        break;

      case "print":
        this.executePrint(stmt.args, stmt.output);
        break;

      case "printf":
        this.executePrintf(stmt.format, stmt.args, stmt.output);
        break;

      case "if":
        this.executeIf(stmt);
        break;

      case "while":
        this.executeWhile(stmt);
        break;

      case "do_while":
        this.executeDoWhile(stmt);
        break;

      case "for":
        this.executeFor(stmt);
        break;

      case "for_in":
        this.executeForIn(stmt);
        break;

      case "break":
        this.ctx.loopBreak = true;
        break;

      case "continue":
        this.ctx.loopContinue = true;
        break;

      case "next":
        this.ctx.shouldNext = true;
        break;

      case "exit":
        this.ctx.shouldExit = true;
        this.ctx.exitCode = stmt.code
          ? Math.floor(this.toNumber(this.evalExpr(stmt.code)))
          : 0;
        break;

      case "return":
        this.ctx.hasReturn = true;
        this.ctx.returnValue = stmt.value ? this.evalExpr(stmt.value) : "";
        break;

      case "delete":
        this.executeDelete(stmt.target);
        break;
    }
  }

  private executePrint(
    args: AwkExpr[],
    output?: { redirect: ">" | ">>"; file: AwkExpr },
  ): void {
    const values = args.map((arg) => this.toString(this.evalExpr(arg)));
    const text = values.join(this.ctx.OFS) + this.ctx.ORS;

    if (output) {
      // File redirection not implemented in sandboxed environment
      // Just append to output
      this.ctx.output += text;
    } else {
      this.ctx.output += text;
    }
  }

  private executePrintf(
    format: AwkExpr,
    args: AwkExpr[],
    output?: { redirect: ">" | ">>"; file: AwkExpr },
  ): void {
    const formatStr = this.toString(this.evalExpr(format));
    const values = args.map((arg) => this.evalExpr(arg));
    const text = formatPrintf(formatStr, values);

    if (output) {
      this.ctx.output += text;
    } else {
      this.ctx.output += text;
    }
  }

  private executeIf(stmt: {
    condition: AwkExpr;
    consequent: AwkStmt;
    alternate?: AwkStmt;
  }): void {
    if (this.isTruthy(this.evalExpr(stmt.condition))) {
      this.executeStmt(stmt.consequent);
    } else if (stmt.alternate) {
      this.executeStmt(stmt.alternate);
    }
  }

  private executeWhile(stmt: { condition: AwkExpr; body: AwkStmt }): void {
    let iterations = 0;

    while (this.isTruthy(this.evalExpr(stmt.condition))) {
      iterations++;
      if (iterations > this.ctx.maxIterations) {
        throw new ExecutionLimitError(
          `awk: while loop exceeded maximum iterations (${this.ctx.maxIterations})`,
          "iterations",
          this.ctx.output,
        );
      }

      this.ctx.loopContinue = false;
      this.executeStmt(stmt.body);

      if (this.ctx.loopBreak) {
        this.ctx.loopBreak = false;
        break;
      }
      if (this.ctx.shouldExit || this.ctx.shouldNext || this.ctx.hasReturn) {
        break;
      }
    }
  }

  private executeDoWhile(stmt: { body: AwkStmt; condition: AwkExpr }): void {
    let iterations = 0;

    do {
      iterations++;
      if (iterations > this.ctx.maxIterations) {
        throw new ExecutionLimitError(
          `awk: do-while loop exceeded maximum iterations (${this.ctx.maxIterations})`,
          "iterations",
          this.ctx.output,
        );
      }

      this.ctx.loopContinue = false;
      this.executeStmt(stmt.body);

      if (this.ctx.loopBreak) {
        this.ctx.loopBreak = false;
        break;
      }
      if (this.ctx.shouldExit || this.ctx.shouldNext || this.ctx.hasReturn) {
        break;
      }
    } while (this.isTruthy(this.evalExpr(stmt.condition)));
  }

  private executeFor(stmt: {
    init?: AwkExpr;
    condition?: AwkExpr;
    update?: AwkExpr;
    body: AwkStmt;
  }): void {
    if (stmt.init) {
      this.evalExpr(stmt.init);
    }

    let iterations = 0;

    while (!stmt.condition || this.isTruthy(this.evalExpr(stmt.condition))) {
      iterations++;
      if (iterations > this.ctx.maxIterations) {
        throw new ExecutionLimitError(
          `awk: for loop exceeded maximum iterations (${this.ctx.maxIterations})`,
          "iterations",
          this.ctx.output,
        );
      }

      this.ctx.loopContinue = false;
      this.executeStmt(stmt.body);

      if (this.ctx.loopBreak) {
        this.ctx.loopBreak = false;
        break;
      }
      if (this.ctx.shouldExit || this.ctx.shouldNext || this.ctx.hasReturn) {
        break;
      }

      if (stmt.update) {
        this.evalExpr(stmt.update);
      }
    }
  }

  private executeForIn(stmt: {
    variable: string;
    array: string;
    body: AwkStmt;
  }): void {
    const array = this.ctx.arrays[stmt.array];
    if (!array) return;

    for (const key of Object.keys(array)) {
      this.ctx.vars[stmt.variable] = key;

      this.ctx.loopContinue = false;
      this.executeStmt(stmt.body);

      if (this.ctx.loopBreak) {
        this.ctx.loopBreak = false;
        break;
      }
      if (this.ctx.shouldExit || this.ctx.shouldNext || this.ctx.hasReturn) {
        break;
      }
    }
  }

  private executeDelete(target: AwkArrayAccess | AwkVariable): void {
    if (target.type === "array_access") {
      const array = this.ctx.arrays[target.array];
      if (array) {
        const key = this.toString(this.evalExpr(target.key));
        delete array[key];
      }
    } else if (target.type === "variable") {
      // Delete entire array
      delete this.ctx.arrays[target.name];
    }
  }

  // ─── Expression Evaluation ──────────────────────────────────

  evalExpr(expr: AwkExpr): AwkValue {
    switch (expr.type) {
      case "number":
        return expr.value;

      case "string":
        return expr.value;

      case "regex":
        // Regex used as expression matches against $0
        return this.matchRegex(expr.pattern, this.ctx.line) ? 1 : 0;

      case "field":
        return this.getField(expr);

      case "variable":
        return this.getVariable(expr.name);

      case "array_access":
        return this.getArrayElement(expr.array, expr.key);

      case "binary":
        return this.evalBinaryOp(expr);

      case "unary":
        return this.evalUnaryOp(expr);

      case "ternary":
        return this.isTruthy(this.evalExpr(expr.condition))
          ? this.evalExpr(expr.consequent)
          : this.evalExpr(expr.alternate);

      case "call":
        return this.evalFunctionCall(expr.name, expr.args);

      case "assignment":
        return this.evalAssignment(expr);

      case "pre_increment":
        return this.evalPreIncrement(expr.operand);

      case "pre_decrement":
        return this.evalPreDecrement(expr.operand);

      case "post_increment":
        return this.evalPostIncrement(expr.operand);

      case "post_decrement":
        return this.evalPostDecrement(expr.operand);

      case "in":
        return this.evalInExpr(expr.key, expr.array);

      case "getline":
        return this.evalGetline(expr.variable, expr.file);

      default:
        return "";
    }
  }

  private getField(expr: AwkFieldRef): AwkValue {
    const index = Math.floor(this.toNumber(this.evalExpr(expr.index)));
    if (index === 0) {
      return this.ctx.line;
    }
    if (index < 0 || index > this.ctx.fields.length) {
      return "";
    }
    return this.ctx.fields[index - 1] ?? "";
  }

  private setField(index: number, value: AwkValue): void {
    if (index === 0) {
      // Setting $0 re-splits the line
      this.ctx.line = this.toString(value);
      this.ctx.fields = this.splitFields(this.ctx.line);
      this.ctx.NF = this.ctx.fields.length;
    } else if (index > 0) {
      // Extend fields array if needed
      while (this.ctx.fields.length < index) {
        this.ctx.fields.push("");
      }
      this.ctx.fields[index - 1] = this.toString(value);
      this.ctx.NF = this.ctx.fields.length;
      // Rebuild $0 from fields
      this.ctx.line = this.ctx.fields.join(this.ctx.OFS);
    }
  }

  private getVariable(name: string): AwkValue {
    // Check built-in variables first
    switch (name) {
      case "FS":
        return this.ctx.FS;
      case "OFS":
        return this.ctx.OFS;
      case "ORS":
        return this.ctx.ORS;
      case "NR":
        return this.ctx.NR;
      case "NF":
        return this.ctx.NF;
      case "FNR":
        return this.ctx.FNR;
      case "FILENAME":
        return this.ctx.FILENAME;
      case "RSTART":
        return this.ctx.RSTART;
      case "RLENGTH":
        return this.ctx.RLENGTH;
      case "SUBSEP":
        return this.ctx.SUBSEP;
    }

    return this.ctx.vars[name] ?? "";
  }

  private setVariable(name: string, value: AwkValue): void {
    // Handle built-in variables
    switch (name) {
      case "FS":
        this.ctx.FS = this.toString(value);
        if (this.ctx.FS === " ") {
          this.ctx.fieldSep = /\s+/;
        } else {
          try {
            this.ctx.fieldSep = new RegExp(this.ctx.FS);
          } catch {
            this.ctx.fieldSep = new RegExp(
              this.ctx.FS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            );
          }
        }
        return;
      case "OFS":
        this.ctx.OFS = this.toString(value);
        return;
      case "ORS":
        this.ctx.ORS = this.toString(value);
        return;
      case "NR":
        this.ctx.NR = Math.floor(this.toNumber(value));
        return;
      case "NF":
        this.ctx.NF = Math.floor(this.toNumber(value));
        return;
      case "FNR":
        this.ctx.FNR = Math.floor(this.toNumber(value));
        return;
      case "FILENAME":
        this.ctx.FILENAME = this.toString(value);
        return;
      case "RSTART":
        this.ctx.RSTART = Math.floor(this.toNumber(value));
        return;
      case "RLENGTH":
        this.ctx.RLENGTH = Math.floor(this.toNumber(value));
        return;
      case "SUBSEP":
        this.ctx.SUBSEP = this.toString(value);
        return;
    }

    this.ctx.vars[name] = value;
  }

  private getArrayElement(array: string, key: AwkExpr): AwkValue {
    const keyStr = this.toString(this.evalExpr(key));
    return this.ctx.arrays[array]?.[keyStr] ?? "";
  }

  private setArrayElement(array: string, key: string, value: AwkValue): void {
    if (!this.ctx.arrays[array]) {
      this.ctx.arrays[array] = {};
    }
    this.ctx.arrays[array][key] = value;
  }

  private evalBinaryOp(expr: {
    operator: string;
    left: AwkExpr;
    right: AwkExpr;
  }): AwkValue {
    const op = expr.operator;

    // Short-circuit evaluation for logical operators
    if (op === "||") {
      return this.isTruthy(this.evalExpr(expr.left)) ||
        this.isTruthy(this.evalExpr(expr.right))
        ? 1
        : 0;
    }
    if (op === "&&") {
      return this.isTruthy(this.evalExpr(expr.left)) &&
        this.isTruthy(this.evalExpr(expr.right))
        ? 1
        : 0;
    }

    const left = this.evalExpr(expr.left);
    const right = this.evalExpr(expr.right);

    // String concatenation
    if (op === " ") {
      return this.toString(left) + this.toString(right);
    }

    // Regex match operators
    if (op === "~") {
      const rightStr = this.toString(right);
      try {
        return new RegExp(rightStr).test(this.toString(left)) ? 1 : 0;
      } catch {
        return 0;
      }
    }
    if (op === "!~") {
      const rightStr = this.toString(right);
      try {
        return new RegExp(rightStr).test(this.toString(left)) ? 0 : 1;
      } catch {
        return 1;
      }
    }

    // Comparison operators - use string comparison if both are strings
    if (this.isComparisonOp(op)) {
      return this.evalComparison(left, right, op);
    }

    // Arithmetic operators
    const leftNum = this.toNumber(left);
    const rightNum = this.toNumber(right);
    return applyNumericBinaryOp(leftNum, rightNum, op);
  }

  private isComparisonOp(op: string): boolean {
    return ["<", "<=", ">", ">=", "==", "!="].includes(op);
  }

  private evalComparison(left: AwkValue, right: AwkValue, op: string): number {
    // If both look like numbers, compare numerically
    const leftIsNum = this.looksLikeNumber(left);
    const rightIsNum = this.looksLikeNumber(right);

    if (leftIsNum && rightIsNum) {
      const l = this.toNumber(left);
      const r = this.toNumber(right);
      switch (op) {
        case "<":
          return l < r ? 1 : 0;
        case "<=":
          return l <= r ? 1 : 0;
        case ">":
          return l > r ? 1 : 0;
        case ">=":
          return l >= r ? 1 : 0;
        case "==":
          return l === r ? 1 : 0;
        case "!=":
          return l !== r ? 1 : 0;
      }
    }

    // Otherwise compare as strings
    const l = this.toString(left);
    const r = this.toString(right);
    switch (op) {
      case "<":
        return l < r ? 1 : 0;
      case "<=":
        return l <= r ? 1 : 0;
      case ">":
        return l > r ? 1 : 0;
      case ">=":
        return l >= r ? 1 : 0;
      case "==":
        return l === r ? 1 : 0;
      case "!=":
        return l !== r ? 1 : 0;
    }
    return 0;
  }

  private looksLikeNumber(val: AwkValue): boolean {
    if (typeof val === "number") return true;
    const s = String(val).trim();
    if (s === "") return false;
    return !Number.isNaN(Number(s));
  }

  private evalUnaryOp(expr: { operator: string; operand: AwkExpr }): AwkValue {
    const val = this.evalExpr(expr.operand);
    switch (expr.operator) {
      case "!":
        return this.isTruthy(val) ? 0 : 1;
      case "-":
        return -this.toNumber(val);
      case "+":
        return +this.toNumber(val);
      default:
        return val;
    }
  }

  private evalFunctionCall(name: string, args: AwkExpr[]): AwkValue {
    // Check for built-in functions first
    const builtin = awkBuiltins[name];
    if (builtin) {
      return builtin(args, this.ctx, this);
    }

    // Check for user-defined function
    const userFunc = this.ctx.functions.get(name);
    if (userFunc) {
      return this.callUserFunction(userFunc, args);
    }

    // Unknown function
    return "";
  }

  private callUserFunction(func: AwkFunctionDef, args: AwkExpr[]): AwkValue {
    // Save current variables
    const savedVars = { ...this.ctx.vars };

    // Set up local variables (parameters)
    for (let i = 0; i < func.params.length; i++) {
      const param = func.params[i];
      const value = i < args.length ? this.evalExpr(args[i]) : "";
      this.ctx.vars[param] = value;
    }

    // Execute function body
    this.ctx.hasReturn = false;
    this.ctx.returnValue = undefined;

    this.executeBlock(func.body);

    const result = this.ctx.returnValue ?? "";

    // Restore variables
    this.ctx.vars = savedVars;
    this.ctx.hasReturn = false;
    this.ctx.returnValue = undefined;

    return result;
  }

  private evalAssignment(expr: {
    operator: string;
    target: AwkFieldRef | AwkVariable | AwkArrayAccess;
    value: AwkExpr;
  }): AwkValue {
    const value = this.evalExpr(expr.value);
    const target = expr.target;
    const op = expr.operator;

    let finalValue: AwkValue;

    if (op === "=") {
      finalValue = value;
    } else {
      // Compound assignment - get current value
      let current: AwkValue;
      if (target.type === "field") {
        current = this.getField(target);
      } else if (target.type === "variable") {
        current = this.getVariable(target.name);
      } else {
        current = this.getArrayElement(target.array, target.key);
      }

      const currentNum = this.toNumber(current);
      const valueNum = this.toNumber(value);

      switch (op) {
        case "+=":
          finalValue = currentNum + valueNum;
          break;
        case "-=":
          finalValue = currentNum - valueNum;
          break;
        case "*=":
          finalValue = currentNum * valueNum;
          break;
        case "/=":
          finalValue = valueNum !== 0 ? currentNum / valueNum : 0;
          break;
        case "%=":
          finalValue = valueNum !== 0 ? currentNum % valueNum : 0;
          break;
        case "^=":
          finalValue = currentNum ** valueNum;
          break;
        default:
          finalValue = value;
      }
    }

    // Assign to target
    if (target.type === "field") {
      const index = Math.floor(this.toNumber(this.evalExpr(target.index)));
      this.setField(index, finalValue);
    } else if (target.type === "variable") {
      this.setVariable(target.name, finalValue);
    } else {
      const key = this.toString(this.evalExpr(target.key));
      this.setArrayElement(target.array, key, finalValue);
    }

    return finalValue;
  }

  private evalPreIncrement(
    operand: AwkVariable | AwkArrayAccess | AwkFieldRef,
  ): AwkValue {
    let val: number;

    if (operand.type === "field") {
      val = this.toNumber(this.getField(operand)) + 1;
      const index = Math.floor(this.toNumber(this.evalExpr(operand.index)));
      this.setField(index, val);
    } else if (operand.type === "variable") {
      val = this.toNumber(this.getVariable(operand.name)) + 1;
      this.setVariable(operand.name, val);
    } else {
      const key = this.toString(this.evalExpr(operand.key));
      val = this.toNumber(this.ctx.arrays[operand.array]?.[key] ?? 0) + 1;
      this.setArrayElement(operand.array, key, val);
    }

    return val;
  }

  private evalPreDecrement(
    operand: AwkVariable | AwkArrayAccess | AwkFieldRef,
  ): AwkValue {
    let val: number;

    if (operand.type === "field") {
      val = this.toNumber(this.getField(operand)) - 1;
      const index = Math.floor(this.toNumber(this.evalExpr(operand.index)));
      this.setField(index, val);
    } else if (operand.type === "variable") {
      val = this.toNumber(this.getVariable(operand.name)) - 1;
      this.setVariable(operand.name, val);
    } else {
      const key = this.toString(this.evalExpr(operand.key));
      val = this.toNumber(this.ctx.arrays[operand.array]?.[key] ?? 0) - 1;
      this.setArrayElement(operand.array, key, val);
    }

    return val;
  }

  private evalPostIncrement(
    operand: AwkVariable | AwkArrayAccess | AwkFieldRef,
  ): AwkValue {
    let oldVal: number;

    if (operand.type === "field") {
      oldVal = this.toNumber(this.getField(operand));
      const index = Math.floor(this.toNumber(this.evalExpr(operand.index)));
      this.setField(index, oldVal + 1);
    } else if (operand.type === "variable") {
      oldVal = this.toNumber(this.getVariable(operand.name));
      this.setVariable(operand.name, oldVal + 1);
    } else {
      const key = this.toString(this.evalExpr(operand.key));
      oldVal = this.toNumber(this.ctx.arrays[operand.array]?.[key] ?? 0);
      this.setArrayElement(operand.array, key, oldVal + 1);
    }

    return oldVal;
  }

  private evalPostDecrement(
    operand: AwkVariable | AwkArrayAccess | AwkFieldRef,
  ): AwkValue {
    let oldVal: number;

    if (operand.type === "field") {
      oldVal = this.toNumber(this.getField(operand));
      const index = Math.floor(this.toNumber(this.evalExpr(operand.index)));
      this.setField(index, oldVal - 1);
    } else if (operand.type === "variable") {
      oldVal = this.toNumber(this.getVariable(operand.name));
      this.setVariable(operand.name, oldVal - 1);
    } else {
      const key = this.toString(this.evalExpr(operand.key));
      oldVal = this.toNumber(this.ctx.arrays[operand.array]?.[key] ?? 0);
      this.setArrayElement(operand.array, key, oldVal - 1);
    }

    return oldVal;
  }

  private evalInExpr(key: AwkExpr, array: string): AwkValue {
    const keyStr = this.toString(this.evalExpr(key));
    return this.ctx.arrays[array]?.[keyStr] !== undefined ? 1 : 0;
  }

  private evalGetline(variable?: string, _file?: AwkExpr): AwkValue {
    // Check if lines are available
    if (!this.ctx.lines || this.ctx.lineIndex === undefined) {
      return -1;
    }

    const nextLineIndex = this.ctx.lineIndex + 1;
    if (nextLineIndex >= this.ctx.lines.length) {
      return 0; // No more lines
    }

    const nextLine = this.ctx.lines[nextLineIndex];

    if (variable) {
      this.setVariable(variable, nextLine);
    } else {
      // Read into $0
      this.ctx.line = nextLine;
      this.ctx.fields = this.splitFields(nextLine);
      this.ctx.NF = this.ctx.fields.length;
    }

    this.ctx.NR++;
    this.ctx.lineIndex = nextLineIndex;

    return 1; // Success
  }

  // ─── Type Conversion Helpers ────────────────────────────────

  isTruthy(val: AwkValue): boolean {
    if (typeof val === "number") {
      return val !== 0;
    }
    // String is truthy if non-empty
    return val !== "";
  }

  toNumber(val: AwkValue): number {
    if (typeof val === "number") return val;
    const n = parseFloat(val);
    return Number.isNaN(n) ? 0 : n;
  }

  toString(val: AwkValue): string {
    if (typeof val === "string") return val;
    // Format numbers nicely (no trailing zeros after decimal)
    if (Number.isInteger(val)) return String(val);
    return String(val);
  }
}

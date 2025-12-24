/**
 * Visitor Pattern for AST Tree-Walking
 *
 * This module defines the visitor interface and base implementation
 * for traversing and interpreting the bash AST.
 */

import type {
  ArithmeticCommandNode,
  CaseNode,
  CommandNode,
  CompoundCommandNode,
  ConditionalCommandNode,
  CStyleForNode,
  ForNode,
  FunctionDefNode,
  GroupNode,
  IfNode,
  PipelineNode,
  ScriptNode,
  SimpleCommandNode,
  StatementNode,
  SubshellNode,
  UntilNode,
  WhileNode,
} from "../ast/types.js";

/**
 * Result of executing a command/script
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Visitor interface for AST nodes
 *
 * Each visit method corresponds to an AST node type.
 * The visitor is responsible for:
 * 1. Expanding words (variable substitution, etc.)
 * 2. Executing commands
 * 3. Managing control flow
 */
export interface ASTVisitor<T> {
  visitScript(node: ScriptNode): Promise<T>;
  visitStatement(node: StatementNode): Promise<T>;
  visitPipeline(node: PipelineNode): Promise<T>;
  visitSimpleCommand(node: SimpleCommandNode): Promise<T>;
  visitIf(node: IfNode): Promise<T>;
  visitFor(node: ForNode): Promise<T>;
  visitCStyleFor(node: CStyleForNode): Promise<T>;
  visitWhile(node: WhileNode): Promise<T>;
  visitUntil(node: UntilNode): Promise<T>;
  visitCase(node: CaseNode): Promise<T>;
  visitSubshell(node: SubshellNode): Promise<T>;
  visitGroup(node: GroupNode): Promise<T>;
  visitFunctionDef(node: FunctionDefNode): Promise<T>;
  visitArithmeticCommand(node: ArithmeticCommandNode): Promise<T>;
  visitConditionalCommand(node: ConditionalCommandNode): Promise<T>;
}

/**
 * Dispatch a command node to the appropriate visitor method
 */
export function visitCommand<T>(
  visitor: ASTVisitor<T>,
  node: CommandNode,
): Promise<T> {
  switch (node.type) {
    case "SimpleCommand":
      return visitor.visitSimpleCommand(node);
    case "If":
      return visitor.visitIf(node);
    case "For":
      return visitor.visitFor(node);
    case "CStyleFor":
      return visitor.visitCStyleFor(node);
    case "While":
      return visitor.visitWhile(node);
    case "Until":
      return visitor.visitUntil(node);
    case "Case":
      return visitor.visitCase(node);
    case "Subshell":
      return visitor.visitSubshell(node);
    case "Group":
      return visitor.visitGroup(node);
    case "FunctionDef":
      return visitor.visitFunctionDef(node);
    case "ArithmeticCommand":
      return visitor.visitArithmeticCommand(node);
    case "ConditionalCommand":
      return visitor.visitConditionalCommand(node);
    default:
      throw new Error(`Unknown command type: ${(node as CommandNode).type}`);
  }
}

/**
 * Dispatch a compound command node to the appropriate visitor method
 */
export function visitCompoundCommand<T>(
  visitor: ASTVisitor<T>,
  node: CompoundCommandNode,
): Promise<T> {
  switch (node.type) {
    case "If":
      return visitor.visitIf(node);
    case "For":
      return visitor.visitFor(node);
    case "CStyleFor":
      return visitor.visitCStyleFor(node);
    case "While":
      return visitor.visitWhile(node);
    case "Until":
      return visitor.visitUntil(node);
    case "Case":
      return visitor.visitCase(node);
    case "Subshell":
      return visitor.visitSubshell(node);
    case "Group":
      return visitor.visitGroup(node);
    case "ArithmeticCommand":
      return visitor.visitArithmeticCommand(node);
    case "ConditionalCommand":
      return visitor.visitConditionalCommand(node);
    default:
      throw new Error(
        `Unknown compound command type: ${(node as CompoundCommandNode).type}`,
      );
  }
}

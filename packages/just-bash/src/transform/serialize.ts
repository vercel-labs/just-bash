import type {
  ArithExpr,
  ArithmeticCommandNode,
  AssignmentNode,
  BraceExpansionPart,
  BraceItem,
  CaseItemNode,
  CaseNode,
  CommandNode,
  ConditionalCommandNode,
  ConditionalExpressionNode,
  CStyleForNode,
  ForNode,
  FunctionDefNode,
  GroupNode,
  HereDocNode,
  IfNode,
  ParameterExpansionPart,
  ParameterOperation,
  PipelineNode,
  RedirectionNode,
  ScriptNode,
  SimpleCommandNode,
  StatementNode,
  SubshellNode,
  UntilNode,
  WhileNode,
  WordNode,
  WordPart,
} from "../ast/types.js";

export function serialize(node: ScriptNode): string {
  return serializeScript(node);
}

export { serializeWord };

function serializeScript(node: ScriptNode): string {
  return node.statements.map(serializeStatement).join("\n");
}

function serializeStatement(node: StatementNode): string {
  const parts: string[] = [];
  for (let i = 0; i < node.pipelines.length; i++) {
    parts.push(serializePipeline(node.pipelines[i]));
    if (i < node.operators.length) {
      parts.push(node.operators[i]);
    }
  }
  let result = parts.join(" ");
  if (node.background) {
    result += " &";
  }
  return result;
}

function serializePipeline(node: PipelineNode): string {
  const prefix: string[] = [];
  if (node.timed) {
    prefix.push(node.timePosix ? "time -p" : "time");
  }
  if (node.negated) {
    prefix.push("!");
  }

  const cmdParts: string[] = [];
  for (let i = 0; i < node.commands.length; i++) {
    cmdParts.push(serializeCommand(node.commands[i]));
    if (i < node.commands.length - 1) {
      const pipeStderr = node.pipeStderr?.[i];
      cmdParts.push(pipeStderr ? "|&" : "|");
    }
  }

  const prefixStr = prefix.length > 0 ? `${prefix.join(" ")} ` : "";
  return prefixStr + cmdParts.join(" ");
}

function serializeCommand(node: CommandNode): string {
  switch (node.type) {
    case "SimpleCommand":
      return serializeSimpleCommand(node);
    case "If":
      return serializeIf(node);
    case "For":
      return serializeFor(node);
    case "CStyleFor":
      return serializeCStyleFor(node);
    case "While":
      return serializeWhile(node);
    case "Until":
      return serializeUntil(node);
    case "Case":
      return serializeCase(node);
    case "Subshell":
      return serializeSubshell(node);
    case "Group":
      return serializeGroup(node);
    case "ArithmeticCommand":
      return serializeArithmeticCommand(node);
    case "ConditionalCommand":
      return serializeConditionalCommand(node);
    case "FunctionDef":
      return serializeFunctionDef(node);
    default: {
      const _exhaustive: never = node;
      throw new Error(
        `Unsupported command type: ${(_exhaustive as CommandNode).type}`,
      );
    }
  }
}

function serializeSimpleCommand(node: SimpleCommandNode): string {
  const parts: string[] = [];

  for (const assign of node.assignments) {
    parts.push(serializeAssignment(assign));
  }

  if (node.name) {
    parts.push(serializeWord(node.name));
  }

  for (const arg of node.args) {
    parts.push(serializeWord(arg));
  }

  for (const redir of node.redirections) {
    parts.push(serializeRedirection(redir));
  }

  return parts.join(" ");
}

function serializeAssignment(node: AssignmentNode): string {
  const op = node.append ? "+=" : "=";
  if (node.array) {
    const items = node.array.map(serializeWord).join(" ");
    return `${node.name}${op}(${items})`;
  }
  if (node.value) {
    return `${node.name}${op}${serializeWord(node.value)}`;
  }
  return `${node.name}${op}`;
}

function serializeWord(node: WordNode): string {
  return node.parts.map((p) => serializeWordPart(p, false)).join("");
}

/**
 * Serialize a word in a "raw" context where shell metacharacters don't
 * need escaping (e.g., inside ${...} parameter expansions).
 */
function serializeWordRaw(node: WordNode): string {
  return node.parts.map((p) => serializeWordPart(p, true)).join("");
}

function serializeWordPart(part: WordPart, inDoubleQuotes: boolean): string {
  switch (part.type) {
    case "Literal":
      return inDoubleQuotes
        ? escapeDoubleQuoted(part.value)
        : escapeLiteral(part.value);
    case "SingleQuoted":
      return `'${part.value}'`;
    case "DoubleQuoted":
      return `"${part.parts.map((p) => serializeWordPart(p, true)).join("")}"`;
    case "Escaped":
      return `\\${part.value}`;
    case "ParameterExpansion":
      return serializeParameterExpansion(part);
    case "CommandSubstitution":
      if (part.legacy) {
        return `\`${serializeScript(part.body)}\``;
      }
      return `$(${serializeScript(part.body)})`;
    case "ArithmeticExpansion":
      return `$((${serializeArithExpr(part.expression.expression)}))`;
    case "ProcessSubstitution":
      return part.direction === "input"
        ? `<(${serializeScript(part.body)})`
        : `>(${serializeScript(part.body)})`;
    case "BraceExpansion":
      return serializeBraceExpansion(part);
    case "TildeExpansion":
      return part.user !== null ? `~${part.user}` : "~";
    case "Glob":
      return part.pattern;
    default: {
      const _exhaustive: never = part;
      throw new Error(
        `Unsupported word part type: ${(_exhaustive as WordPart).type}`,
      );
    }
  }
}

/**
 * Escape shell metacharacters in literal values that appear outside of quotes.
 * These characters would otherwise cause word splitting, globbing, or be
 * interpreted as operators.
 *
 * Note: `$` is intentionally NOT escaped. The parser only creates Literal
 * parts with `$` when it's in a non-expansion position (e.g., trailing `$`,
 * `$` before a non-variable char). Escaping it would change the AST type
 * from Literal to Escaped without functional benefit.
 */
function escapeLiteral(value: string): string {
  return value.replace(/[\s\\'"`!|&;()<>{}[\]*?~#]/g, "\\$&");
}

/**
 * Escape characters that have special meaning inside double quotes.
 * In bash double quotes, $, `, ", and \ are special and must be
 * backslash-escaped to appear literally.
 *
 * The parser's parseDoubleQuotedContent folds escaped sequences like
 * \$, \`, \", \\ into plain Literal parts (stripping the backslash).
 * The serializer must re-add the backslash for these characters.
 */
function escapeDoubleQuoted(value: string): string {
  return value.replace(/[$`"\\]/g, "\\$&");
}

/**
 * Serialize heredoc content without escaping, since heredoc bodies
 * are delimited by the heredoc delimiter, not by shell metacharacters.
 * Uses a dedicated serializer that emits literals as-is (no double-quote
 * escaping) while still handling expansions and other word parts.
 */
function serializeHeredocContent(node: WordNode, quoted: boolean): string {
  return node.parts.map((p) => serializeHeredocPart(p, quoted)).join("");
}

function serializeHeredocPart(part: WordPart, quoted: boolean): string {
  switch (part.type) {
    case "Literal":
      // In quoted heredocs (<<'EOF'), nothing is expanded — emit as-is.
      // In unquoted heredocs, $ and ` trigger expansion (like double quotes),
      // so escaped chars folded into literals by the parser need re-escaping.
      // Unlike double quotes, " and \ are NOT special in heredoc bodies.
      return quoted ? part.value : part.value.replace(/[$`]/g, "\\$&");
    case "Escaped":
      return `\\${part.value}`;
    case "ParameterExpansion":
      return serializeParameterExpansion(part);
    case "CommandSubstitution":
      if (part.legacy) {
        return `\`${serializeScript(part.body)}\``;
      }
      return `$(${serializeScript(part.body)})`;
    case "ArithmeticExpansion":
      return `$((${serializeArithExpr(part.expression.expression)}))`;
    default:
      // Heredoc bodies typically only contain literals, escaped chars,
      // and expansions. For any other part type, fall back to unquoted.
      return serializeWordPart(part, false);
  }
}

function serializeParameterExpansion(node: ParameterExpansionPart): string {
  if (!node.operation) {
    // Simple $VAR or ${VAR}
    // Use braces if parameter contains special chars or is positional > 9
    if (needsBraces(node.parameter)) {
      return `\${${node.parameter}}`;
    }
    return `$${node.parameter}`;
  }
  return `\${${serializeParameterOp(node.parameter, node.operation)}}`;
}

function needsBraces(parameter: string): boolean {
  // Special parameters like $?, $#, $@, $*, $$, $!, $-, $0-$9 don't need braces
  if (/^[?#@*$!\-0-9]$/.test(parameter)) {
    return false;
  }
  // Simple variable names don't need braces
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(parameter)) {
    return false;
  }
  // Positional params > 9, array subscripts, etc. need braces
  return true;
}

function serializeParameterOp(param: string, op: ParameterOperation): string {
  switch (op.type) {
    case "Length":
      return `#${param}`;
    case "LengthSliceError":
      return `#${param}:`;
    case "BadSubstitution":
      return op.text;
    case "DefaultValue":
      return `${param}${op.checkEmpty ? ":" : ""}-${serializeWordRaw(op.word)}`;
    case "AssignDefault":
      return `${param}${op.checkEmpty ? ":" : ""}=${serializeWordRaw(op.word)}`;
    case "ErrorIfUnset":
      return `${param}${op.checkEmpty ? ":" : ""}?${op.word ? serializeWordRaw(op.word) : ""}`;
    case "UseAlternative":
      return `${param}${op.checkEmpty ? ":" : ""}+${serializeWordRaw(op.word)}`;
    case "Substring": {
      const offset = serializeArithExpr(op.offset.expression);
      if (op.length) {
        return `${param}:${offset}:${serializeArithExpr(op.length.expression)}`;
      }
      return `${param}:${offset}`;
    }
    case "PatternRemoval": {
      const opChar = op.side === "prefix" ? "#" : "%";
      const opStr = op.greedy ? `${opChar}${opChar}` : opChar;
      return `${param}${opStr}${serializeWordRaw(op.pattern)}`;
    }
    case "PatternReplacement": {
      let prefix = "/";
      if (op.all) prefix = "//";
      else if (op.anchor === "start") prefix = "/#";
      else if (op.anchor === "end") prefix = "/%";
      const repl = op.replacement ? `/${serializeWordRaw(op.replacement)}` : "";
      return `${param}${prefix}${serializeWordRaw(op.pattern)}${repl}`;
    }
    case "CaseModification": {
      const opChar = op.direction === "upper" ? "^" : ",";
      const opStr = op.all ? `${opChar}${opChar}` : opChar;
      const pat = op.pattern ? serializeWordRaw(op.pattern) : "";
      return `${param}${opStr}${pat}`;
    }
    case "Transform":
      return `${param}@${op.operator}`;
    case "Indirection": {
      if (op.innerOp) {
        return `!${serializeParameterOp(param, op.innerOp)}`;
      }
      return `!${param}`;
    }
    case "ArrayKeys":
      return `!${op.array}[${op.star ? "*" : "@"}]`;
    case "VarNamePrefix":
      return `!${op.prefix}${op.star ? "*" : "@"}`;
    default: {
      const _exhaustive: never = op;
      throw new Error(
        `Unsupported parameter operation type: ${(_exhaustive as ParameterOperation).type}`,
      );
    }
  }
}

function serializeBraceExpansion(node: BraceExpansionPart): string {
  const items = node.items.map(serializeBraceItem).join(",");
  return `{${items}}`;
}

function serializeBraceItem(item: BraceItem): string {
  if (item.type === "Word") {
    return serializeWord(item.word);
  }
  // Range: {start..end} or {start..end..step}
  const startStr = item.startStr ?? String(item.start);
  const endStr = item.endStr ?? String(item.end);
  if (item.step !== undefined) {
    return `${startStr}..${endStr}..${item.step}`;
  }
  return `${startStr}..${endStr}`;
}

function serializeRedirection(node: RedirectionNode): string {
  const fdStr = node.fdVariable
    ? `{${node.fdVariable}}`
    : node.fd !== null
      ? String(node.fd)
      : "";

  if (node.operator === "<<" || node.operator === "<<-") {
    const heredoc = node.target as HereDocNode;
    const delimStr = heredoc.quoted
      ? `'${heredoc.delimiter}'`
      : heredoc.delimiter;
    const content = serializeHeredocContent(heredoc.content, heredoc.quoted);
    return `${fdStr}${node.operator}${delimStr}\n${content}${heredoc.delimiter}`;
  }

  if (node.operator === "<<<") {
    return `${fdStr}<<< ${serializeWord(node.target as WordNode)}`;
  }

  // For &> and &>>, no fd prefix (the & is part of the operator)
  if (node.operator === "&>" || node.operator === "&>>") {
    return `${node.operator} ${serializeWord(node.target as WordNode)}`;
  }

  return `${fdStr}${node.operator} ${serializeWord(node.target as WordNode)}`;
}

function serializeRedirections(redirections: RedirectionNode[]): string {
  if (redirections.length === 0) return "";
  return ` ${redirections.map(serializeRedirection).join(" ")}`;
}

// Compound commands

function serializeBody(statements: StatementNode[]): string {
  return statements.map(serializeStatement).join("\n");
}

function serializeIf(node: IfNode): string {
  const parts: string[] = [];
  for (let i = 0; i < node.clauses.length; i++) {
    const clause = node.clauses[i];
    const keyword = i === 0 ? "if" : "elif";
    parts.push(
      `${keyword} ${serializeBody(clause.condition)}; then\n${serializeBody(clause.body)}`,
    );
  }
  if (node.elseBody) {
    parts.push(`else\n${serializeBody(node.elseBody)}`);
  }
  return `${parts.join("\n")}${"\n"}fi${serializeRedirections(node.redirections)}`;
}

function serializeFor(node: ForNode): string {
  let header: string;
  if (node.words === null) {
    header = `for ${node.variable}`;
  } else {
    const words = node.words.map(serializeWord).join(" ");
    header = `for ${node.variable} in ${words}`;
  }
  return `${header}; do\n${serializeBody(node.body)}\ndone${serializeRedirections(node.redirections)}`;
}

function serializeCStyleFor(node: CStyleForNode): string {
  const init = node.init ? serializeArithExpr(node.init.expression) : "";
  const cond = node.condition
    ? serializeArithExpr(node.condition.expression)
    : "";
  const update = node.update ? serializeArithExpr(node.update.expression) : "";
  return `for ((${init}; ${cond}; ${update})); do\n${serializeBody(node.body)}\ndone${serializeRedirections(node.redirections)}`;
}

function serializeWhile(node: WhileNode): string {
  return `while ${serializeBody(node.condition)}; do\n${serializeBody(node.body)}\ndone${serializeRedirections(node.redirections)}`;
}

function serializeUntil(node: UntilNode): string {
  return `until ${serializeBody(node.condition)}; do\n${serializeBody(node.body)}\ndone${serializeRedirections(node.redirections)}`;
}

function serializeCase(node: CaseNode): string {
  const items = node.items.map(serializeCaseItem).join("\n");
  return `case ${serializeWord(node.word)} in\n${items}\nesac${serializeRedirections(node.redirections)}`;
}

function serializeCaseItem(node: CaseItemNode): string {
  const patterns = node.patterns.map(serializeWord).join(" | ");
  const body = serializeBody(node.body);
  if (body) {
    return `${patterns})\n${body}\n${node.terminator}`;
  }
  return `${patterns})\n${node.terminator}`;
}

function serializeSubshell(node: SubshellNode): string {
  return `(${serializeBody(node.body)})${serializeRedirections(node.redirections)}`;
}

function serializeGroup(node: GroupNode): string {
  return `{ ${serializeBody(node.body)}; }${serializeRedirections(node.redirections)}`;
}

function serializeArithmeticCommand(node: ArithmeticCommandNode): string {
  return `((${serializeArithExpr(node.expression.expression)}))${serializeRedirections(node.redirections)}`;
}

function serializeConditionalCommand(node: ConditionalCommandNode): string {
  return `[[ ${serializeCondExpr(node.expression)} ]]${serializeRedirections(node.redirections)}`;
}

function serializeFunctionDef(node: FunctionDefNode): string {
  const body = serializeCommand(node.body);
  return `${node.name}() ${body}${serializeRedirections(node.redirections)}`;
}

// Arithmetic expressions

function serializeArithExpr(expr: ArithExpr): string {
  switch (expr.type) {
    case "ArithNumber":
      return String(expr.value);
    case "ArithVariable":
      return expr.hasDollarPrefix ? `$${expr.name}` : expr.name;
    case "ArithSpecialVar":
      return `$${expr.name}`;
    case "ArithBinary":
      return `${serializeArithExpr(expr.left)} ${expr.operator} ${serializeArithExpr(expr.right)}`;
    case "ArithUnary":
      if (expr.prefix) {
        return `${expr.operator}${serializeArithExpr(expr.operand)}`;
      }
      return `${serializeArithExpr(expr.operand)}${expr.operator}`;
    case "ArithTernary":
      return `${serializeArithExpr(expr.condition)} ? ${serializeArithExpr(expr.consequent)} : ${serializeArithExpr(expr.alternate)}`;
    case "ArithAssignment": {
      const target = expr.subscript
        ? `${expr.variable}[${serializeArithExpr(expr.subscript)}]`
        : expr.stringKey !== undefined
          ? `${expr.variable}[${expr.stringKey}]`
          : expr.variable;
      return `${target} ${expr.operator} ${serializeArithExpr(expr.value)}`;
    }
    case "ArithDynamicAssignment": {
      const dynTarget = expr.subscript
        ? `${serializeArithExpr(expr.target)}[${serializeArithExpr(expr.subscript)}]`
        : serializeArithExpr(expr.target);
      return `${dynTarget} ${expr.operator} ${serializeArithExpr(expr.value)}`;
    }
    case "ArithDynamicElement":
      return `${serializeArithExpr(expr.nameExpr)}[${serializeArithExpr(expr.subscript)}]`;
    case "ArithGroup":
      return `(${serializeArithExpr(expr.expression)})`;
    case "ArithNested":
      return `$((${serializeArithExpr(expr.expression)}))`;
    case "ArithCommandSubst":
      return `$(${expr.command})`;
    case "ArithBracedExpansion":
      return `\${${expr.content}}`;
    case "ArithArrayElement": {
      if (expr.stringKey !== undefined) {
        return `${expr.array}[${expr.stringKey}]`;
      }
      if (expr.index) {
        return `${expr.array}[${serializeArithExpr(expr.index)}]`;
      }
      return expr.array;
    }
    case "ArithDynamicBase":
      return `\${${expr.baseExpr}}#${expr.value}`;
    case "ArithDynamicNumber":
      return `\${${expr.prefix}}${expr.suffix}`;
    case "ArithConcat":
      return expr.parts.map(serializeArithExpr).join("");
    case "ArithDoubleSubscript":
      return `${expr.array}[${serializeArithExpr(expr.index)}]`;
    case "ArithNumberSubscript":
      return `${expr.number}[${expr.errorToken}]`;
    case "ArithSyntaxError":
      return expr.errorToken;
    case "ArithSingleQuote":
      return `'${expr.content}'`;
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `Unsupported arithmetic expression type: ${(_exhaustive as ArithExpr).type}`,
      );
    }
  }
}

// Conditional expressions ([[ ]])

function serializeCondExpr(expr: ConditionalExpressionNode): string {
  switch (expr.type) {
    case "CondBinary":
      return `${serializeWord(expr.left)} ${expr.operator} ${serializeWord(expr.right)}`;
    case "CondUnary":
      return `${expr.operator} ${serializeWord(expr.operand)}`;
    case "CondNot":
      return `! ${serializeCondExpr(expr.operand)}`;
    case "CondAnd":
      return `${serializeCondExpr(expr.left)} && ${serializeCondExpr(expr.right)}`;
    case "CondOr":
      return `${serializeCondExpr(expr.left)} || ${serializeCondExpr(expr.right)}`;
    case "CondGroup":
      return `( ${serializeCondExpr(expr.expression)} )`;
    case "CondWord":
      return serializeWord(expr.word);
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `Unsupported conditional expression type: ${(_exhaustive as ConditionalExpressionNode).type}`,
      );
    }
  }
}

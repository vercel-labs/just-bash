/**
 * Known Features Universe
 *
 * Enumerates all dispatch points across bash, AWK, SED, and JQ
 * that are instrumented with coverage tracking.
 */

import { getAllCommandFuzzInfo } from "../../../commands/fuzz-flags.js";

/** Command flag features auto-generated from flagsForFuzzing metadata */
export const CMD_FLAG_FEATURES: readonly string[] = getAllCommandFuzzInfo()
  .flatMap((info) => info.flags.map((f) => `cmd:flag:${info.name}:${f.flag}`));

/** Bash command node types dispatched in interpreter.executeCommand() */
export const BASH_CMD_FEATURES = [
  "bash:cmd:SimpleCommand",
  "bash:cmd:If",
  "bash:cmd:For",
  "bash:cmd:CStyleFor",
  "bash:cmd:While",
  "bash:cmd:Until",
  "bash:cmd:Case",
  "bash:cmd:Subshell",
  "bash:cmd:Group",
  "bash:cmd:FunctionDef",
  "bash:cmd:ArithmeticCommand",
  "bash:cmd:ConditionalCommand",
] as const;

/** Bash builtin commands dispatched in builtin-dispatch.ts */
export const BASH_BUILTIN_FEATURES = [
  "bash:builtin:export",
  "bash:builtin:unset",
  "bash:builtin:exit",
  "bash:builtin:local",
  "bash:builtin:set",
  "bash:builtin:break",
  "bash:builtin:continue",
  "bash:builtin:return",
  "bash:builtin:eval",
  "bash:builtin:shift",
  "bash:builtin:getopts",
  "bash:builtin:compgen",
  "bash:builtin:complete",
  "bash:builtin:compopt",
  "bash:builtin:pushd",
  "bash:builtin:popd",
  "bash:builtin:dirs",
  "bash:builtin:source",
  "bash:builtin:.",
  "bash:builtin:read",
  "bash:builtin:mapfile",
  "bash:builtin:readarray",
  "bash:builtin:declare",
  "bash:builtin:typeset",
  "bash:builtin:readonly",
  "bash:builtin:cd",
  "bash:builtin::",
  "bash:builtin:true",
  "bash:builtin:false",
  "bash:builtin:let",
  "bash:builtin:command",
  "bash:builtin:builtin",
  "bash:builtin:shopt",
  "bash:builtin:exec",
  "bash:builtin:wait",
  "bash:builtin:type",
  "bash:builtin:hash",
  "bash:builtin:help",
  "bash:builtin:[",
  "bash:builtin:test",
] as const;

/** Bash expansion operations instrumented in expansion handlers */
export const BASH_EXPANSION_FEATURES = [
  "bash:expansion:default_value",
  "bash:expansion:assign_default",
  "bash:expansion:error_if_unset",
  "bash:expansion:use_alternative",
  "bash:expansion:pattern_removal",
  "bash:expansion:pattern_replacement",
  "bash:expansion:length",
  "bash:expansion:substring",
  "bash:expansion:case_modification",
  "bash:expansion:transform",
  "bash:expansion:indirection",
  "bash:expansion:array_keys",
  "bash:expansion:var_name_prefix",
  "bash:expansion:tilde",
  "bash:expansion:word_glob",
  "bash:expansion:word_split",
] as const;

/** AWK statement types dispatched in statements.ts */
export const AWK_STMT_FEATURES = [
  "awk:stmt:expr_stmt",
  "awk:stmt:print",
  "awk:stmt:printf",
  "awk:stmt:if",
  "awk:stmt:while",
  "awk:stmt:do_while",
  "awk:stmt:for",
  "awk:stmt:for_in",
  "awk:stmt:break",
  "awk:stmt:continue",
  "awk:stmt:next",
  "awk:stmt:nextfile",
  "awk:stmt:exit",
  "awk:stmt:return",
  "awk:stmt:delete",
  "awk:stmt:block",
] as const;

/** AWK expression types dispatched in expressions.ts */
export const AWK_EXPR_FEATURES = [
  "awk:expr:number",
  "awk:expr:string",
  "awk:expr:regex",
  "awk:expr:field",
  "awk:expr:variable",
  "awk:expr:array_access",
  "awk:expr:binary",
  "awk:expr:unary",
  "awk:expr:ternary",
  "awk:expr:call",
  "awk:expr:assignment",
  "awk:expr:pre_increment",
  "awk:expr:pre_decrement",
  "awk:expr:post_increment",
  "awk:expr:post_decrement",
  "awk:expr:in",
  "awk:expr:getline",
  "awk:expr:tuple",
] as const;

/** SED command types dispatched in executor.ts */
export const SED_CMD_FEATURES = [
  "sed:cmd:substitute",
  "sed:cmd:print",
  "sed:cmd:printFirstLine",
  "sed:cmd:delete",
  "sed:cmd:deleteFirstLine",
  "sed:cmd:append",
  "sed:cmd:insert",
  "sed:cmd:change",
  "sed:cmd:hold",
  "sed:cmd:holdAppend",
  "sed:cmd:get",
  "sed:cmd:getAppend",
  "sed:cmd:exchange",
  "sed:cmd:next",
  "sed:cmd:nextAppend",
  "sed:cmd:quit",
  "sed:cmd:quitSilent",
  "sed:cmd:transliterate",
  "sed:cmd:lineNumber",
  "sed:cmd:branch",
  "sed:cmd:branchOnSubst",
  "sed:cmd:branchOnNoSubst",
  "sed:cmd:label",
  "sed:cmd:zap",
  "sed:cmd:group",
  "sed:cmd:list",
  "sed:cmd:printFilename",
  "sed:cmd:version",
  "sed:cmd:readFile",
  "sed:cmd:readFileLine",
  "sed:cmd:writeFile",
  "sed:cmd:writeFirstLine",
  "sed:cmd:execute",
] as const;

/** JQ/query-engine AST node types dispatched in evaluator.ts */
export const JQ_NODE_FEATURES = [
  "jq:node:Identity",
  "jq:node:Field",
  "jq:node:Index",
  "jq:node:Slice",
  "jq:node:Iterate",
  "jq:node:Pipe",
  "jq:node:Comma",
  "jq:node:Literal",
  "jq:node:Array",
  "jq:node:Object",
  "jq:node:Paren",
  "jq:node:BinaryOp",
  "jq:node:UnaryOp",
  "jq:node:Cond",
  "jq:node:Try",
  "jq:node:Call",
  "jq:node:VarBind",
  "jq:node:VarRef",
  "jq:node:Recurse",
  "jq:node:Optional",
  "jq:node:StringInterp",
  "jq:node:UpdateOp",
  "jq:node:Reduce",
  "jq:node:Foreach",
  "jq:node:Label",
  "jq:node:Break",
  "jq:node:Def",
] as const;

/** All known features combined */
export const ALL_KNOWN_FEATURES: readonly string[] = [
  ...BASH_CMD_FEATURES,
  ...BASH_BUILTIN_FEATURES,
  ...BASH_EXPANSION_FEATURES,
  ...AWK_STMT_FEATURES,
  ...AWK_EXPR_FEATURES,
  ...SED_CMD_FEATURES,
  ...JQ_NODE_FEATURES,
  ...CMD_FLAG_FEATURES,
];

/** Feature categories for reporting */
export const FEATURE_CATEGORIES: Record<string, readonly string[]> = {
  "bash:cmd": BASH_CMD_FEATURES,
  "bash:builtin": BASH_BUILTIN_FEATURES,
  "bash:expansion": BASH_EXPANSION_FEATURES,
  "awk:stmt": AWK_STMT_FEATURES,
  "awk:expr": AWK_EXPR_FEATURES,
  "sed:cmd": SED_CMD_FEATURES,
  "jq:node": JQ_NODE_FEATURES,
  "cmd:flag": CMD_FLAG_FEATURES,
};

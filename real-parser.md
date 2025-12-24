# Real Parser Analysis for bash-env

## The Reality of Bash Parsing

**Key Insight**: Bash's official `parse.y` grammar only covers ~25% of parsing. The rest is handled by:
- Lexer/tokenizer (quotes, escapes, word boundaries)
- Expansion code in `subst.c` (variables, arithmetic, command substitution)
- Special-case parsing for `[[ ]]`, `(( ))`, here-docs

As Chet Ramey (bash maintainer) noted: "Were I starting bash from scratch, I probably would have written a parser by hand."

## Features We've Implemented (Must Be Covered)

### 1. Structural Grammar (covered by parse.y)
```
Commands:        echo, ls, grep, etc.
Pipelines:       cmd1 | cmd2 | cmd3
Lists:           cmd1 && cmd2, cmd1 || cmd2, cmd1 ; cmd2
Control Flow:    if/then/elif/else/fi
                 for VAR in LIST; do ... done
                 while COND; do ... done
                 until COND; do ... done
                 case WORD in pattern) ... ;; esac
Functions:       name() { ... }
Redirections:    >, >>, <, 2>, 2>&1, &>, <<EOF
Subshells:       ( ... )
Command groups:  { ...; }
```

### 2. Variable/Parameter Expansion (NOT in parse.y)
```
Simple:          $VAR, ${VAR}
Default:         ${VAR:-default}, ${VAR:=default}
Alternative:     ${VAR:+alternative}
Error:           ${VAR:?error message}
Length:          ${#VAR}
Substring:       ${VAR:offset}, ${VAR:offset:length}
Pattern removal: ${VAR#pattern}, ${VAR##pattern}
                 ${VAR%pattern}, ${VAR%%pattern}
Replacement:     ${VAR/pattern/replacement}
                 ${VAR//pattern/replacement}
Case modify:     ${VAR^}, ${VAR^^}, ${VAR,}, ${VAR,,}
Special vars:    $?, $!, $$, $#, $@, $*, $0-$9
```

### 3. Arithmetic Expansion (NOT in parse.y)
```
Expansion:       $(( expression ))
Operators:       + - * / % **
                 < > <= >= == !=
                 && || !
                 & | ^ ~ << >>
Assignment:      (( var = expr )), (( var++ )), (( var-- ))
```

### 4. Command Substitution (NOT in parse.y)
```
Modern:          $( command )
Legacy:          ` command `
Nested:          $( cmd1 $( cmd2 ) )
```

### 5. Test Expressions (NOT in parse.y)
```
POSIX test:      [ -f file ], [ "$a" = "$b" ]
Extended test:   [[ -f file ]], [[ $a == pattern ]]
                 [[ $a =~ regex ]]
                 [[ -z $var ]], [[ -n $var ]]
String ops:      [[ $a < $b ]], [[ $a > $b ]]
Logical:         [[ $a && $b ]], [[ $a || $b ]], [[ ! $a ]]
```

### 6. Here Documents (partially in parse.y)
```
Basic:           <<EOF ... EOF
Indented:        <<-EOF ... EOF (strips tabs)
Quoted delim:    <<'EOF' (no expansion)
```

### 7. Quoting & Escaping (lexer level)
```
Single quotes:   'literal $VAR'
Double quotes:   "expanded $VAR"
Escape:          \$, \\, \", \n
ANSI-C:          $'tab\there'
```

### 8. Glob Patterns (expansion phase)
```
Wildcards:       *, ?, [abc], [a-z], [!abc]
Extended:        ?(pattern), *(pattern), +(pattern)
                 @(pattern), !(pattern)
```

## Complete Grammar Required

A complete bash grammar must handle ALL of the above. Here's the full EBNF:

```ebnf
(* === TOP LEVEL === *)
script          ::= newline* ( statement newline+ )* statement? ;

statement       ::= pipeline ( ( '&&' | '||' ) newline* pipeline )* ;

pipeline        ::= '!'? command ( '|' newline* command )* ;

command         ::= simple_command
                  | compound_command redirect*
                  | function_def ;

(* === SIMPLE COMMANDS === *)
simple_command  ::= ( assignment | redirect )* word ( word | redirect )* ;

assignment      ::= NAME '=' word?
                  | NAME '+=' word? ;

(* === COMPOUND COMMANDS === *)
compound_command ::= if_clause
                   | for_clause
                   | while_clause
                   | until_clause
                   | case_clause
                   | subshell
                   | group
                   | arith_command
                   | cond_command ;

if_clause       ::= 'if' compound_list 'then' compound_list
                    ( 'elif' compound_list 'then' compound_list )*
                    ( 'else' compound_list )?
                    'fi' ;

for_clause      ::= 'for' NAME ( 'in' word* )? sep 'do' compound_list 'done'
                  | 'for' '((' arith_expr ';' arith_expr ';' arith_expr '))'
                    sep? 'do' compound_list 'done' ;

while_clause    ::= 'while' compound_list 'do' compound_list 'done' ;

until_clause    ::= 'until' compound_list 'do' compound_list 'done' ;

case_clause     ::= 'case' word 'in' newline* case_item* 'esac' ;

case_item       ::= '('? pattern ( '|' pattern )* ')'
                    compound_list? ( ';;' | ';&' | ';;&' ) newline* ;

subshell        ::= '(' compound_list ')' ;

group           ::= '{' compound_list '}' ;

arith_command   ::= '((' arith_expr '))' ;

cond_command    ::= '[[' cond_expr ']]' ;

(* === FUNCTIONS === *)
function_def    ::= NAME '(' ')' newline* function_body
                  | 'function' NAME ( '(' ')' )? newline* function_body ;

function_body   ::= compound_command redirect* ;

(* === REDIRECTIONS === *)
redirect        ::= NUMBER? ( '<' | '>' | '>>' | '>&' | '<&' | '<>' | '>|' ) word
                  | NUMBER? '<<' '-'? DELIM         (* here-doc *)
                  | NUMBER? '<<<' word              (* here-string *)
                  | '&>' word | '&>>' word ;        (* bash extension *)

(* === WORDS & EXPANSIONS === *)
word            ::= ( LITERAL | single_quoted | double_quoted | expansion )+ ;

single_quoted   ::= "'" ( ~"'" )* "'" ;

double_quoted   ::= '"' ( escaped | expansion | ~( '"' | '$' | '`' | '\\' ) )* '"' ;

escaped         ::= '\\' ( '$' | '`' | '"' | '\\' | NEWLINE ) ;

(* === EXPANSIONS (the 75% not in parse.y) === *)
expansion       ::= param_expansion
                  | command_subst
                  | arith_expansion
                  | process_subst ;

param_expansion ::= '$' NAME
                  | '$' SPECIAL                    (* $?, $!, $$, etc *)
                  | '${' param_expr '}' ;

param_expr      ::= NAME
                  | NAME ':' '-' word?             (* ${VAR:-default} *)
                  | NAME ':' '=' word?             (* ${VAR:=default} *)
                  | NAME ':' '+' word?             (* ${VAR:+alt} *)
                  | NAME ':' '?' word?             (* ${VAR:?error} *)
                  | '#' NAME                       (* ${#VAR} length *)
                  | NAME ':' NUMBER (':' NUMBER)?  (* ${VAR:0:5} substring *)
                  | NAME '#' pattern               (* ${VAR#pat} *)
                  | NAME '##' pattern              (* ${VAR##pat} *)
                  | NAME '%' pattern               (* ${VAR%pat} *)
                  | NAME '%%' pattern              (* ${VAR%%pat} *)
                  | NAME '/' pattern '/' word?     (* ${VAR/pat/repl} *)
                  | NAME '//' pattern '/' word?    (* ${VAR//pat/repl} *)
                  | NAME '^' | NAME '^^'           (* uppercase *)
                  | NAME ',' | NAME ',,' ;         (* lowercase *)

command_subst   ::= '$(' compound_list ')'
                  | '`' ( ~'`' | '\\`' )* '`' ;

arith_expansion ::= '$((' arith_expr '))' ;

process_subst   ::= '<(' compound_list ')'
                  | '>(' compound_list ')' ;

(* === ARITHMETIC === *)
arith_expr      ::= arith_term ( ( '+' | '-' ) arith_term )* ;
arith_term      ::= arith_factor ( ( '*' | '/' | '%' ) arith_factor )* ;
arith_factor    ::= arith_unary ( '**' arith_unary )* ;
arith_unary     ::= ( '-' | '+' | '!' | '~' )? arith_primary ;
arith_primary   ::= NUMBER | NAME | '(' arith_expr ')'
                  | NAME ( '++' | '--' ) | ( '++' | '--' ) NAME ;

(* === CONDITIONAL EXPRESSIONS === *)
cond_expr       ::= cond_or ;
cond_or         ::= cond_and ( '||' cond_and )* ;
cond_and        ::= cond_not ( '&&' cond_not )* ;
cond_not        ::= '!'? cond_primary ;
cond_primary    ::= '-' UNARY_OP word              (* -f, -d, -z, -n, etc *)
                  | word '==' word                 (* pattern match *)
                  | word '!=' word
                  | word '=~' REGEX                (* regex match *)
                  | word ( '-eq' | '-ne' | '-lt' | '-le' | '-gt' | '-ge' ) word
                  | '(' cond_expr ')' ;

(* === HELPERS === *)
compound_list   ::= newline* statement ( sep statement )* ;
sep             ::= ';' | NEWLINE | '&' ;
newline         ::= NEWLINE | COMMENT ;
pattern         ::= word ;                         (* glob pattern *)

(* === TOKENS === *)
NAME            ::= [a-zA-Z_][a-zA-Z0-9_]* ;
NUMBER          ::= [0-9]+ ;
SPECIAL         ::= '?' | '!' | '$' | '#' | '@' | '*' | '-' | '0'..'9' ;
LITERAL         ::= [^"'$`\\|&;<>(){}[\]!?\s]+ ;
DELIM           ::= WORD ;                         (* here-doc delimiter *)
COMMENT         ::= '#' [^\n]* ;
NEWLINE         ::= '\n' ;
```

## Why Existing Solutions Fall Short

| Solution | Structural | Var Expansion | Arithmetic | [[ ]] | Here-docs |
|----------|-----------|---------------|------------|-------|-----------|
| bash parse.y | ✅ | ❌ | ❌ | ❌ | Partial |
| bash-parser (JS) | ✅ | Partial | ❌ | ❌ | ✅ |
| bashlex (Python) | ✅ | Partial | ❌ | ? | ✅ |
| mvdan-sh | ✅ | ✅ | ✅ | ✅ | ✅ |

**mvdan-sh** is the most complete but:
- Transpiled from Go (large bundle, ~500KB)
- Last updated 4 years ago
- Complex integration

## Recommended Approach

### Option A: Extend bash-parser + Custom Expansion
1. Use `bash-parser` for structural grammar
2. Implement our own expansion system (which we already have!)
3. Add `[[ ]]` and `(( ))` parsing

```typescript
// Hybrid approach
import bashParser from '@ericcornelissen/bash-parser';

function parse(input: string): AST {
  // 1. Pre-process: extract here-docs, normalize
  const preprocessed = preprocess(input);

  // 2. Structural parse with bash-parser
  const structuralAST = bashParser(preprocessed);

  // 3. Walk AST and expand each word node
  return walkAndExpand(structuralAST, {
    expandVariables,    // Our existing code
    expandArithmetic,   // Our existing code
    expandCommand,      // Our existing code
  });
}
```

### Option B: Custom Chevrotain Parser (Full Control)
Build complete parser with Chevrotain covering all features:

```typescript
import { createToken, Lexer, CstParser } from "chevrotain";

// === TOKENS ===
const Dollar = createToken({ name: "Dollar", pattern: /\$/ });
const DoubleParen = createToken({ name: "DoubleParen", pattern: /\(\(/ });
const DoubleBracket = createToken({ name: "DoubleBracket", pattern: /\[\[/ });
const ParamStart = createToken({ name: "ParamStart", pattern: /\$\{/ });
// ... 50+ token definitions

// === PARSER ===
class BashParser extends CstParser {
  script = this.RULE("script", () => { ... });
  paramExpansion = this.RULE("paramExpansion", () => {
    this.CONSUME(ParamStart);
    this.SUBRULE(this.paramExpr);
    this.CONSUME(RBrace);
  });
  arithExpansion = this.RULE("arithExpansion", () => { ... });
  condCommand = this.RULE("condCommand", () => { ... });
  // ... 30+ grammar rules
}
```

### Option C: Incremental Enhancement (Pragmatic)
Keep current parser, add AST output, incrementally improve:

1. **Phase 1**: Add AST types, make current parser produce AST
2. **Phase 2**: Create tree-walking interpreter
3. **Phase 3**: Replace parser piece-by-piece with grammar-based parsing
4. **Phase 4**: Full coverage via Chevrotain when needed

## Recommendation

**Option C (Incremental)** is most pragmatic because:
- Our current parser already handles most features
- 1824 tests pass against real bash
- Risk of regressions with full rewrite
- Can adopt grammar-based approach incrementally

### Next Steps
1. Define complete AST types for all node kinds
2. Modify current parser to produce AST instead of direct execution
3. Create tree-walking interpreter
4. Add grammar tests comparing AST output
5. Incrementally replace regex parsing with Chevrotain rules

## AST Node Types Needed

```typescript
// Complete AST type definitions
type ASTNode =
  | ScriptNode
  | PipelineNode
  | CommandNode
  | AssignmentNode
  | RedirectionNode
  | IfNode
  | ForNode
  | WhileNode
  | UntilNode
  | CaseNode
  | FunctionNode
  | SubshellNode
  | GroupNode
  | ArithCommandNode
  | CondCommandNode
  | WordNode
  | ExpansionNode;

interface WordNode {
  type: "Word";
  parts: WordPart[];
}

type WordPart =
  | { type: "Literal"; value: string }
  | { type: "SingleQuoted"; value: string }
  | { type: "DoubleQuoted"; parts: WordPart[] }
  | { type: "ParamExpansion"; name: string; op?: string; arg?: WordNode }
  | { type: "CommandSubst"; body: ScriptNode }
  | { type: "ArithExpansion"; expr: ArithExpr }
  | { type: "ProcessSubst"; direction: "<" | ">"; body: ScriptNode };

interface ParamExpansion {
  type: "ParamExpansion";
  name: string;
  operator?: ":-" | ":=" | ":+" | ":?" | "#" | "##" | "%" | "%%" | "/" | "//";
  argument?: WordNode;
}
```

## References

- [Bash Source - parse.y](https://github.com/bminor/bash/blob/master/parse.y) - Official yacc grammar (~25%)
- [Bash Source - subst.c](https://github.com/bminor/bash/blob/master/subst.c) - Expansion code (~75%)
- [GNU Bash Manual](https://www.gnu.org/software/bash/manual/bash.html) - Complete documentation
- [bashlex](https://github.com/idank/bashlex) - Python port of bash parser
- [bash-parser](https://github.com/vorpaljs/bash-parser) - JS parser (Jison-based)
- [mvdan-sh](https://github.com/mvdan/sh) - Go parser (most complete)
- [Chevrotain](https://chevrotain.io/) - TypeScript parser toolkit
- [Oils Wiki - Parsing Models](https://github.com/oils-for-unix/oils/wiki/Parsing-Models-Cheatsheet)

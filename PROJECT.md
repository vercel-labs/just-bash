# Overview

Build a class BashEnv that represents a fully simulated bash environment, but without the ability to run native code. All bash commands are implemented in TS and run on the virtual FS.

- All written in typescript
- Receive a set of files to store in a file system. The file system should be kept in memory but use an async abstraction for a file system
- exec method that runs a shell command
- read files and write files methods that allow access to the fs via the BashEnv instance
- Support for ls, mkdir, grep, cat, pipes, STDOUT, STDERR, etc with the most commonly used options
- Make it easy to add more commands
- Build a strong testing system with vitess where each test follows the pattern

  - Make env with files
  - Run command(s)
  - Assert output and state of FS is correct
  - No mocking since it is all virtual

- ALWAYS start by reading AGENTS.md

## Implementation

- First step write a file `bash-examples.md` of commands that should be supported.
- Commands should be in their own directory like `./commands/grep/grep.ts` and be neatly organized with unit tests if needed
- As much as possible reuse command-related npm packages to avoid implementing too much yourself
- Do `cat` and `echo` before complicated thinks like `sed` and `awk`

## Implementation phase 2

- Make a dedicated test file for bash syntax like logical or, etc.
- I really care about grep. Lets ensure it works incredibly well
- Imagine you are an AI agent that has a bash tool and a filesystem. Write a set of scenarios into ./agent-examples/$scenario.md of files that might exist and bash commands you'd want to run to explore these files.

## Implementation phase 3

- Separate FS and VirtualFS into an abstraction that allows the caller of BashEnv to supply their own FS
- Turn each agent-examples/\*.md file into a .test.ts file that validates the scenario works as expected
- Implement the more advanced commands from bash-examples.md

## Implementation phase 4

- Add a set of tests that compare our virtual BashEnv to a real bash
  - Each test should create a directory in /tmp/test-name
  - Put files
  - Ue node.js shell exec to actually run bash commands on those files
  - Collect output
  - Create equivalent BashEnv
  - Compare outputs to be identical

## Implementation phase 5

- Implement `cd` and a notion of a current working directory. Add unit tests.
- Implement a true virtual shell that I can boot and use as a human on my tty

## Implementation phase 6

- ALWAYS start by reading AGENTS.md
- Add -h or --help options where applicable
- Go through each command and make sure we have all popular options supported
- Are we missing important commands?

## Implementation phase 7

- Make all the commands appear in /bin in the virtual filesystem (or where it is most idiomatic)
  - Document in README
- Make the virtual file system default to putting files into `/home/user` if they are relative.
  - Document
- Add additional bash features (if statements, maybe functions if it is not too hard)

## Implementation phase 8

- Add support for the local keyword
- Add a new set of tests that try to exercise edge cases in the parser

## Implementation phase 9

- Refactor tests to be more, shorter files named after sub-area they exercise (per new AGENTS.md instruction)
- Add support for bash loops
- Add protection against endless execution (stack overrun, endless recursion, endless loops)
- Add tests for parse errors and behavior
- Add more parser edge cases and xargs, etc. advanced usage

Ensure we fully support this list from ChatGPT:

Navigation & files

ls — list files and directories

cd — change directory

pwd — show current directory

tree — recursive directory view (often installed separately)

File operations

cp — copy files/directories

mv — move or rename

rm — delete files/directories

mkdir — create directories

touch — create empty files / update timestamps

Viewing & inspecting files

cat — print file contents

less/more — paginated file viewer ()

head / tail — first/last lines

wc — line/word/byte counts

stat — detailed file metadata

Search & text processing

grep — search text with patterns

find — search files by name/criteria

sed — stream editor (search/replace)

awk — column-based text processing

sort / uniq — ordering and deduplication

cut — extract columns

tr — character translation

Permissions & ownership

chmod — change permissions

chown — change owner

chgrp — change group

Processes & system

ps - Mock only

top / htop — Mock only

kill — Mock only

uptime — system runtime/load

df — disk usage Mock

du — directory sizes

free — memory usage Mock

Shell & environment

echo — print text/vars

env — list environment variables

export — set env vars

alias — command shortcuts

history — command history

clear — clear terminal

Redirection & composition (used constantly)

| — pipe output

> / >> — redirect output

< — redirect input

&& / || — conditional chaining

xargs — build argument lists

## Implementation phase 10

- Implement ln, hard and soft-links in the virtual fs
- Should we have a global help command?

## Implementation phase 11

- Add awk comparison tests
- Add awk tests to the agent scenarios
- add a bash command and common aliases like /bin/sh that can run shell scripts from the command line and from files

## Implementation phase 12

- Lazy load commands via dynamic import
  - Command should be eagerly registered
  - But their implementations should only be loaded when they are actually called
- Make sure that files support Buffers and encoding

## Implementation phase 13

- Do we handle stop of execution in multi-line script for non-zero return values?

## Implementation phase 14

- Should the parser be rewritten to use an official AST? Could we parse with an official bash grammar?
  - Search the web for official grammars and use an existing npm package for parsing the grammer and the input
- Further extend composition tests
- Start by writing `real-parser.md` and then confirm further work.

## Implementation phase 15

- Implement set -e

## Implementation phase 16: curl

- make a new non-standard command called html-to-markdown which uses turndown service (npm package) to turns HTML on STDIN to markdown
- Lets implement curl as a wrapper around `fetch`
- Start with the most common options: method, headers, etc.
- `curl` should not be available by default. It should require explicit opt-in via argument to BashEnv or Sandbox.create
- The optin requires an allow-list of allowed origin + oath (optional) prefixes. Only those must be accessible via `fetch`
  - Must also be checked on redirects, so implement redirects in user land rather that relying on following
  - This allow-list must be enforced at the fetch layer, not subject to parsing
  - Implement extensive unit tests for the allow-list matching specifically
  - add `dangerouslyAllowFullInternetAccess` option to bypass allow-list

## Implementation phase 16.1: curl part 2

- Make the usage statement for html-to-markdown more docs-like since the caller will not be aware of this
- Write more adversarial tests against the allow-list enforcement
- Write tests that check the allow-list is enforced e2e (via bash execution)
- Make sure the tests have a really good mock of the underlying fetch and never actually go to the network
- allow `pnpm shell` to access the internet and document it

## Implementation phase 17: AI SDK Tool

- Make bash-env/ai using AI SDK as a peer dependency (and install for dev)
- Focus on AI SDK version 6 (current stable)
- Our export is a function called `createBashTool` which uses `ai`'s `tool` function to create a tool called `Bash`.
- Read the docs if you are not very familiar.
- The tool should have succinct instructions letting the AI agent know how to use it
- If initial files are provided, the instructions should show very common operations (find, grep, ls) on a small selection of files
- Tell the agent how to discover all available commands and their options.
- Accept a string of extra instructions provided by the user
- Support full config of the BashEnv. Network default of (which is the default)
- Support an optional allow-list of registered commands
- Make examples/bash-agent which is a simple AI agent (with its own package.json) that exercises the tool with sample files read from disk.

## Implementation phase 18

- Implement an alternative copy-on-write filesystem
- The user provides a root directory under which files are made available
- Read operations access the underlying file-system
- There must not be a way to escape that root
- The file-system is writable, but those changes only persist to an in-memory layer
- It's not required for changes to the underlying filesytem to be visible to the caller
  - What this means, you can keep directory listings in memory and only change those copies
  - But only read files from disk once the user actually wants to read them
- Make this a new directory

## All before this is done

Woohoo

## Implementation phase 19

Find documentation for all bash commannds and builtins, grammar, functionality, semantics, etc. ideally in markdown or text or similar form and copy it into /tmp/official-bash-docs/$sourceDomain

## Implementation phase 20

- Implement which and proper PATH to resolve commands

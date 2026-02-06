import type { Bash } from "just-bash/browser";
import { track } from "@vercel/analytics";
import { HISTORY_KEY, MAX_HISTORY } from "./constants";
import { formatMarkdown } from "./markdown";

type Terminal = {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
  onData: (callback: (data: string) => void) => void;
};


// Find the start of the previous word
function findPrevWordBoundary(str: string, pos: number): number {
  if (pos <= 0) return 0;
  let i = pos - 1;
  // Skip trailing spaces
  while (i > 0 && str[i] === " ") i--;
  // Skip word characters
  while (i > 0 && str[i - 1] !== " ") i--;
  return i;
}

// Find the end of the next word
function findNextWordBoundary(str: string, pos: number): number {
  const len = str.length;
  if (pos >= len) return len;
  let i = pos;
  // Skip leading spaces
  while (i < len && str[i] === " ") i++;
  // Skip word characters
  while (i < len && str[i] !== " ") i++;
  return i;
}

// Extract the word being typed for completion
function getCompletionContext(cmd: string, cursorPos: number): { prefix: string; wordStart: number } {
  let wordStart = cursorPos;
  // Walk back to find the start of the current word
  while (wordStart > 0 && cmd[wordStart - 1] !== " ") {
    wordStart--;
  }
  return {
    prefix: cmd.slice(wordStart, cursorPos),
    wordStart,
  };
}

export function createInputHandler(term: Terminal, bash: Bash) {
  const history: string[] = JSON.parse(
    sessionStorage.getItem(HISTORY_KEY) || "[]"
  );
  let cmd = "";
  let cursorPos = 0;
  let historyIndex = history.length;

  // Commands for completion (first word only)
  const commands = [
    // Custom commands
    "agent",
    "about",
    "install",
    "github",
    // Common external commands
    "cat",
    "ls",
    "grep",
    "head",
    "tail",
    "wc",
    "sort",
    "uniq",
    "tr",
    "cut",
    "sed",
    "awk",
    "find",
    "xargs",
    "tee",
    "diff",
    "patch",
    "mkdir",
    "rmdir",
    "rm",
    "cp",
    "mv",
    "touch",
    "chmod",
    "chown",
    "ln",
    "basename",
    "dirname",
    "realpath",
    "date",
    "sleep",
    "seq",
    "yes",
    "env",
    "which",
    "whoami",
    "hostname",
    "uname",
    "curl",
    "wget",
    // Bash builtins
    ".",
    ":",
    "[",
    "alias",
    "bg",
    "break",
    "builtin",
    "caller",
    "cd",
    "command",
    "compgen",
    "complete",
    "continue",
    "declare",
    "dirs",
    "disown",
    "echo",
    "enable",
    "eval",
    "exec",
    "exit",
    "export",
    "false",
    "fc",
    "fg",
    "getopts",
    "hash",
    "help",
    "history",
    "jobs",
    "kill",
    "let",
    "local",
    "logout",
    "mapfile",
    "popd",
    "printf",
    "pushd",
    "pwd",
    "read",
    "readarray",
    "readonly",
    "return",
    "set",
    "shift",
    "shopt",
    "source",
    "suspend",
    "test",
    "times",
    "trap",
    "true",
    "type",
    "typeset",
    "ulimit",
    "umask",
    "unalias",
    "unset",
    "wait",
    "clear",
  ];

  const redrawLine = () => {
    term.write("\r$ " + cmd + "\x1b[K");
    const moveBack = cmd.length - cursorPos;
    if (moveBack > 0) {
      term.write(`\x1b[${moveBack}D`);
    }
  };

  const setCmd = (newCmd: string, newCursorPos?: number) => {
    cmd = newCmd;
    cursorPos = newCursorPos ?? newCmd.length;
    redrawLine();
  };

  const colorizeUrls = (text: string) => {
    return text.replace(/(https?:\/\/[^\s]+)/g, "\x1b[36m\x1b[4m$1\x1b[0m");
  };

  // Tab completion
  const handleTabCompletion = async () => {
    const { prefix, wordStart } = getCompletionContext(cmd, cursorPos);
    if (!prefix) return;

    // Determine if we're completing a command (first word) or a file argument
    const isFirstWord = cmd.slice(0, wordStart).trim() === "";

    let candidates: string[];
    if (isFirstWord) {
      // Complete commands
      candidates = commands;
    } else {
      // Complete files from current directory
      const lsResult = await bash.exec("ls -1");
      candidates = lsResult.stdout
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    }

    // Find matching candidates
    const matches = candidates.filter((c) =>
      c.toLowerCase().startsWith(prefix.toLowerCase())
    );

    if (matches.length === 0) {
      // No matches - do nothing
      return;
    }

    if (matches.length === 1) {
      // Single match - complete it
      const completion = matches[0];
      cmd = cmd.slice(0, wordStart) + completion + cmd.slice(cursorPos);
      cursorPos = wordStart + completion.length;
      redrawLine();
    } else {
      // Multiple matches - find common prefix and show options
      let commonPrefix = matches[0];
      for (const match of matches) {
        let i = 0;
        while (
          i < commonPrefix.length &&
          i < match.length &&
          commonPrefix[i].toLowerCase() === match[i].toLowerCase()
        ) {
          i++;
        }
        commonPrefix = commonPrefix.slice(0, i);
      }

      if (commonPrefix.length > prefix.length) {
        // Extend to common prefix
        cmd = cmd.slice(0, wordStart) + commonPrefix + cmd.slice(cursorPos);
        cursorPos = wordStart + commonPrefix.length;
        redrawLine();
      } else {
        // Show all matches
        term.writeln("");
        term.writeln(matches.join("  "));
        term.write("$ " + cmd);
        // Reposition cursor
        const moveBack = cmd.length - cursorPos;
        if (moveBack > 0) {
          term.write(`\x1b[${moveBack}D`);
        }
      }
    }
  };

  // Execute a command programmatically
  const executeCommand = async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;

    track("command", { fullCommand: trimmed, command: trimmed.split(" ")[0] });

    history.push(trimmed);
    historyIndex = history.length;
    sessionStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(history.slice(-MAX_HISTORY))
    );

    if (trimmed === "clear") {
      term.write("\x1b[2J\x1b[3J\x1b[H");
    } else {
      const result = await bash.exec(trimmed);
      if (result.stdout)
        term.write(
          formatMarkdown(colorizeUrls(result.stdout)).replace(/\n/g, "\r\n")
        );
      if (result.stderr) term.write(result.stderr.replace(/\n/g, "\r\n"));
    }

    cmd = "";
    cursorPos = 0;
    term.write("$ ");
  };

  term.onData(async (e: string) => {
    // Enter - execute command
    if (e === "\r") {
      term.writeln("");
      await executeCommand(cmd);
      return;
    }

    // Tab - autocomplete
    if (e === "\t") {
      await handleTabCompletion();
      return;
    }

    // Ctrl+A - jump to start of line
    if (e === "\x01") {
      cursorPos = 0;
      redrawLine();
      return;
    }

    // Ctrl+E - jump to end of line
    if (e === "\x05") {
      cursorPos = cmd.length;
      redrawLine();
      return;
    }

    // Ctrl+U - delete line before cursor
    if (e === "\x15") {
      cmd = cmd.slice(cursorPos);
      cursorPos = 0;
      redrawLine();
      return;
    }

    // Ctrl+K - kill to end of line
    if (e === "\x0b") {
      cmd = cmd.slice(0, cursorPos);
      redrawLine();
      return;
    }

    // Ctrl+W - delete word backward
    if (e === "\x17") {
      const newPos = findPrevWordBoundary(cmd, cursorPos);
      cmd = cmd.slice(0, newPos) + cmd.slice(cursorPos);
      cursorPos = newPos;
      redrawLine();
      return;
    }

    // Ctrl+L - clear screen (keep current line)
    if (e === "\x0c") {
      // Clear screen and scrollback, move cursor to home, then redraw prompt
      term.write("\x1b[2J\x1b[3J\x1b[H$ " + cmd + "\x1b[K");
      const moveBack = cmd.length - cursorPos;
      if (moveBack > 0) {
        term.write(`\x1b[${moveBack}D`);
      }
      return;
    }

    // Alt+Backspace - delete word backward (same as Ctrl+W)
    if (e === "\x1b\x7f") {
      const newPos = findPrevWordBoundary(cmd, cursorPos);
      cmd = cmd.slice(0, newPos) + cmd.slice(cursorPos);
      cursorPos = newPos;
      redrawLine();
      return;
    }

    // Alt+D - delete word forward
    if (e === "\x1bd") {
      const newPos = findNextWordBoundary(cmd, cursorPos);
      cmd = cmd.slice(0, cursorPos) + cmd.slice(newPos);
      redrawLine();
      return;
    }

    // Up arrow - previous history
    if (e === "\x1b[A") {
      if (historyIndex > 0) {
        historyIndex--;
        setCmd(history[historyIndex]);
      }
      return;
    }

    // Down arrow - next history
    if (e === "\x1b[B") {
      if (historyIndex < history.length - 1) {
        historyIndex++;
        setCmd(history[historyIndex]);
      } else if (historyIndex === history.length - 1) {
        historyIndex = history.length;
        setCmd("");
      }
      return;
    }

    // Left arrow
    if (e === "\x1b[D") {
      if (cursorPos > 0) {
        cursorPos--;
        term.write("\x1b[D");
      }
      return;
    }

    // Right arrow
    if (e === "\x1b[C") {
      if (cursorPos < cmd.length) {
        cursorPos++;
        term.write("\x1b[C");
      }
      return;
    }

    // Alt+Left or Ctrl+Left - jump to previous word
    if (e === "\x1b[1;3D" || e === "\x1b[1;5D" || e === "\x1bb") {
      cursorPos = findPrevWordBoundary(cmd, cursorPos);
      redrawLine();
      return;
    }

    // Alt+Right or Ctrl+Right - jump to next word
    if (e === "\x1b[1;3C" || e === "\x1b[1;5C" || e === "\x1bf") {
      cursorPos = findNextWordBoundary(cmd, cursorPos);
      redrawLine();
      return;
    }

    // Home key - jump to start
    if (e === "\x1b[H" || e === "\x1bOH" || e === "\x1b[1~") {
      cursorPos = 0;
      redrawLine();
      return;
    }

    // End key - jump to end
    if (e === "\x1b[F" || e === "\x1bOF" || e === "\x1b[4~") {
      cursorPos = cmd.length;
      redrawLine();
      return;
    }

    // Backspace - delete char before cursor
    if (e === "\x7F" || e === "\b") {
      if (cursorPos > 0) {
        cmd = cmd.slice(0, cursorPos - 1) + cmd.slice(cursorPos);
        cursorPos--;
        redrawLine();
      }
      return;
    }

    // Delete key - delete char at cursor
    if (e === "\x1b[3~") {
      if (cursorPos < cmd.length) {
        cmd = cmd.slice(0, cursorPos) + cmd.slice(cursorPos + 1);
        redrawLine();
      }
      return;
    }

    // Ctrl+C - cancel current line
    if (e === "\x03") {
      term.writeln("^C");
      cmd = "";
      cursorPos = 0;
      term.write("$ ");
      return;
    }

    // Printable characters
    if (e >= " " && e <= "~") {
      cmd = cmd.slice(0, cursorPos) + e + cmd.slice(cursorPos);
      cursorPos++;
      redrawLine();
      return;
    }
  });

  // Return functions to manipulate state from outside
  return {
    history,
    setInitialCommand: (initialCmd: string) => {
      cmd = initialCmd;
      cursorPos = initialCmd.length;
      term.write(initialCmd);
    },
    executeCommand: async (command: string) => {
      term.write(command);
      term.writeln("");
      await executeCommand(command);
    },
  };
}

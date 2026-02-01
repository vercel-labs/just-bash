import type { Bash } from "just-bash/browser";
import { HISTORY_KEY, MAX_HISTORY } from "./constants";
import { formatMarkdown } from "./markdown";

type Terminal = {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
  onData: (callback: (data: string) => void) => void;
};

export function createInputHandler(term: Terminal, bash: Bash) {
  const history: string[] = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
  let cmd = "";
  let cursorPos = 0;
  let historyIndex = history.length;

  const redrawLine = () => {
    term.write("\r$ " + cmd + "\x1b[K");
    const moveBack = cmd.length - cursorPos;
    if (moveBack > 0) {
      term.write(`\x1b[${moveBack}D`);
    }
  };

  const setCmd = (newCmd: string) => {
    cmd = newCmd;
    cursorPos = newCmd.length;
    redrawLine();
  };

  const colorizeUrls = (text: string) => {
    return text.replace(
      /(https?:\/\/[^\s]+)/g,
      "\x1b[36m\x1b[4m$1\x1b[0m"
    );
  };

  term.onData(async (e: string) => {
    if (e === "\r") {
      term.writeln("");
      if (cmd.trim()) {
        history.push(cmd);
        historyIndex = history.length;
        sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
        if (cmd.trim() === "clear") {
          term.clear();
        } else {
          const result = await bash.exec(cmd.trim());
          if (result.stdout)
            term.write(formatMarkdown(colorizeUrls(result.stdout)).replace(/\n/g, "\r\n"));
          if (result.stderr)
            term.write(result.stderr.replace(/\n/g, "\r\n"));
        }
      }
      cmd = "";
      cursorPos = 0;
      term.write("$ ");
    } else if (e === "\x1b[A") {
      // Up arrow - previous history
      if (historyIndex > 0) {
        historyIndex--;
        setCmd(history[historyIndex]);
      }
    } else if (e === "\x1b[B") {
      // Down arrow - next history
      if (historyIndex < history.length - 1) {
        historyIndex++;
        setCmd(history[historyIndex]);
      } else if (historyIndex === history.length - 1) {
        historyIndex = history.length;
        setCmd("");
      }
    } else if (e === "\x1b[D") {
      // Left arrow
      if (cursorPos > 0) {
        cursorPos--;
        term.write("\x1b[D");
      }
    } else if (e === "\x1b[C") {
      // Right arrow
      if (cursorPos < cmd.length) {
        cursorPos++;
        term.write("\x1b[C");
      }
    } else if (e === "\x7F" || e === "\b") {
      // Backspace - delete char before cursor
      if (cursorPos > 0) {
        cmd = cmd.slice(0, cursorPos - 1) + cmd.slice(cursorPos);
        cursorPos--;
        redrawLine();
      }
    } else if (e === "\x1b[3~") {
      // Delete key - delete char at cursor
      if (cursorPos < cmd.length) {
        cmd = cmd.slice(0, cursorPos) + cmd.slice(cursorPos + 1);
        redrawLine();
      }
    } else if (e >= " " && e <= "~") {
      // Insert character at cursor position
      cmd = cmd.slice(0, cursorPos) + e + cmd.slice(cursorPos);
      cursorPos++;
      redrawLine();
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
  };
}

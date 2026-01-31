"use client";

import { useEffect, useRef } from "react";
import { Bash, defineCommand } from "just-bash/browser";
import "@xterm/xterm/css/xterm.css";
import { getTerminalData } from "./TerminalData";

const ASCII_ART = [
  "   _           _   _               _",
  "  (_)_   _ ___| |_| |__   __ _ ___| |__",
  "  | | | | / __| __| '_ \\ / _` / __| '_ \\",
  "  | | |_| \\__ \\ |_| |_) | (_| \\__ \\ | | |",
  " _/ |\\__,_|___/\\__|_.__/ \\__,_|___/_| |_|",
  "|__/",
];

export default function TerminalComponent() {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    // Load xterm at runtime (uses `self` at module evaluation)
    const { Terminal } = require("@xterm/xterm");
    const { FitAddon } = require("@xterm/addon-fit");
    const { WebLinksAddon } = require("@xterm/addon-web-links");

    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 15,
      fontFamily: '"Geist Mono", "SF Mono", Menlo, monospace',
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: {
        background: isDark ? "#000" : "#fff",
        foreground: isDark ? "#e0e0e0" : "#1a1a1a",
        cursor: isDark ? "#fff" : "#000",
        cyan: isDark ? "#22d3ee" : "#0891b2",
        brightCyan: isDark ? "#67e8f9" : "#0e7490",
        brightBlack: isDark ? "#666" : "#525252",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon(undefined, {
      decorations: {
        pointerCursor: true,
        underline: true,
      },
    });
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(container);

    // Custom commands from DOM
    const aboutCmd = defineCommand("about", async () => ({
      stdout: getTerminalData("cmd-about"),
      stderr: "",
      exitCode: 0,
    }));

    const installCmd = defineCommand("install", async () => ({
      stdout: getTerminalData("cmd-install"),
      stderr: "",
      exitCode: 0,
    }));

    const githubCmd = defineCommand("github", async () => ({
      stdout: getTerminalData("cmd-github"),
      stderr: "",
      exitCode: 0,
    }));

    // Files from DOM
    const files = {
      "/home/user/README.md": getTerminalData("file-readme"),
      "/home/user/LICENSE": getTerminalData("file-license"),
      "/home/user/package.json": getTerminalData("file-package-json"),
      "/home/user/AGENTS.md": getTerminalData("file-agents-md"),
    };

    const bash = new Bash({
      customCommands: [aboutCmd, installCmd, githubCmd],
      files,
      cwd: "/home/user",
    });

    // Show welcome after fit completes
    requestAnimationFrame(() => {
      fitAddon.fit();

      // ANSI codes: \x1b[0m=reset, \x1b[1m=bold, \x1b[2m=dim, \x1b[36m=cyan
      term.writeln("");

      // Only show ASCII art if terminal is wide enough (43+ chars)
      if (term.cols >= 43) {
        for (const line of ASCII_ART) {
          term.writeln(line);
        }
      } else {
        term.writeln("\x1b[1mjust-bash\x1b[0m");
        term.writeln("=========");
      }
      term.writeln("");

      term.writeln("\x1b[2mA sandboxed bash interpreter for AI agents.\x1b[0m");
      term.writeln("\x1b[2mPure TypeScript with in-memory filesystem.\x1b[0m");
      term.writeln("");
      term.writeln("  \x1b[1m\x1b[36mnpm install just-bash\x1b[0m");
      term.writeln("");
      term.writeln(
        "\x1b[2mCommands:\x1b[0m \x1b[36mabout\x1b[0m, \x1b[36minstall\x1b[0m, \x1b[36mgithub\x1b[0m, \x1b[36mhelp\x1b[0m"
      );
      term.writeln(
        "\x1b[2mTry:\x1b[0m \x1b[36mls\x1b[0m | \x1b[36mhead\x1b[0m, \x1b[36mgrep\x1b[0m bash README.md, \x1b[36mcat\x1b[0m package.json | \x1b[36mjq\x1b[0m .version"
      );
      term.writeln("");
      term.write("$ ");
    });

    // Input handling with history
    let cmd = "";
    const history: string[] = [];
    let historyIndex = -1;

    const clearLine = () => {
      // Move cursor to start of input and clear to end of line
      for (let i = 0; i < cmd.length; i++) {
        term.write("\b \b");
      }
    };

    const setCmd = (newCmd: string) => {
      clearLine();
      cmd = newCmd;
      term.write(cmd);
    };

    // Colorize URLs in output
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
          if (cmd.trim() === "clear") {
            term.clear();
          } else {
            const result = await bash.exec(cmd.trim());
            if (result.stdout)
              term.write(colorizeUrls(result.stdout).replace(/\n/g, "\r\n"));
            if (result.stderr)
              term.write(result.stderr.replace(/\n/g, "\r\n"));
          }
        }
        cmd = "";
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
      } else if (e === "\x7F") {
        if (cmd.length > 0) {
          cmd = cmd.slice(0, -1);
          term.write("\b \b");
        }
      } else if (e >= " " && e <= "~") {
        cmd += e;
        term.write(e);
      }
    });

    // Resize handling
    const onResize = () => requestAnimationFrame(() => fitAddon.fit());
    window.addEventListener("resize", onResize);

    // Focus
    term.focus();
    terminalRef.current?.addEventListener("click", () => term.focus());

    return () => {
      window.removeEventListener("resize", onResize);
      term.dispose();
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100dvh",
        padding: "16px 16px 32px 16px",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div
        ref={terminalRef}
        style={{
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
}

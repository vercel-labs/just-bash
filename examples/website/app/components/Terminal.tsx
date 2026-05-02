"use client";

import { useEffect, useRef } from "react";
import { Bash } from "just-bash/browser";
import { getTerminalData } from "./TerminalData";
import {
  createStaticCommands,
  createAgentCommand,
  createInputHandler,
  showWelcome,
} from "./terminal-parts";
import { LiteTerminal } from "./lite-terminal";

async function fetchFiles(bash: Bash) {
  const response = await fetch("/api/fs");
  const files: Record<string, string> = await response.json();
  for (const [path, content] of Object.entries(files)) {
    bash.writeFile(path, content);
  }
}

function getTheme(isDark: boolean) {
  return {
    background: isDark ? "#000" : "#fff",
    foreground: isDark ? "#e0e0e0" : "#1a1a1a",
    cursor: isDark ? "#fff" : "#000",
    cyan: isDark ? "#0AC5B3" : "#089485",
    brightCyan: isDark ? "#3DD9C8" : "#067A6D",
    brightBlack: isDark ? "#666" : "#525252",
  };
}

// Strip ANSI escape sequences from a URL-supplied string before it
// reaches `term.write` (which would otherwise interpret OSC 8 hyperlinks
// as clickable <a href="javascript:..."> links — see the XSS finding).
// Order matters: OSC ends with BEL (0x07) or ESC \\, so we drop those
// first before the generic ESC catch-all stripper.
function sanitizeAgentQuery(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars
  let cleaned = s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars
  cleaned = cleaned.replace(/\x1b\[[\d;?]*[A-Za-z@~]/g, "");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars
  cleaned = cleaned.replace(/\x1b[@-_]/g, "");
  // Strip remaining C0/C1 control characters (keep \t, \n, \r are
  // already harmless after the OSC strip; but bash and terminal both
  // mishandle them so we drop everything in 0x00–0x1F).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars
  cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, "");
  return cleaned;
}

// Quote a string so that bash treats it as a single argument regardless
// of contents. Single-quote everything; embedded "'" becomes "'\\''".
function bashSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export default function TerminalComponent() {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    const term = new LiteTerminal({
      cursorBlink: true,
      theme: getTheme(isDark),
    });
    term.open(container);

    // Create commands
    const { aboutCmd, installCmd, githubCmd } = createStaticCommands();
    const agentCmd = createAgentCommand(term);

    // Files from DOM
    const files = {
      "/home/user/README.md": getTerminalData("file-readme"),
      "/home/user/LICENSE": getTerminalData("file-license"),
      "/home/user/package.json": getTerminalData("file-package-json"),
      "/home/user/AGENTS.md": getTerminalData("file-agents-md"),
      "/home/user/wtf-is-this.md": getTerminalData("file-wtf-is-this"),
      "/home/user/dirs/are/fun/author/info.txt": "https://x.com/cramforce\n",
    };

    const bash = new Bash({
      customCommands: [aboutCmd, installCmd, githubCmd, agentCmd],
      files,
      cwd: "/home/user",
    });

    // Set up input handling
    const inputHandler = createInputHandler(term, bash);

    // Load additional files from API into bash filesystem
    void fetchFiles(bash);

    // Track cleanup state
    let disposed = false;

    // Show welcome and handle ?agent= query parameter
    requestAnimationFrame(() => {
      if (disposed) return;

      showWelcome(term);

      // Check for ?agent= query parameter
      const params = new URLSearchParams(window.location.search);
      const agentQuery = params.get("agent");

      if (agentQuery) {
        // Clean the URL
        window.history.replaceState({}, "", window.location.pathname);
        // Sanitize the URL-supplied query before it reaches term.write
        // and the bash parser. Without this, embedded ANSI/OSC sequences
        // render as clickable links (OSC 8 hyperlink XSS) and stray
        // double quotes break out of the shell-quoted argument.
        const sanitized = sanitizeAgentQuery(agentQuery);
        // Execute the agent command, single-quoting the argument so the
        // bash parser treats it as a literal string regardless of contents.
        void inputHandler.executeCommand(`agent ${bashSingleQuote(sanitized)}`);
      } else if (inputHandler.history.length === 0) {
        // Pre-populate command if history is empty and no query param
        inputHandler.setInitialCommand('agent "What is just-bash?"');
      }
    });

    // Color scheme change handling
    const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onColorSchemeChange = (e: MediaQueryListEvent) => {
      term.options.theme = getTheme(e.matches);
    };
    colorSchemeQuery.addEventListener("change", onColorSchemeChange);

    // Initial focus
    term.focus();

    return () => {
      disposed = true;
      colorSchemeQuery.removeEventListener("change", onColorSchemeChange);
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={terminalRef}
      style={{
        padding:
          "calc(16px + env(safe-area-inset-top, 0px)) calc(16px + env(safe-area-inset-right, 0px)) 16px calc(16px + env(safe-area-inset-left, 0px))",
        boxSizing: "border-box",
      }}
    />
  );
}

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

async function fetchFiles(
  bash: Bash,
  onFilesLoaded?: (files: Record<string, string>) => void
) {
  const response = await fetch("/api/fs");
  const files: Record<string, string> = await response.json();
  for (const [path, content] of Object.entries(files)) {
    bash.writeFile(path, content);
  }
  onFilesLoaded?.(files);
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

    // Set up input handling with file autocomplete
    const inputHandler = createInputHandler(term, bash, { files });

    // Load additional files from API and add to autocomplete
    void fetchFiles(bash, (apiFiles) => inputHandler.addFiles(apiFiles));

    // Show welcome
    requestAnimationFrame(() => {
      showWelcome(term);

      // Pre-populate command if history is empty
      if (inputHandler.history.length === 0) {
        inputHandler.setInitialCommand('agent "Explain what just-bash is for"');
      }
    });

    // Color scheme change handling
    const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onColorSchemeChange = (e: MediaQueryListEvent) => {
      term.options.theme = getTheme(e.matches);
    };
    colorSchemeQuery.addEventListener("change", onColorSchemeChange);

    // Focus
    term.focus();
    container.addEventListener("click", () => term.focus());

    return () => {
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

"use client";

import { useEffect, useRef } from "react";
import { Bash } from "just-bash/browser";
import "@xterm/xterm/css/xterm.css";
import { getTerminalData } from "./TerminalData";
import {
  createStaticCommands,
  createAgentCommand,
  createInputHandler,
  showWelcome,
} from "./terminal-parts";

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

    // Create commands
    const { aboutCmd, installCmd, githubCmd } = createStaticCommands();
    const agentCmd = createAgentCommand(term);

    // Files from DOM
    const files = {
      "/home/user/README.md": getTerminalData("file-readme"),
      "/home/user/LICENSE": getTerminalData("file-license"),
      "/home/user/package.json": getTerminalData("file-package-json"),
      "/home/user/AGENTS.md": getTerminalData("file-agents-md"),
    };

    const bash = new Bash({
      customCommands: [aboutCmd, installCmd, githubCmd, agentCmd],
      files,
      cwd: "/home/user",
    });

    // Set up input handling
    const inputHandler = createInputHandler(term, bash);

    // Show welcome after fit completes
    requestAnimationFrame(() => {
      fitAddon.fit();
      showWelcome(term);

      // Pre-populate command if history is empty
      if (inputHandler.history.length === 0) {
        inputHandler.setInitialCommand('agent "Explain what just-bash is for"');
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

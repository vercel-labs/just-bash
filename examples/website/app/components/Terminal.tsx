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

    // Multi-turn agent chat state (useChat-style)
    type UIMessage = {
      id: string;
      role: "user" | "assistant";
      parts: Array<{ type: "text"; text: string }>;
    };
    const agentMessages: UIMessage[] = [];
    let messageIdCounter = 0;

    const agentCmd = defineCommand("agent", async (args) => {
      const prompt = args.join(" ");
      if (!prompt) {
        return {
          stdout: "",
          stderr: "Usage: agent <message>\nExample: agent how do I use custom commands?\n\nThis is a multi-turn chat. Use 'agent reset' to clear history.\n",
          exitCode: 1,
        };
      }

      // Handle reset command
      if (prompt.toLowerCase() === "reset") {
        agentMessages.length = 0;
        return {
          stdout: "Agent conversation reset.\n",
          stderr: "",
          exitCode: 0,
        };
      }

      // Add user message to history
      agentMessages.push({
        id: `msg-${++messageIdCounter}`,
        role: "user",
        parts: [{ type: "text", text: prompt }],
      });

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: agentMessages }),
        });

        if (!response.ok) {
          // Remove the user message on error
          agentMessages.pop();
          return {
            stdout: "",
            stderr: `Error: ${response.status}\n`,
            exitCode: 1,
          };
        }

        const reader = response.body?.getReader();
        if (!reader) {
          agentMessages.pop();
          return { stdout: "", stderr: "Error: No response body\n", exitCode: 1 };
        }

        let fullText = "";
        const toolCallsMap = new Map<string, { toolName: string; args: unknown; result?: string }>();
        const decoder = new TextDecoder();
        let buffer = "";

        // Helper to format and display tool result
        const formatToolResult = (tc: { toolName: string; args: unknown; result?: string }) => {
          if (!tc.result) return;
          let displayResult = tc.result;
          try {
            const parsed = JSON.parse(tc.result);
            if (tc.toolName === "bash") {
              if (parsed.stderr && parsed.stderr.trim()) {
                displayResult = `stderr: ${parsed.stderr}`;
              } else if (parsed.stdout !== undefined) {
                displayResult = parsed.stdout;
              }
            } else if (tc.toolName === "readFile") {
              if (parsed.content !== undefined) {
                displayResult = parsed.content;
              }
            }
          } catch {
            // Keep original if not valid JSON
          }

          if (displayResult && displayResult.trim()) {
            const resultLines = displayResult.split("\n").filter((l: string) => l.trim());
            const maxLines = 3;
            const linesToShow = resultLines.slice(0, maxLines);
            for (const line of linesToShow) {
              term.write(`\x1b[2m${line}\x1b[0m\r\n`);
            }
            if (resultLines.length > maxLines) {
              term.write(`\x1b[2m... (${resultLines.length - maxLines} more lines)\x1b[0m\r\n`);
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by double newlines, but we process line by line
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            if (!trimmedLine.startsWith("data:")) continue;

            const jsonStr = trimmedLine.slice(5).trim();
            if (jsonStr === "[DONE]") continue;

            try {
              const data = JSON.parse(jsonStr);

              // Stream text-delta directly to terminal
              if (data.type === "text-delta" && data.delta) {
                fullText += data.delta;
                // Write to terminal, converting newlines for xterm
                term.write(data.delta.replace(/\n/g, "\r\n"));
              }
              // Handle tool input - show header immediately
              else if (data.type === "tool-input-available" && data.toolCallId) {
                // Add line break after text before tool calls
                if (fullText && !fullText.endsWith("\n")) {
                  term.write("\r\n");
                  fullText += "\n";
                }
                const args = data.input as Record<string, unknown>;
                let header = "";
                if (data.toolName === "bash" && args.command) {
                  header = `$ ${args.command}`;
                } else if (data.toolName === "readFile" && args.path) {
                  header = `[readFile] ${args.path}`;
                } else if (data.toolName === "writeFile" && args.path) {
                  header = `[writeFile] ${args.path}`;
                } else {
                  header = `[${data.toolName}]`;
                }
                term.write(`\x1b[36m${header}\x1b[0m\r\n`);

                toolCallsMap.set(data.toolCallId, {
                  toolName: data.toolName,
                  args: data.input,
                });
              }
              // Handle tool output - show result immediately
              else if (data.type === "tool-output-available" && data.toolCallId) {
                const existing = toolCallsMap.get(data.toolCallId);
                const result = data.output;
                const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);

                const tc = {
                  toolName: existing?.toolName || "tool",
                  args: existing?.args || {},
                  result: resultStr,
                };
                formatToolResult(tc);

                if (existing) {
                  existing.result = resultStr;
                } else {
                  toolCallsMap.set(data.toolCallId, tc);
                }
              }
            } catch (e) {
              console.log("Parse error for line:", trimmedLine, e);
            }
          }
        }

        // Ensure we end with a newline
        if (fullText && !fullText.endsWith("\n")) {
          term.write("\r\n");
        }

        // Add assistant message to history (only text parts)
        if (fullText) {
          agentMessages.push({
            id: `msg-${++messageIdCounter}`,
            role: "assistant",
            parts: [{ type: "text", text: fullText }],
          });
        }

        // Return empty since we already wrote to terminal
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
        };
      } catch (error) {
        agentMessages.pop();
        return {
          stdout: "",
          stderr: `Error: ${error instanceof Error ? error.message : "Unknown error"}\n`,
          exitCode: 1,
        };
      }
    });

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
        "\x1b[2mCommands:\x1b[0m \x1b[36mabout\x1b[0m, \x1b[36minstall\x1b[0m, \x1b[36mgithub\x1b[0m, \x1b[36magent\x1b[0m, \x1b[36mhelp\x1b[0m"
      );
      term.writeln(
        "\x1b[2mTry:\x1b[0m \x1b[36mls\x1b[0m | \x1b[36mhead\x1b[0m, \x1b[36mgrep\x1b[0m bash README.md, \x1b[36mcat\x1b[0m package.json | \x1b[36mjq\x1b[0m .version"
      );
      term.writeln("");
      term.write("$ ");

      // Pre-populate command if history is empty
      if (history.length === 0) {
        const initialCmd = 'agent "Explain what just-bash is for"';
        cmd = initialCmd;
        cursorPos = initialCmd.length;
        term.write(initialCmd);
      }
    });

    // Input handling with history (persisted in sessionStorage)
    const HISTORY_KEY = "just-bash-history";
    const history: string[] = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
    let cmd = "";
    let cursorPos = 0;
    let historyIndex = history.length;

    const redrawLine = () => {
      // Move cursor to start, clear line, rewrite, reposition cursor
      term.write("\r$ " + cmd + "\x1b[K"); // \x1b[K clears to end of line
      // Move cursor back to correct position
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
          sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-100))); // Keep last 100
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

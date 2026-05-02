import { defineCommand } from "just-bash/browser";
import { MAX_TOOL_OUTPUT_LINES } from "./constants";
import { formatMarkdown } from "./markdown";

type UIMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
};

type TerminalWriter = {
  write: (data: string) => void;
};

function sanitizeTerminalError(message: string): string {
  return message
    .replace(/\n\s+at\s.*/g, "")
    .replace(/node:internal\/[^\s'",)}\]:]+/g, "<internal>")
    .replace(
      /(?:\/(?:Users|home|private|var|opt|Library|System|usr|etc|tmp|nix|snap))\b[^\s'",)}\]:]*/g,
      "<path>",
    )
    .replace(/[A-Z]:\\[^\s'",)}\]:]+/g, "<path>");
}

// Strip ANSI escape sequences from model-controlled text before it
// reaches `term.write`. Without this, OSC 8 hyperlink sequences emitted
// by the LLM (or echoed from tool output / prompt-injection sources)
// render as <a href="javascript:..."> in the terminal — XSS in this
// origin. Order: drop OSC sequences (terminated by BEL or ESC \\)
// first because they carry payloads with characters that the generic
// CSI matcher would partially eat.
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars
const CSI_RE = /\x1b\[[\d;?]*[A-Za-z@~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars
const ESC_OTHER_RE = /\x1b[@-_]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars
const C0_C1_RE = /[\x00-\x08\x0B-\x1F\x7F]/g;

function stripAnsi(text: string): string {
  return text
    .replace(OSC_RE, "")
    .replace(CSI_RE, "")
    .replace(ESC_OTHER_RE, "")
    .replace(C0_C1_RE, "");
}

// Format text for terminal: normalize newlines and convert tabs to spaces.
// Callers MUST run `stripAnsi` on any model-controlled content first;
// this function intentionally preserves escape sequences so that
// surrounding styling we add ourselves (\x1b[2m ... \x1b[0m) survives.
function formatForTerminal(text: string): string {
  return text.replace(/\t/g, "  ").replace(/\r?\n/g, "\r\n");
}

export function createAgentCommand(term: TerminalWriter) {
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

      let lineBuffer = ""; // Buffer for streaming complete lines
      let fullText = ""; // Track all text for message history
      const toolCallsMap = new Map<string, { toolName: string; args: unknown; result?: string }>();
      const decoder = new TextDecoder();
      let buffer = "";
      let isStreaming = false; // Track if we're streaming thinking

      // "Thinking..." indicator state
      let thinkingTimeout: ReturnType<typeof setTimeout> | null = null;
      let showingThinking = false;

      const showThinking = () => {
        if (!showingThinking) {
          showingThinking = true;
          term.write("\x1b[2mThinking...\x1b[0m");
        }
      };

      const clearThinking = (restart = true) => {
        if (showingThinking) {
          // Clear the "Thinking..." text: move to start of line and clear it
          term.write("\r\x1b[K");
          showingThinking = false;
        }
        if (thinkingTimeout) {
          clearTimeout(thinkingTimeout);
          thinkingTimeout = null;
        }
        // Restart timer for next potential pause
        if (restart) {
          thinkingTimeout = setTimeout(showThinking, 500);
        }
      };

      const resetThinkingTimer = () => {
        if (thinkingTimeout) {
          clearTimeout(thinkingTimeout);
        }
        if (!showingThinking) {
          thinkingTimeout = setTimeout(showThinking, 500);
        }
      };

      // Start the initial thinking timer
      resetThinkingTimer();

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
          // Strip ANSI from each tool-output line BEFORE wrapping it in
          // our `\x1b[2m ... \x1b[0m` styling. Without this, an OSC 8
          // hyperlink embedded in tool output would survive the wrap
          // and render as a clickable link in the terminal — XSS in
          // this origin if the URL scheme is `javascript:`.
          const resultLines = displayResult
            .split("\n")
            .map((l: string) => stripAnsi(l))
            .filter((l: string) => l.trim());
          const linesToShow = resultLines.slice(0, MAX_TOOL_OUTPUT_LINES);
          let output = linesToShow.map((line) => `\x1b[2m${line}\x1b[0m`).join("\n");
          if (resultLines.length > MAX_TOOL_OUTPUT_LINES) {
            output += `\n\x1b[2m... (${resultLines.length - MAX_TOOL_OUTPUT_LINES} more lines)\x1b[0m`;
          }
          term.write(formatForTerminal(output) + "\r\n");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          if (!trimmedLine.startsWith("data:")) continue;

          const jsonStr = trimmedLine.slice(5).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);

            // Stream text line-by-line (complete lines only to preserve ASCII art).
            // stripAnsi the model-emitted delta BEFORE buffering: this
            // removes OSC 8 hyperlinks and other escape sequences that
            // the LLM might emit (or echo from prompt-injection sources)
            // without losing the legitimate styling that `formatMarkdown`
            // adds afterward.
            if (data.type === "text-delta" && data.delta) {
              const safeDelta = stripAnsi(String(data.delta));
              fullText += safeDelta; // Track for message history
              lineBuffer += safeDelta;

              // Check for complete lines to stream
              const lastNewline = lineBuffer.lastIndexOf("\n");
              if (lastNewline !== -1) {
                clearThinking();
                const completeLines = lineBuffer.slice(0, lastNewline + 1);
                lineBuffer = lineBuffer.slice(lastNewline + 1); // Keep partial line
                term.write(formatForTerminal(formatMarkdown(completeLines)));
              } else {
                resetThinkingTimer(); // No complete line yet, reset timer
              }
            }
            // Handle text-end - flush buffer and ensure newline
            else if (data.type === "text-end") {
              clearThinking();
              if (lineBuffer) {
                term.write(formatForTerminal(formatMarkdown(lineBuffer)));
                lineBuffer = "";
              }
              term.write("\r\n");
            }
            // Handle tool input - show header immediately
            else if (data.type === "tool-input-available" && data.toolCallId) {
              clearThinking(); // Clear "Thinking..." before showing tool
              // Add line break after text before tool calls
              if (fullText && !fullText.endsWith("\n")) {
                term.write("\r\n");
                fullText += "\n";
              }
              const args = data.input as Record<string, unknown>;
              // stripAnsi on every model-controlled segment — these come
              // from the LLM's tool-call args and could carry OSC 8
              // sequences via prompt injection.
              const safeToolName = stripAnsi(String(data.toolName));
              if (data.toolName === "bash" && args.command) {
                const cmd = stripAnsi(String(args.command)).replace(/\t/g, "  ");
                const lines = cmd.split("\n");
                // Write each line separately for proper terminal rendering
                term.write(`\x1b[36m$ ${lines[0]}\x1b[0m\r\n`);
                for (let i = 1; i < lines.length; i++) {
                  term.write(`\x1b[36m${lines[i]}\x1b[0m\r\n`);
                }
              } else if (data.toolName === "readFile" && args.path) {
                term.write(
                  `\x1b[36m[readFile] ${stripAnsi(String(args.path))}\x1b[0m\r\n`,
                );
              } else if (data.toolName === "writeFile" && args.path) {
                term.write(
                  `\x1b[36m[writeFile] ${stripAnsi(String(args.path))}\x1b[0m\r\n`,
                );
              } else {
                term.write(`\x1b[36m[${safeToolName}]\x1b[0m\r\n`);
              }

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
                args: existing?.args || Object.create(null),
                result: resultStr,
              };
              formatToolResult(tc);

              if (existing) {
                existing.result = resultStr;
              } else {
                toolCallsMap.set(data.toolCallId, tc);
              }
            }
            // Handle reasoning/thinking tokens - stream in real-time
            else if (data.type === "reasoning-start") {
              clearThinking(); // Clear "Thinking..." before actual reasoning
              // Start streaming thinking in dim italic
              isStreaming = true;
              term.write("\x1b[2m\x1b[3m"); // dim + italic
            }
            else if (data.type === "reasoning-delta" && data.delta) {
              // Stream thinking tokens as they arrive — strip ANSI from
              // the model-emitted delta so embedded OSC 8 hyperlinks
              // can't render as clickable links inside our dim/italic
              // wrapper.
              term.write(formatForTerminal(stripAnsi(String(data.delta))));
              resetThinkingTimer(); // Keep resetting while actively streaming
            }
            else if (data.type === "reasoning-end") {
              // End thinking block
              if (isStreaming) {
                term.write("\x1b[0m\r\n"); // reset styling + newline
                isStreaming = false;
              }
            }
            // Handle errors. Error strings can be model-controlled
            // (e.g. tool execution echoing back attacker content), so
            // stripAnsi before wrapping in our \x1b[31m red styling.
            else if (data.type === "error") {
              const errorMsg = data.error || data.message || "Unknown error";
              term.write(`\x1b[31mError: ${formatForTerminal(stripAnsi(String(errorMsg)))}\x1b[0m\r\n`);
            }
            else if (data.type === "tool-input-error") {
              const errorMsg = data.error || "Tool input error";
              term.write(`\x1b[31m[Tool Error] ${formatForTerminal(stripAnsi(String(errorMsg)))}\x1b[0m\r\n`);
            }
            else if (data.type === "tool-output-error") {
              const errorMsg = data.error || "Tool execution error";
              term.write(`\x1b[31m[Tool Error] ${formatForTerminal(stripAnsi(String(errorMsg)))}\x1b[0m\r\n`);
            }
            else if (data.type === "tool-output-denied") {
              term.write(`\x1b[33m[Tool Denied]\x1b[0m\r\n`);
            }
            else if (data.type === "abort") {
              term.write(`\x1b[33m[Aborted]\x1b[0m\r\n`);
            }
          } catch (e) {
            console.log("Parse error for line:", trimmedLine, e);
          }
        }
      }

      // Clean up thinking timer (don't restart - we're done)
      clearThinking(false);

      // Write any remaining partial line that didn't end with newline
      if (lineBuffer) {
        term.write(formatForTerminal(formatMarkdown(lineBuffer)));
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
      const message = sanitizeTerminalError(
        error instanceof Error ? error.message : "Unknown error",
      );
      agentMessages.pop();
      return {
        stdout: "",
        stderr: `Error: ${message}\n`,
        exitCode: 1,
      };
    }
  });

  return agentCmd;
}

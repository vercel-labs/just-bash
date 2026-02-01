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

// Format text for terminal: normalize newlines and convert tabs to spaces
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

            // Collect text (don't stream - ASCII art breaks when streamed in chunks)
            if (data.type === "text-delta" && data.delta) {
              fullText += data.delta;
            }
            // Handle tool input - show header immediately
            else if (data.type === "tool-input-available" && data.toolCallId) {
              // Add line break after text before tool calls
              if (fullText && !fullText.endsWith("\n")) {
                term.write("\r\n");
                fullText += "\n";
              }
              const args = data.input as Record<string, unknown>;
              if (data.toolName === "bash" && args.command) {
                const cmd = String(args.command).replace(/\t/g, "  ");
                const lines = cmd.split("\n");
                // Write each line separately for proper terminal rendering
                term.write(`\x1b[36m$ ${lines[0]}\x1b[0m\r\n`);
                for (let i = 1; i < lines.length; i++) {
                  term.write(`\x1b[36m${lines[i]}\x1b[0m\r\n`);
                }
              } else if (data.toolName === "readFile" && args.path) {
                term.write(`\x1b[36m[readFile] ${args.path}\x1b[0m\r\n`);
              } else if (data.toolName === "writeFile" && args.path) {
                term.write(`\x1b[36m[writeFile] ${args.path}\x1b[0m\r\n`);
              } else {
                term.write(`\x1b[36m[${data.toolName}]\x1b[0m\r\n`);
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

      // Write collected text at the end (not streamed to avoid ASCII art rendering issues)
      if (fullText) {
        term.write(formatForTerminal(formatMarkdown(fullText)));
        if (!fullText.endsWith("\n")) {
          term.write("\r\n");
        }
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

  return agentCmd;
}

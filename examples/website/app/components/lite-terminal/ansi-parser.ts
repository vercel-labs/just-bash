import type { TextStyle } from "./types";

/**
 * Result of parsing a chunk of text with ANSI escape codes
 */
export interface ParseResult {
  type: "text" | "style" | "cursor" | "clear";
  text?: string;
  style?: Partial<TextStyle>;
  cursor?: { action: "left" | "right" | "home"; count?: number };
  clear?: "line" | "screen" | "scrollback";
}

// SGR (Select Graphic Rendition) parameter handlers
const SGR_HANDLERS: Record<number, (style: TextStyle) => void> = {
  0: (s) => {
    // Reset all attributes
    delete s.bold;
    delete s.dim;
    delete s.italic;
    delete s.underline;
    delete s.color;
  },
  1: (s) => {
    s.bold = true;
  },
  2: (s) => {
    s.dim = true;
  },
  3: (s) => {
    s.italic = true;
  },
  4: (s) => {
    s.underline = true;
  },
  22: (s) => {
    delete s.bold;
    delete s.dim;
  },
  23: (s) => {
    delete s.italic;
  },
  24: (s) => {
    delete s.underline;
  },
  // Standard colors (foreground)
  30: (s) => {
    s.color = "black";
  },
  31: (s) => {
    s.color = "red";
  },
  32: (s) => {
    s.color = "green";
  },
  33: (s) => {
    s.color = "yellow";
  },
  34: (s) => {
    s.color = "blue";
  },
  35: (s) => {
    s.color = "magenta";
  },
  36: (s) => {
    s.color = "cyan";
  },
  37: (s) => {
    s.color = "white";
  },
  39: (s) => {
    delete s.color;
  }, // Default foreground
  // Bright colors
  90: (s) => {
    s.color = "brightBlack";
  },
  91: (s) => {
    s.color = "brightRed";
  },
  92: (s) => {
    s.color = "brightGreen";
  },
  93: (s) => {
    s.color = "brightYellow";
  },
  94: (s) => {
    s.color = "brightBlue";
  },
  95: (s) => {
    s.color = "brightMagenta";
  },
  96: (s) => {
    s.color = "brightCyan";
  },
  97: (s) => {
    s.color = "brightWhite";
  },
};

/**
 * Parse SGR (Select Graphic Rendition) parameters and update style
 */
function parseSGR(params: string, style: TextStyle): Partial<TextStyle> {
  const parts = params ? params.split(";").map(Number) : [0];
  let i = 0;

  while (i < parts.length) {
    const code = parts[i];

    // Handle 24-bit RGB color: 38;2;r;g;b
    if (code === 38 && parts[i + 1] === 2) {
      const r = parts[i + 2] ?? 0;
      const g = parts[i + 3] ?? 0;
      const b = parts[i + 4] ?? 0;
      style.color = `rgb(${r},${g},${b})`;
      i += 5;
      continue;
    }

    // Handle 256-color: 38;5;n (simplified - just use as grayscale hint)
    if (code === 38 && parts[i + 1] === 5) {
      const n = parts[i + 2] ?? 0;
      // Map 256 colors roughly (basic 16 colors + grayscale for simplicity)
      if (n < 16) {
        // Use standard color mapping for basic colors
        const basicColors = [
          "black",
          "red",
          "green",
          "yellow",
          "blue",
          "magenta",
          "cyan",
          "white",
          "brightBlack",
          "brightRed",
          "brightGreen",
          "brightYellow",
          "brightBlue",
          "brightMagenta",
          "brightCyan",
          "brightWhite",
        ];
        style.color = basicColors[n];
      } else if (n >= 232) {
        // Grayscale ramp
        const gray = Math.round(((n - 232) / 23) * 255);
        style.color = `rgb(${gray},${gray},${gray})`;
      } else {
        // 6x6x6 color cube (16-231)
        const n2 = n - 16;
        const r = Math.floor(n2 / 36);
        const g = Math.floor((n2 % 36) / 6);
        const b = n2 % 6;
        style.color = `rgb(${r * 51},${g * 51},${b * 51})`;
      }
      i += 3;
      continue;
    }

    // Standard SGR codes
    const handler = SGR_HANDLERS[code];
    if (handler) {
      handler(style);
    }
    i++;
  }

  return { ...style };
}

/**
 * ANSI escape code parser
 * Parses text containing ANSI escape sequences and yields parse results
 */
export class AnsiParser {
  private currentStyle: TextStyle = {};
  private buffer = "";

  /**
   * Parse text with ANSI escape codes
   * Returns an array of parse results
   */
  parse(text: string): ParseResult[] {
    const results: ParseResult[] = [];
    this.buffer += text;

    let i = 0;
    let textStart = 0;

    while (i < this.buffer.length) {
      // Check for escape sequence
      if (this.buffer[i] === "\x1b") {
        // Emit any text before the escape
        if (i > textStart) {
          results.push({ type: "text", text: this.buffer.slice(textStart, i) });
        }

        // Check if we have enough chars for a complete sequence
        if (i + 1 >= this.buffer.length) {
          // Incomplete escape sequence, keep in buffer
          this.buffer = this.buffer.slice(i);
          return results;
        }

        const nextChar = this.buffer[i + 1];

        // CSI sequence: ESC [
        if (nextChar === "[") {
          // Find the end of the CSI sequence (letter A-Z, a-z, or @)
          let j = i + 2;
          while (
            j < this.buffer.length &&
            !/[A-Za-z@~]/.test(this.buffer[j])
          ) {
            j++;
          }

          if (j >= this.buffer.length) {
            // Incomplete CSI sequence
            this.buffer = this.buffer.slice(i);
            return results;
          }

          const params = this.buffer.slice(i + 2, j);
          const cmd = this.buffer[j];

          const result = this.handleCSI(params, cmd);
          if (result) {
            results.push(result);
          }

          i = j + 1;
          textStart = i;
          continue;
        }

        // OSC sequence: ESC ] (Operating System Command)
        if (nextChar === "]") {
          // Find the end of OSC sequence (BEL \x07 or ST \x1b\\)
          let j = i + 2;
          while (j < this.buffer.length) {
            if (this.buffer[j] === "\x07") {
              break;
            }
            if (this.buffer[j] === "\x1b" && this.buffer[j + 1] === "\\") {
              break;
            }
            j++;
          }

          if (j >= this.buffer.length) {
            // Incomplete OSC sequence
            this.buffer = this.buffer.slice(i);
            return results;
          }

          const oscContent = this.buffer.slice(i + 2, j);
          const result = this.handleOSC(oscContent);
          if (result) {
            results.push(result);
          }

          // Skip past the terminator
          i = this.buffer[j] === "\x07" ? j + 1 : j + 2;
          textStart = i;
          continue;
        }

        // SS3 sequence: ESC O (for Home/End on some terminals)
        if (nextChar === "O") {
          if (i + 2 >= this.buffer.length) {
            this.buffer = this.buffer.slice(i);
            return results;
          }

          const cmd = this.buffer[i + 2];
          if (cmd === "H") {
            results.push({ type: "cursor", cursor: { action: "home" } });
          } else if (cmd === "F") {
            results.push({
              type: "cursor",
              cursor: { action: "right", count: 9999 },
            }); // End
          }

          i += 3;
          textStart = i;
          continue;
        }

        // Single character escape sequences (Alt+key)
        if (nextChar === "b" || nextChar === "f" || nextChar === "d") {
          // Alt+b, Alt+f, Alt+d - skip these as they're input sequences
          i += 2;
          textStart = i;
          continue;
        }

        // Unknown escape sequence, skip the ESC
        i += 1;
        textStart = i;
        continue;
      }

      // Check for carriage return
      if (this.buffer[i] === "\r") {
        // Emit any text before CR
        if (i > textStart) {
          results.push({ type: "text", text: this.buffer.slice(textStart, i) });
        }
        results.push({ type: "cursor", cursor: { action: "home" } });
        i++;
        textStart = i;
        continue;
      }

      i++;
    }

    // Emit any remaining text
    if (i > textStart) {
      results.push({ type: "text", text: this.buffer.slice(textStart, i) });
    }

    this.buffer = "";
    return results;
  }

  /**
   * Handle CSI (Control Sequence Introducer) sequences
   */
  private handleCSI(params: string, cmd: string): ParseResult | null {
    switch (cmd) {
      case "m": // SGR - Select Graphic Rendition
        return {
          type: "style",
          style: parseSGR(params, this.currentStyle),
        };

      case "D": // Cursor left
        return {
          type: "cursor",
          cursor: { action: "left", count: params ? parseInt(params, 10) : 1 },
        };

      case "C": // Cursor right
        return {
          type: "cursor",
          cursor: { action: "right", count: params ? parseInt(params, 10) : 1 },
        };

      case "H": // Cursor home (or position if params)
        if (!params || params === "1;1") {
          return { type: "cursor", cursor: { action: "home" } };
        }
        return null;

      case "K": // Erase in line
        if (!params || params === "0") {
          return { type: "clear", clear: "line" };
        }
        return null;

      case "J": // Erase in display
        if (params === "2") {
          return { type: "clear", clear: "screen" };
        }
        if (params === "3") {
          return { type: "clear", clear: "scrollback" };
        }
        return null;

      case "A": // Cursor up (used for history)
      case "B": // Cursor down
        // These are input sequences, not output
        return null;

      case "~": // Special keys (Delete, etc.)
        return null;

      default:
        return null;
    }
  }

  /**
   * Handle OSC (Operating System Command) sequences
   */
  private handleOSC(content: string): ParseResult | null {
    // OSC 8 - Hyperlinks: 8;;URL or 8;params;URL
    if (content.startsWith("8;")) {
      const parts = content.slice(2).split(";");
      // Format: 8;params;URL - params can be empty
      const url = parts.length > 1 ? parts.slice(1).join(";") : parts[0];

      if (url) {
        // Start hyperlink
        this.currentStyle.link = url;
      } else {
        // End hyperlink (empty URL)
        delete this.currentStyle.link;
      }

      return {
        type: "style",
        style: { ...this.currentStyle },
      };
    }

    return null;
  }

  /**
   * Get the current style state
   */
  getCurrentStyle(): TextStyle {
    return { ...this.currentStyle };
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.currentStyle = {};
    this.buffer = "";
  }
}

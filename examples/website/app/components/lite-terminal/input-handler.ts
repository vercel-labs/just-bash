import type { DataCallback } from "./types";

/**
 * Maps keyboard events to terminal escape sequences
 * Compatible with xterm.js input format
 */
export class InputHandler {
  private callbacks: DataCallback[] = [];
  private element: HTMLElement | null = null;
  private composing = false;

  /**
   * Attach input handling to an element
   */
  attach(element: HTMLElement): void {
    this.element = element;

    element.addEventListener("keydown", this.handleKeyDown);
    element.addEventListener("compositionstart", this.handleCompositionStart);
    element.addEventListener("compositionend", this.handleCompositionEnd);

    // Handle paste
    element.addEventListener("paste", this.handlePaste);
  }

  /**
   * Detach input handling
   */
  detach(): void {
    if (this.element) {
      this.element.removeEventListener("keydown", this.handleKeyDown);
      this.element.removeEventListener(
        "compositionstart",
        this.handleCompositionStart
      );
      this.element.removeEventListener(
        "compositionend",
        this.handleCompositionEnd
      );
      this.element.removeEventListener("paste", this.handlePaste);
      this.element = null;
    }
  }

  /**
   * Register a callback for input data
   */
  onData(callback: DataCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Emit data to all registered callbacks
   */
  private emit(data: string): void {
    for (const cb of this.callbacks) {
      cb(data);
    }
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Skip during IME composition
    if (this.composing) return;

    const key = e.key;
    const ctrl = e.ctrlKey;
    const alt = e.altKey || e.metaKey; // Meta (Cmd on Mac) often acts like Alt
    const shift = e.shiftKey;

    // Prevent default for keys we handle
    let handled = true;
    let data: string | null = null;

    // Control key combinations
    if (ctrl && !alt && !shift) {
      switch (key.toLowerCase()) {
        case "a":
          data = "\x01";
          break; // Ctrl+A - start of line
        case "b":
          data = "\x02";
          break; // Ctrl+B - back one char
        case "c":
          data = "\x03";
          break; // Ctrl+C - interrupt
        case "d":
          data = "\x04";
          break; // Ctrl+D - EOF
        case "e":
          data = "\x05";
          break; // Ctrl+E - end of line
        case "f":
          data = "\x06";
          break; // Ctrl+F - forward one char
        case "h":
          data = "\x08";
          break; // Ctrl+H - backspace
        case "k":
          data = "\x0b";
          break; // Ctrl+K - kill to end of line
        case "l":
          data = "\x0c";
          break; // Ctrl+L - clear screen
        case "n":
          data = "\x0e";
          break; // Ctrl+N - next history
        case "p":
          data = "\x10";
          break; // Ctrl+P - previous history
        case "r":
          data = "\x12";
          break; // Ctrl+R - reverse search
        case "u":
          data = "\x15";
          break; // Ctrl+U - kill line
        case "w":
          data = "\x17";
          break; // Ctrl+W - kill word
        default:
          handled = false;
      }
    }
    // Alt key combinations
    else if (alt && !ctrl) {
      switch (key.toLowerCase()) {
        case "b":
          data = "\x1bb";
          break; // Alt+B - back word
        case "f":
          data = "\x1bf";
          break; // Alt+F - forward word
        case "d":
          data = "\x1bd";
          break; // Alt+D - delete word forward
        case "backspace":
          data = "\x1b\x7f";
          break; // Alt+Backspace - delete word backward
        case "arrowleft":
          data = "\x1b[1;3D";
          break; // Alt+Left - word left
        case "arrowright":
          data = "\x1b[1;3C";
          break; // Alt+Right - word right
        default:
          handled = false;
      }
    }
    // Ctrl+Shift combinations (word movement)
    else if (ctrl && shift) {
      switch (key) {
        case "ArrowLeft":
          data = "\x1b[1;5D";
          break; // Ctrl+Shift+Left
        case "ArrowRight":
          data = "\x1b[1;5C";
          break; // Ctrl+Shift+Right
        default:
          handled = false;
      }
    }
    // Ctrl + Arrow (word movement)
    else if (ctrl && !shift && !alt) {
      switch (key) {
        case "ArrowLeft":
          data = "\x1b[1;5D";
          break; // Ctrl+Left - word left
        case "ArrowRight":
          data = "\x1b[1;5C";
          break; // Ctrl+Right - word right
        default:
          handled = false;
      }
    }
    // Regular keys
    else {
      switch (key) {
        case "Enter":
          data = "\r";
          break;
        case "Backspace":
          data = "\x7f";
          break;
        case "Tab":
          data = "\t";
          break;
        case "Escape":
          data = "\x1b";
          break;
        case "ArrowUp":
          data = "\x1b[A";
          break;
        case "ArrowDown":
          data = "\x1b[B";
          break;
        case "ArrowRight":
          data = "\x1b[C";
          break;
        case "ArrowLeft":
          data = "\x1b[D";
          break;
        case "Home":
          data = "\x1b[H";
          break;
        case "End":
          data = "\x1b[F";
          break;
        case "Delete":
          data = "\x1b[3~";
          break;
        case "PageUp":
          data = "\x1b[5~";
          break;
        case "PageDown":
          data = "\x1b[6~";
          break;
        case "Insert":
          data = "\x1b[2~";
          break;
        default:
          // Printable characters
          if (key.length === 1 && !ctrl && !alt) {
            data = key;
          } else {
            handled = false;
          }
      }
    }

    if (data !== null) {
      e.preventDefault();
      this.emit(data);
    } else if (!handled) {
      // Let the browser handle it (for things like Cmd+C for copy, etc.)
    } else {
      e.preventDefault();
    }
  };

  private handleCompositionStart = (): void => {
    this.composing = true;
  };

  private handleCompositionEnd = (e: CompositionEvent): void => {
    this.composing = false;
    // Emit the composed text
    if (e.data) {
      this.emit(e.data);
    }
  };

  private handlePaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text");
    if (text) {
      // Emit pasted text character by character for proper handling
      this.emit(text);
    }
  };
}

/**
 * Theme configuration matching xterm.js theme structure
 */
export interface ThemeConfig {
  background?: string;
  foreground?: string;
  cursor?: string;
  cyan?: string;
  brightCyan?: string;
  brightBlack?: string;
}

/**
 * Options for creating a LiteTerminal instance
 */
export interface LiteTerminalOptions {
  cursorBlink?: boolean;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  theme?: ThemeConfig;
}

/**
 * Text style attributes for a span of text
 */
export interface TextStyle {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}

/**
 * A styled segment of text
 */
export interface StyledSegment {
  text: string;
  style: TextStyle;
}

/**
 * Callback for data events
 */
export type DataCallback = (data: string) => void;

// Types for sed command implementation

export type SedAddress = number | "$" | { pattern: string };

export interface AddressRange {
  start?: SedAddress;
  end?: SedAddress;
}

export type SedCommandType =
  | "substitute"
  | "print"
  | "delete"
  | "append"
  | "insert"
  | "change"
  | "hold"
  | "holdAppend"
  | "get"
  | "getAppend"
  | "exchange"
  | "next"
  | "nextAppend"
  | "quit"
  | "transliterate"
  | "lineNumber"
  | "branch"
  | "branchOnSubst"
  | "label";

export interface SubstituteCommand {
  type: "substitute";
  address?: AddressRange;
  pattern: string;
  replacement: string;
  global: boolean;
  ignoreCase: boolean;
  printOnMatch: boolean;
}

export interface PrintCommand {
  type: "print";
  address?: AddressRange;
}

export interface DeleteCommand {
  type: "delete";
  address?: AddressRange;
}

export interface AppendCommand {
  type: "append";
  address?: AddressRange;
  text: string;
}

export interface InsertCommand {
  type: "insert";
  address?: AddressRange;
  text: string;
}

export interface ChangeCommand {
  type: "change";
  address?: AddressRange;
  text: string;
}

// Hold space commands
export interface HoldCommand {
  type: "hold"; // h - copy pattern space to hold space
  address?: AddressRange;
}

export interface HoldAppendCommand {
  type: "holdAppend"; // H - append pattern space to hold space
  address?: AddressRange;
}

export interface GetCommand {
  type: "get"; // g - copy hold space to pattern space
  address?: AddressRange;
}

export interface GetAppendCommand {
  type: "getAppend"; // G - append hold space to pattern space
  address?: AddressRange;
}

export interface ExchangeCommand {
  type: "exchange"; // x - exchange pattern and hold spaces
  address?: AddressRange;
}

export interface NextCommand {
  type: "next"; // n - print pattern space, read next line
  address?: AddressRange;
}

export interface QuitCommand {
  type: "quit"; // q - quit
  address?: AddressRange;
}

export interface NextAppendCommand {
  type: "nextAppend"; // N - append next line to pattern space
  address?: AddressRange;
}

export interface TransliterateCommand {
  type: "transliterate"; // y/src/dst/ - transliterate characters
  address?: AddressRange;
  source: string;
  dest: string;
}

export interface LineNumberCommand {
  type: "lineNumber"; // = - print line number
  address?: AddressRange;
}

export interface BranchCommand {
  type: "branch"; // b [label] - branch to label (or end)
  address?: AddressRange;
  label?: string;
}

export interface BranchOnSubstCommand {
  type: "branchOnSubst"; // t [label] - branch if substitution made
  address?: AddressRange;
  label?: string;
}

export interface LabelCommand {
  type: "label"; // :label - define a label
  name: string;
}

export type SedCommand =
  | SubstituteCommand
  | PrintCommand
  | DeleteCommand
  | AppendCommand
  | InsertCommand
  | ChangeCommand
  | HoldCommand
  | HoldAppendCommand
  | GetCommand
  | GetAppendCommand
  | ExchangeCommand
  | NextCommand
  | QuitCommand
  | NextAppendCommand
  | TransliterateCommand
  | LineNumberCommand
  | BranchCommand
  | BranchOnSubstCommand
  | LabelCommand;

export interface SedState {
  patternSpace: string;
  holdSpace: string;
  lineNumber: number;
  totalLines: number;
  deleted: boolean;
  printed: boolean;
  quit: boolean;
  appendBuffer: string[]; // Lines to append after current line
  substitutionMade: boolean; // Track if substitution was made (for 't' command)
  lineNumberOutput: string[]; // Output from '=' command
}

export interface SedExecutionLimits {
  maxIterations: number; // Max branch iterations per line (default: 10000)
}

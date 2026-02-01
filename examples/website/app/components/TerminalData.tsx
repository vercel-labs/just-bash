"use client";

import {
  CMD_ABOUT,
  CMD_INSTALL,
  CMD_GITHUB,
  FILE_README,
  FILE_LICENSE,
  FILE_PACKAGE_JSON,
  FILE_AGENTS_MD,
  FILE_WTF_IS_THIS,
} from "./terminal-content";

// Valid data IDs
export type TerminalDataId =
  | "cmd-about"
  | "cmd-install"
  | "cmd-github"
  | "file-readme"
  | "file-license"
  | "file-package-json"
  | "file-agents-md"
  | "file-wtf-is-this";

// Hidden data element component
function DataElement({ id, children }: { id: TerminalDataId; children: string }) {
  return (
    <pre id={id} style={{ display: "none" }}>
      {children}
    </pre>
  );
}

// Component that renders all terminal data
export function TerminalData() {
  return (
    <>
      {/* Custom command outputs */}
      <DataElement id="cmd-about">{CMD_ABOUT}</DataElement>
      <DataElement id="cmd-install">{CMD_INSTALL}</DataElement>
      <DataElement id="cmd-github">{CMD_GITHUB}</DataElement>

      {/* File contents */}
      <DataElement id="file-readme">{FILE_README}</DataElement>
      <DataElement id="file-license">{FILE_LICENSE}</DataElement>
      <DataElement id="file-package-json">{FILE_PACKAGE_JSON}</DataElement>
      <DataElement id="file-agents-md">{FILE_AGENTS_MD}</DataElement>
      <DataElement id="file-wtf-is-this">{FILE_WTF_IS_THIS}</DataElement>
    </>
  );
}

// Helper to get data from DOM with type safety
export function getTerminalData(id: TerminalDataId): string {
  return document.getElementById(id)?.textContent || "";
}

import { defineCommand } from "just-bash/browser";
import { getTerminalData } from "../TerminalData";

export function createStaticCommands() {
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

  return { aboutCmd, installCmd, githubCmd };
}

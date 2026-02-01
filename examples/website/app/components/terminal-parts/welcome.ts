import { ASCII_ART } from "./constants";

type Terminal = {
  write: (data: string) => void;
  writeln: (data: string) => void;
  cols: number;
};

export function showWelcome(term: Terminal) {
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

  term.writeln("\x1b[2mA sandboxed bash interpreter for AI agents. Pure TypeScript with in-memory filesystem.\x1b[0m");
  term.writeln("");
  term.writeln("  \x1b[1m\x1b[36mnpm install just-bash\x1b[0m");
  term.writeln("");
  term.writeln("\x1b[2m  import { Bash } from 'just-bash';\x1b[0m");
  term.writeln("\x1b[2m  const bash = new Bash();\x1b[0m");
  term.writeln("\x1b[2m  const { stdout } = await bash.exec('echo hello');\x1b[0m");
  term.writeln("");
  term.writeln(
    "\x1b[2mCommands:\x1b[0m \x1b[36mabout\x1b[0m, \x1b[36minstall\x1b[0m, \x1b[36mgithub\x1b[0m, \x1b[36magent\x1b[0m, \x1b[36mhelp\x1b[0m"
  );
  term.writeln(
    "\x1b[2mTry:\x1b[0m \x1b[36mls\x1b[0m | \x1b[36mhead\x1b[0m, \x1b[36mgrep\x1b[0m bash README.md, \x1b[36mtree\x1b[0m, \x1b[36mcat\x1b[0m package.json | \x1b[36mjq\x1b[0m .version"
  );
  term.writeln("");
  term.write("$ ");
}

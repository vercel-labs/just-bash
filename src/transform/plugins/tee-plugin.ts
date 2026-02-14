import type {
  CommandNode,
  PipelineNode,
  RedirectionNode,
  ScriptNode,
  SimpleCommandNode,
  StatementNode,
  WordNode,
} from "../../ast/types.js";
import { serializeWord } from "../serialize.js";
import type {
  TransformContext,
  TransformPlugin,
  TransformResult,
} from "../types.js";

export interface TeePluginOptions {
  outputDir: string;
  targetCommandPattern?: { test(input: string): boolean };
  timestamp?: Date;
}

export interface TeeFileInfo {
  commandIndex: number;
  commandName: string;
  /** The full command string (name + arguments) before tee wrapping */
  command: string;
  stdoutFile: string;
  stderrFile: string;
}

export interface TeePluginMetadata {
  teeFiles: TeeFileInfo[];
}

export class TeePlugin implements TransformPlugin<TeePluginMetadata> {
  readonly name = "tee";
  private options: TeePluginOptions;

  constructor(options: TeePluginOptions) {
    this.options = options;
  }

  transform(context: TransformContext): TransformResult<TeePluginMetadata> {
    const teeFiles: TeeFileInfo[] = [];
    const counter = { value: 0 };
    const timestamp = this.options.timestamp ?? new Date();
    const ast = this.transformScript(context.ast, teeFiles, counter, timestamp);
    return { ast, metadata: { teeFiles } };
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString().replace(/:/g, "-");
  }

  private generateFilenames(
    index: number,
    commandName: string,
    timestamp: Date,
  ): { stdoutFile: string; stderrFile: string } {
    const ts = this.formatTimestamp(timestamp);
    const idx = String(index).padStart(3, "0");
    const dir = this.options.outputDir;
    return {
      stdoutFile: `${dir}/${ts}-${idx}-${commandName}.stdout.txt`,
      stderrFile: `${dir}/${ts}-${idx}-${commandName}.stderr.txt`,
    };
  }

  private transformScript(
    node: ScriptNode,
    teeFiles: TeeFileInfo[],
    counter: { value: number },
    timestamp: Date,
  ): ScriptNode {
    return {
      ...node,
      statements: node.statements.map((s) =>
        this.transformStatement(s, teeFiles, counter, timestamp),
      ),
    };
  }

  private transformStatement(
    node: StatementNode,
    teeFiles: TeeFileInfo[],
    counter: { value: number },
    timestamp: Date,
  ): StatementNode {
    return {
      ...node,
      pipelines: node.pipelines.map((p) =>
        this.transformPipeline(p, teeFiles, counter, timestamp),
      ),
    };
  }

  private transformPipeline(
    node: PipelineNode,
    teeFiles: TeeFileInfo[],
    counter: { value: number },
    timestamp: Date,
  ): PipelineNode {
    const newCommands: CommandNode[] = [];
    const newPipeStderr: boolean[] = [];

    for (let i = 0; i < node.commands.length; i++) {
      const cmd = node.commands[i];
      if (cmd.type !== "SimpleCommand" || !this.shouldTarget(cmd)) {
        newCommands.push(cmd);
        if (i < node.commands.length - 1) {
          newPipeStderr.push(node.pipeStderr?.[i] ?? false);
        }
        continue;
      }

      const commandName = this.getCommandName(cmd.name) ?? "unknown";
      const idx = counter.value++;
      const { stdoutFile, stderrFile } = this.generateFilenames(
        idx,
        commandName,
        timestamp,
      );

      // Add stderr redirection to the command
      const stderrRedir: RedirectionNode = {
        type: "Redirection",
        fd: 2,
        operator: ">",
        target: {
          type: "Word",
          parts: [{ type: "Literal", value: stderrFile }],
        },
      };
      const modifiedCmd: SimpleCommandNode = {
        ...cmd,
        redirections: [...cmd.redirections, stderrRedir],
      };

      // Create tee command for stdout
      const teeCmd = this.makeTeeCommand(stdoutFile);

      const command = this.serializeCommand(cmd);
      teeFiles.push({
        commandIndex: idx,
        commandName,
        command,
        stdoutFile,
        stderrFile,
      });

      newCommands.push(modifiedCmd);
      // Pipe from modified command to tee (not stderr)
      newPipeStderr.push(false);
      newCommands.push(teeCmd);
      // If not the last original command, add pipe from tee to next command
      if (i < node.commands.length - 1) {
        newPipeStderr.push(node.pipeStderr?.[i] ?? false);
      }
    }

    return {
      ...node,
      commands: newCommands,
      pipeStderr: newPipeStderr.length > 0 ? newPipeStderr : undefined,
    };
  }

  private shouldTarget(cmd: SimpleCommandNode): boolean {
    if (!this.options.targetCommandPattern) {
      return true;
    }
    const name = this.getCommandName(cmd.name);
    return name !== null && this.options.targetCommandPattern.test(name);
  }

  private getCommandName(word: WordNode | null): string | null {
    if (!word) return null;
    if (word.parts.length === 1 && word.parts[0].type === "Literal") {
      return word.parts[0].value;
    }
    return null;
  }

  private serializeCommand(cmd: SimpleCommandNode): string {
    const parts: string[] = [];
    if (cmd.name) {
      parts.push(serializeWord(cmd.name));
    }
    for (const arg of cmd.args) {
      parts.push(serializeWord(arg));
    }
    return parts.join(" ");
  }

  private makeTeeCommand(outputFile: string): SimpleCommandNode {
    return {
      type: "SimpleCommand",
      assignments: [],
      name: { type: "Word", parts: [{ type: "Literal", value: "tee" }] },
      args: [
        {
          type: "Word",
          parts: [{ type: "Literal", value: outputFile }],
        },
      ],
      redirections: [],
    };
  }
}

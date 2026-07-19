import type {
  CommandNode,
  PipelineNode,
  ScriptNode,
  SimpleCommandNode,
  StatementNode,
  WordNode,
} from "../../ast/types.js";
import { normalizePath, validatePath } from "../../fs/path-utils.js";
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
}

export interface TeePluginMetadata {
  teeFiles: TeeFileInfo[];
}

export class TeePlugin implements TransformPlugin<TeePluginMetadata> {
  readonly name = "tee";
  private options: TeePluginOptions;
  private counter = 0;

  constructor(options: TeePluginOptions) {
    this.options = options;
  }

  transform(context: TransformContext): TransformResult<TeePluginMetadata> {
    const teeFiles: TeeFileInfo[] = [];
    const timestamp = this.options.timestamp ?? new Date();
    const ast = this.transformScript(context.ast, teeFiles, timestamp);
    return { ast, metadata: { teeFiles } };
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString().replace(/:/g, "-");
  }

  private generateStdoutPath(
    index: number,
    commandName: string,
    timestamp: Date,
  ): string {
    const ts = this.formatTimestamp(timestamp);
    const idx = String(index).padStart(3, "0");
    validatePath(this.options.outputDir, "create tee output");
    if (
      !this.options.outputDir.startsWith("/") ||
      this.options.outputDir.split("/").includes("..")
    ) {
      throw new Error("tee output directory must be an absolute safe path");
    }
    const dir = normalizePath(this.options.outputDir);
    const encodedCommandName = this.encodeCommandName(commandName);
    const candidate = normalizePath(
      `${dir}/${ts}-${idx}-${encodedCommandName}.stdout.txt`,
    );
    if (dir !== "/" && !candidate.startsWith(`${dir}/`)) {
      throw new Error("tee output path escapes configured output directory");
    }
    return candidate;
  }

  private encodeCommandName(commandName: string): string {
    if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(commandName)) {
      return commandName;
    }

    // FNV-1a gives unsafe or very long names a deterministic collision-resistant
    // suffix without importing Node-only crypto into the browser build.
    let hash = 0x811c9dc5;
    for (let i = 0; i < commandName.length; i++) {
      hash ^= commandName.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const slug =
      commandName
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32) || "command";
    return `${slug}-${hash.toString(16).padStart(8, "0")}`;
  }

  private transformScript(
    node: ScriptNode,
    teeFiles: TeeFileInfo[],
    timestamp: Date,
  ): ScriptNode {
    return {
      ...node,
      statements: node.statements.map((s) =>
        this.transformStatement(s, teeFiles, timestamp),
      ),
    };
  }

  private transformStatement(
    node: StatementNode,
    teeFiles: TeeFileInfo[],
    timestamp: Date,
  ): StatementNode {
    const newPipelines: PipelineNode[] = [];
    const newOperators: ("&&" | "||" | ";")[] = [];

    for (let i = 0; i < node.pipelines.length; i++) {
      const pipeline = node.pipelines[i];

      // Preserve original operator connecting this pipeline
      if (i > 0) {
        newOperators.push(node.operators[i - 1]);
      }

      const result = this.transformPipeline(pipeline, teeFiles, timestamp);
      newPipelines.push(result.pipeline);

      if (result.origCmdNewIndices !== null) {
        // The restore builtin receives expansions from one PIPESTATUS
        // snapshot, returns the original pipeline status, and asks the
        // interpreter to publish those statuses without shell temp vars.
        newOperators.push(";");
        newPipelines.push(
          this.makePipestatusRestore(result.origCmdNewIndices, result.negated),
        );
      }
    }

    return {
      ...node,
      pipelines: newPipelines,
      operators: newOperators,
    };
  }

  private transformPipeline(
    node: PipelineNode,
    teeFiles: TeeFileInfo[],
    timestamp: Date,
  ): {
    pipeline: PipelineNode;
    origCmdNewIndices: number[] | null;
    negated: boolean;
  } {
    // Only wrap commands in existing pipelines (2+ commands).
    // Standalone commands are never wrapped — this avoids breaking
    // state-modifying builtins (read, cd, export, eval, etc.) that
    // lose their side effects when moved into a subshell pipeline.
    if (node.commands.length <= 1) {
      return { pipeline: node, origCmdNewIndices: null, negated: false };
    }

    const newCommands: CommandNode[] = [];
    const newPipeStderr: boolean[] = [];
    const origCmdNewIndices: number[] = [];
    let anyWrapped = false;

    for (let i = 0; i < node.commands.length; i++) {
      const cmd = node.commands[i];
      const isLast = i === node.commands.length - 1;

      // Skip non-SimpleCommand, assignment-only, and non-targeted commands
      if (
        cmd.type !== "SimpleCommand" ||
        !cmd.name ||
        !this.shouldTarget(cmd)
      ) {
        origCmdNewIndices.push(newCommands.length);
        newCommands.push(cmd);
        if (!isLast) {
          newPipeStderr.push(node.pipeStderr?.[i] ?? false);
        }
        continue;
      }

      const commandName = this.getCommandName(cmd.name) ?? "unknown";
      const idx = this.counter++;
      const stdoutFile = this.generateStdoutPath(idx, commandName, timestamp);
      const teeCmd = this.makeTeeCommand(stdoutFile);

      const command = this.serializeCommand(cmd);
      teeFiles.push({
        commandIndex: idx,
        commandName,
        command,
        stdoutFile,
      });

      origCmdNewIndices.push(newCommands.length);
      newCommands.push(cmd);
      // cmd→tee: use original outgoing pipe type (preserves |& so tee
      // captures stderr too when the original pipe was |&)
      newPipeStderr.push(node.pipeStderr?.[i] ?? false);
      newCommands.push(teeCmd);
      if (!isLast) {
        // tee→next: always regular pipe (tee produces no stderr)
        newPipeStderr.push(false);
      }
      anyWrapped = true;
    }

    if (!anyWrapped) {
      return { pipeline: node, origCmdNewIndices: null, negated: false };
    }

    return {
      pipeline: {
        ...node,
        negated: false, // strip negation; applied to restore pipeline instead
        commands: newCommands,
        pipeStderr: newPipeStderr.length > 0 ? newPipeStderr : undefined,
      },
      origCmdNewIndices,
      negated: node.negated,
    };
  }

  /**
   * Restore PIPESTATUS and exit code without user-visible variables.
   * Produces: `builtin __just_bash_tee_restore ${PIPESTATUS[i]} ...`
   */
  private makePipestatusRestore(
    indices: number[],
    negated: boolean,
  ): PipelineNode {
    return {
      type: "Pipeline",
      commands: [
        {
          type: "SimpleCommand",
          assignments: [],
          name: {
            type: "Word",
            parts: [{ type: "Literal", value: "builtin" }],
          },
          args: [
            {
              type: "Word",
              parts: [{ type: "Literal", value: "__just_bash_tee_restore" }],
            },
            ...indices.map((index) => ({
              type: "Word" as const,
              parts: [
                {
                  type: "ParameterExpansion" as const,
                  parameter: `PIPESTATUS[${index}]`,
                  operation: null,
                },
              ],
            })),
          ],
          redirections: [],
        },
      ],
      negated,
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

import type { ZodTypeAny, z } from 'zod';

export interface ToolResult {
  summary: string;
  data?: unknown;
}

export interface AgentTool {
  name: string;
  description: string;
  paramsHint: string;
  params: ZodTypeAny;
  kind: 'read' | 'proposal';
  execute(args: z.infer<ZodTypeAny>): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: AgentTool[]) {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(allowlist: string[], allowProposal: boolean): AgentTool[] {
    const allowed = new Set(allowlist);
    return [...this.tools.values()].filter(
      (tool) => allowed.has(tool.name) && (tool.kind !== 'proposal' || allowProposal),
    );
  }
}

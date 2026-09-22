import type { ToolDefinition } from "../../llm/types.js";

export interface ToolExecutionContext {
  tenantId: string;
  traceId: string;
}

export interface AgentTool {
  readonly definition: ToolDefinition;
  execute(context: ToolExecutionContext, args: Record<string, unknown>): Promise<string>;
}

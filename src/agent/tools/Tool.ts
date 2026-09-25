import type { z } from "zod";
import type { ToolDefinition } from "../../llm/types.js";

export interface ToolExecutionContext {
  tenantId: string;
  traceId: string;
}

export interface AgentTool {
  readonly definition: ToolDefinition;
  /** Arguments are validated against this before execute() ever sees them -- the model's output is untrusted input. */
  readonly argsSchema: z.ZodType<Record<string, unknown>>;
  /** True if the tool changes state outside the conversation (bookings, messages, payments). */
  readonly sideEffect: boolean;
  execute(context: ToolExecutionContext, args: Record<string, unknown>): Promise<string>;
}

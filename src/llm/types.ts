export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  name?: string;
  /** Set on an assistant message that requested tool calls, so it can be replayed back to the provider in the next turn. */
  toolCalls?: ToolCall[];
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Opaque provider metadata (e.g. Gemini's thought_signature) that must be echoed back verbatim on replay; other clients ignore it. */
  providerExtra?: unknown;
}

export interface ChatCompletionResult {
  message: ChatMessage;
  toolCalls: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  model: string;
}

export interface LlmClient {
  chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatCompletionResult>;
}

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

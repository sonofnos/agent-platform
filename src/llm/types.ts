export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  name?: string;
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

import { LlmProviderError } from "./OpenAiCompatibleLlmClient.js";
import type { ChatCompletionResult, ChatMessage, LlmClient, ToolDefinition } from "./types.js";

/**
 * Tries each client in order and returns the first success. A provider-side failure
 * (overload, quota, unknown model) moves on to the next model; anything else -- a bug
 * in our own request -- is thrown immediately rather than masked by a fallback.
 * The result's `model` field records which one actually answered, so traces show it.
 */
export class FallbackLlmClient implements LlmClient {
  constructor(private readonly clients: LlmClient[]) {
    if (clients.length === 0) throw new Error("FallbackLlmClient needs at least one client.");
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatCompletionResult> {
    let lastError: unknown;
    for (const client of this.clients) {
      try {
        return await client.chat(messages, tools);
      } catch (err) {
        if (!(err instanceof LlmProviderError)) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }
}

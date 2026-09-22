import { retryWithBackoff } from "../common/retryWithBackoff.js";
import type { ChatCompletionResult, ChatMessage, LlmClient, ToolCall, ToolDefinition } from "./types.js";

/**
 * Talks to any OpenAI-compatible chat completions endpoint: OpenAI itself, Groq,
 * or a LiteLLM proxy fronting whatever provider it's configured with. Pointing this
 * at a LiteLLM proxy is the intended production setup -- it gives model routing and
 * fallback across providers without this client needing to know which one is live.
 */
export class OpenAiCompatibleLlmClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatCompletionResult> {
    const body = await retryWithBackoff(
      () => this.requestChatCompletion(messages, tools),
      (err) => err instanceof TransientLlmError,
    );
    const choice = body.choices[0];
    if (!choice) throw new LlmProviderError("LLM provider returned no choices.");

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
      providerExtra: tc.extra_content,
    }));

    return {
      message: { role: "assistant", content: choice.message.content ?? "" },
      toolCalls,
      usage: {
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
      },
      model: body.model ?? this.model,
    };
  }

  private async requestChatCompletion(messages: ChatMessage[], tools: ToolDefinition[]): Promise<OpenAiChatResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
            ...(m.name ? { name: m.name } : {}),
            ...(m.toolCalls && m.toolCalls.length > 0
              ? {
                  tool_calls: m.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                    ...(tc.providerExtra ? { extra_content: tc.providerExtra } : {}),
                  })),
                }
              : {}),
          })),
          tools: tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }),
      });
    } catch (err) {
      throw new TransientLlmError("The LLM provider could not be reached.");
    }

    if (!response.ok) {
      const responseBody = await response.text();
      if (response.status === 429 || response.status >= 500) {
        throw new TransientLlmError(`LLM provider returned ${response.status}: ${responseBody}`);
      }
      throw new LlmProviderError(`LLM provider returned ${response.status}: ${responseBody}`);
    }

    return (await response.json()) as OpenAiChatResponse;
  }
}

export class LlmProviderError extends Error {}

/** A 429/5xx or network failure -- worth retrying, unlike a real 4xx (bad request, auth, unknown model). */
export class TransientLlmError extends LlmProviderError {}

interface OpenAiChatResponse {
  model?: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string }; extra_content?: unknown }>;
    };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

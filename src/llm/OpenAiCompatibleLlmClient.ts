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
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
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
        })),
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new LlmProviderError(`LLM provider returned ${response.status}: ${body}`);
    }

    const body = (await response.json()) as OpenAiChatResponse;
    const choice = body.choices[0];
    if (!choice) throw new LlmProviderError("LLM provider returned no choices.");

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
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
}

export class LlmProviderError extends Error {}

interface OpenAiChatResponse {
  model?: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

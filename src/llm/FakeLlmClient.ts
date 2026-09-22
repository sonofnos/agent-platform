import type { ChatCompletionResult, ChatMessage, LlmClient, ToolDefinition } from "./types.js";

/**
 * Stands in for a real model in two ways: tests queue exact responses to assert the
 * agent loop handles them correctly, and the default (no LLM_BASE_URL configured)
 * deployment falls back to a small heuristic so the demo still does something
 * sensible without an API key. It is not a real model and never claims to be --
 * every fallback response says so.
 */
export class FakeLlmClient implements LlmClient {
  private queue: ChatCompletionResult[] = [];

  queueResponse(result: ChatCompletionResult): void {
    this.queue.push(result);
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatCompletionResult> {
    const queued = this.queue.shift();
    if (queued) return queued;

    return this.heuristicFallback(messages, tools);
  }

  private heuristicFallback(messages: ChatMessage[], tools: ToolDefinition[]): ChatCompletionResult {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = (lastUser?.content ?? "").toLowerCase();
    const hasTool = (name: string) => tools.some((t) => t.name === name);

    if (hasTool("search_knowledge_base") && !messages.some((m) => m.role === "tool")) {
      return this.toolCallResponse("search_knowledge_base", { query: lastUser?.content ?? "" });
    }

    if (hasTool("check_availability") && /appointment|book|slot|available/.test(text) && !messages.some((m) => m.role === "tool" && m.name === "check_availability")) {
      return this.toolCallResponse("check_availability", {});
    }

    return {
      message: {
        role: "assistant",
        content:
          "[fallback model -- no LLM_BASE_URL configured] Based on the retrieved context above, here is my best answer to your question.",
      },
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0 },
      model: "fake-fallback",
    };
  }

  private toolCallResponse(name: string, args: Record<string, unknown>): ChatCompletionResult {
    return {
      message: { role: "assistant", content: "" },
      toolCalls: [{ id: `fake-${name}-${Date.now()}`, name, arguments: args }],
      usage: { promptTokens: 0, completionTokens: 0 },
      model: "fake-fallback",
    };
  }
}

import { describe, expect, it, vi } from "vitest";
import { FallbackLlmClient } from "../../src/llm/FallbackLlmClient.js";
import { LlmProviderError, TransientLlmError } from "../../src/llm/OpenAiCompatibleLlmClient.js";
import type { ChatCompletionResult, LlmClient } from "../../src/llm/types.js";

function result(model: string): ChatCompletionResult {
  return { message: { role: "assistant", content: "ok" }, toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, model };
}

function clientReturning(model: string): LlmClient {
  return { chat: vi.fn().mockResolvedValue(result(model)) };
}

function clientFailing(err: unknown): LlmClient {
  return { chat: vi.fn().mockRejectedValue(err) };
}

describe("FallbackLlmClient", () => {
  it("uses the primary and never touches the fallback when the primary succeeds", async () => {
    const primary = clientReturning("primary");
    const fallback = clientReturning("fallback");

    const out = await new FallbackLlmClient([primary, fallback]).chat([], []);

    expect(out.model).toBe("primary");
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it("falls back when the primary is overloaded, and the result says which model answered", async () => {
    const out = await new FallbackLlmClient([clientFailing(new TransientLlmError("503")), clientReturning("fallback")]).chat([], []);

    expect(out.model).toBe("fallback");
  });

  it("falls back on a non-transient provider error too, such as a retired model", async () => {
    const out = await new FallbackLlmClient([clientFailing(new LlmProviderError("404 model gone")), clientReturning("fallback")]).chat([], []);

    expect(out.model).toBe("fallback");
  });

  it("throws the last provider error when every model fails", async () => {
    const client = new FallbackLlmClient([clientFailing(new TransientLlmError("first")), clientFailing(new TransientLlmError("second"))]);

    await expect(client.chat([], [])).rejects.toThrow("second");
  });

  it("does not mask a non-provider error (our own bug) behind a fallback", async () => {
    const fallback = clientReturning("fallback");
    const client = new FallbackLlmClient([clientFailing(new TypeError("bad request shape")), fallback]);

    await expect(client.chat([], [])).rejects.toBeInstanceOf(TypeError);
    expect(fallback.chat).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleLlmClient } from "../../src/llm/OpenAiCompatibleLlmClient.js";

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("OpenAiCompatibleLlmClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replays an assistant message's tool_calls, including opaque provider metadata, on the next turn", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse({ model: "test-model", choices: [{ message: { content: "done", tool_calls: [] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    );

    const client = new OpenAiCompatibleLlmClient("https://example.test", "key", "test-model");
    await client.chat(
      [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "search", arguments: { q: "x" }, providerExtra: { google: { thought_signature: "sig-123" } } }],
        },
        { role: "tool", name: "search", toolCallId: "call-1", content: "result" },
      ],
      [],
    );

    const [, requestInit] = fetchSpy.mock.calls[0]!;
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    const assistantMessage = sentBody.messages[1];

    expect(assistantMessage.tool_calls).toHaveLength(1);
    expect(assistantMessage.tool_calls[0].id).toBe("call-1");
    expect(assistantMessage.tool_calls[0].function.name).toBe("search");
    expect(assistantMessage.tool_calls[0].extra_content).toEqual({ google: { thought_signature: "sig-123" } });
  });

  it("captures provider metadata (e.g. Gemini's thought_signature) off a tool call in the response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      fakeResponse({
        model: "test-model",
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-9",
                  function: { name: "search", arguments: '{"q":"x"}' },
                  extra_content: { google: { thought_signature: "sig-abc" } },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );

    const client = new OpenAiCompatibleLlmClient("https://example.test", "key", "test-model");
    const result = await client.chat([{ role: "user", content: "hi" }], []);

    expect(result.toolCalls[0]!.providerExtra).toEqual({ google: { thought_signature: "sig-abc" } });
  });

  it("retries a 503 and succeeds on the next attempt", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeResponse({ error: "overloaded" }, 503))
      .mockResolvedValueOnce(fakeResponse({ model: "test-model", choices: [{ message: { content: "ok", tool_calls: [] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));

    const client = new OpenAiCompatibleLlmClient("https://example.test", "key", "test-model");
    const result = await client.chat([{ role: "user", content: "hi" }], []);

    expect(result.message.content).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry a real 400 error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse({ error: "bad request" }, 400));

    const client = new OpenAiCompatibleLlmClient("https://example.test", "key", "test-model");
    await expect(client.chat([{ role: "user", content: "hi" }], [])).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

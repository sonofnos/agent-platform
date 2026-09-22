import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { errorHandler } from "../../src/http/app.js";
import { LlmProviderError, TransientLlmError } from "../../src/llm/OpenAiCompatibleLlmClient.js";

function fakeResponse() {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

function fakeRequest() {
  return { log: { error: vi.fn() } } as unknown as Request;
}

describe("errorHandler", () => {
  it("maps a transient LLM error to 503, not a raw 500", () => {
    const res = fakeResponse();

    errorHandler(new TransientLlmError("rate limited"), fakeRequest(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it("maps a non-transient LLM provider error to 502", () => {
    const res = fakeResponse();

    errorHandler(new LlmProviderError("bad request to provider"), fakeRequest(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(502);
  });

  it("falls back to a JSON 500 for anything else, never an unhandled HTML page", () => {
    const res = fakeResponse();

    errorHandler(new Error("something unrelated"), fakeRequest(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it("logs the real underlying error so the cause isn't lost once the response is shaped", () => {
    const req = fakeRequest();
    const err = new TransientLlmError("429 quota exceeded");

    errorHandler(err, req, fakeResponse(), vi.fn());

    expect(req.log.error).toHaveBeenCalledWith(expect.objectContaining({ err }), expect.any(String));
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import twilio from "twilio";
import type { Express } from "express";
import type pg from "pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { loadConfig } from "../../src/config/index.js";
import { buildContainer } from "../../src/container.js";
import { buildApp } from "../../src/http/app.js";
import { FakeEmbeddingClient } from "../../src/llm/FakeEmbeddingClient.js";
import { FakeLlmClient } from "../../src/llm/FakeLlmClient.js";
import type { ChatCompletionResult } from "../../src/llm/types.js";
import { forSpeech } from "../../src/voice/twilioRoutes.js";
import { startTestDb } from "./testDb.js";

const AUTH_TOKEN = "test-twilio-auth-token";
const BASE = "https://kaira.example.com";

const reply = (content: string): ChatCompletionResult => ({ message: { role: "assistant", content }, toolCalls: [], usage: { promptTokens: 5, completionTokens: 5 }, model: "m" });

describe("Twilio voice webhooks against a real Postgres", () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let app: Express;
  let llm: FakeLlmClient;

  beforeAll(async () => {
    ({ container, pool } = await startTestDb());
    llm = new FakeLlmClient();
    const config = loadConfig({ TWILIO_AUTH_TOKEN: AUTH_TOKEN, PUBLIC_BASE_URL: BASE, VOICE_NUMBER_TENANTS: "+15550001111=clinic-voice" } as NodeJS.ProcessEnv);
    const services = buildContainer(pool, config, { llm, embeddings: new FakeEmbeddingClient() });
    app = buildApp(pool, config, services);
  });
  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  // Signed exactly as Twilio signs: the full public URL plus the POSTed form fields.
  const post = (path: string, params: Record<string, string>, token = AUTH_TOKEN) =>
    request(app)
      .post(path)
      .type("form")
      .set("x-twilio-signature", twilio.getExpectedTwilioSignature(token, BASE + path, params))
      .send(params);

  it("rejects a request not signed with the account's auth token", async () => {
    const res = await post("/api/voice/twilio/incoming", { CallSid: "CA1", To: "+15550001111" }, "someone-elses-token");
    expect(res.status).toBe(403);
  });

  it("answers an incoming call by listening for speech", async () => {
    const res = await post("/api/voice/twilio/incoming", { CallSid: "CA1", To: "+15550001111" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("<Gather");
    expect(res.text).toContain("/api/voice/twilio/turn?turn=1");
  });

  it("runs the agent on a spoken turn, speaks the reply, and scopes it to the number's tenant", async () => {
    llm.queueResponse(reply("We are open **Monday to Friday**, 8am to 5pm."));

    const res = await post("/api/voice/twilio/turn?turn=1", { CallSid: "CA2", To: "+15550001111", SpeechResult: "When are you open?" });

    expect(res.text).toContain("We are open Monday to Friday, 8am to 5pm.");
    expect(res.text).not.toContain("**");
    expect(res.text).toContain("turn=2");
    const { rows } = await pool.query("SELECT tenant_id, status FROM voice_turns WHERE call_sid = 'CA2'");
    expect(rows).toEqual([{ tenant_id: "clinic-voice", status: "done" }]);
    const trace = await pool.query("SELECT payload FROM agent_traces WHERE tenant_id = 'clinic-voice' AND step_type = 'run_started'");
    expect(trace.rows[0].payload).toEqual({ channel: "voice" });
  });

  it("answers a Twilio retry of the same turn from storage instead of running the agent again", async () => {
    llm.queueResponse(reply("Your appointment is booked."));
    const params = { CallSid: "CA3", To: "+15550001111", SpeechResult: "Book the first slot" };
    await post("/api/voice/twilio/turn?turn=1", params);

    const chat = vi.spyOn(llm, "chat");
    const retry = await post("/api/voice/twilio/turn?turn=1", params);

    expect(retry.text).toContain("Your appointment is booked.");
    expect(chat).not.toHaveBeenCalled();
    chat.mockRestore();
  });

  it("carries earlier turns of the call into the next one", async () => {
    llm.queueResponse(reply("The earliest slot is tomorrow at 9am. Shall I book it?"));
    await post("/api/voice/twilio/turn?turn=1", { CallSid: "CA4", To: "+15550001111", SpeechResult: "What's your earliest slot?" });

    const chat = vi.spyOn(llm, "chat");
    llm.queueResponse(reply("Done."));
    await post("/api/voice/twilio/turn?turn=2", { CallSid: "CA4", To: "+15550001111", SpeechResult: "Yes please" });

    const messages = chat.mock.calls[0]![0];
    expect(messages.map((m) => m.content)).toEqual(
      expect.arrayContaining(["What's your earliest slot?", "The earliest slot is tomorrow at 9am. Shall I book it?", "Yes please"]),
    );
    chat.mockRestore();
  });

  it("reprompts instead of calling the agent when no speech was captured", async () => {
    const chat = vi.spyOn(llm, "chat");
    const res = await post("/api/voice/twilio/turn?turn=1", { CallSid: "CA5", To: "+15550001111", SpeechResult: "" });
    expect(res.text).toContain("didn't catch that");
    expect(chat).not.toHaveBeenCalled();
    chat.mockRestore();
  });

  it("drops a bare ID and keeps the sentence readable", () => {
    expect(forSpeech("Your booking 4b0c1c1e-8a55-4c55-9b1f-0e3f5d3e9a11 is confirmed.")).toBe("Your booking is confirmed.");
  });
});

describe("forSpeech", () => {
  it("strips markdown and UUIDs that text-to-speech would read out", () => {
    expect(forSpeech("Booked **tomorrow** (slot `4b0c1c1e-8a55-4c55-9b1f-0e3f5d3e9a11`).")).toBe("Booked tomorrow.");
  });

  it("drops a bare ID and keeps the sentence readable", () => {
    expect(forSpeech("Your booking 4b0c1c1e-8a55-4c55-9b1f-0e3f5d3e9a11 is confirmed.")).toBe("Your booking is confirmed.");
  });
});

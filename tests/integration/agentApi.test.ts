import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type pg from "pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { loadConfig } from "../../src/config/index.js";
import { buildContainer } from "../../src/container.js";
import { buildApp } from "../../src/http/app.js";
import { FakeEmbeddingClient } from "../../src/llm/FakeEmbeddingClient.js";
import { FakeLlmClient } from "../../src/llm/FakeLlmClient.js";
import { seedDemoData } from "../../src/seed.js";
import { computeSignature } from "../../src/webhooks/signature.js";
import { startTestDb } from "./testDb.js";

describe("agent HTTP API against a real Postgres + pgvector container", () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let app: Express;
  let llm: FakeLlmClient;
  const config = loadConfig({ VOICE_WEBHOOK_SECRET: "test-secret" } as NodeJS.ProcessEnv);

  beforeAll(async () => {
    ({ container, pool } = await startTestDb());
    llm = new FakeLlmClient();
    const services = buildContainer(pool, config, { llm, embeddings: new FakeEmbeddingClient() });
    await seedDemoData(pool, services);
    app = buildApp(pool, config, services);
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("answers a policy question by retrieving the seeded knowledge base", async () => {
    llm.queueResponse({
      message: { role: "assistant", content: "" },
      toolCalls: [{ id: "c1", name: "search_knowledge_base", arguments: { query: "cancellation policy" } }],
      usage: { promptTokens: 12, completionTokens: 4 },
      model: "test-model",
    });
    llm.queueResponse({
      message: { role: "assistant", content: "You can cancel free of charge up to 4 hours before your appointment." },
      toolCalls: [],
      usage: { promptTokens: 30, completionTokens: 10 },
      model: "test-model",
    });

    const response = await request(app)
      .post("/api/agent/chat")
      .set("x-tenant-id", "demo")
      .send({ message: "What is your cancellation policy?" });

    expect(response.status).toBe(200);
    expect(response.body.reply).toContain("4 hours");
    expect(response.body.traceId).toBeTruthy();
  });

  it("records a retrievable trace and billable usage for the run", async () => {
    llm.queueResponse({
      message: { role: "assistant", content: "The clinic opens at 8am." },
      toolCalls: [],
      usage: { promptTokens: 15, completionTokens: 6 },
      model: "test-model",
    });

    const chatResponse = await request(app).post("/api/agent/chat").set("x-tenant-id", "demo").send({ message: "When do you open?" });
    const traceResponse = await request(app).get(`/api/traces/${chatResponse.body.traceId}`).set("x-tenant-id", "demo");
    const usageResponse = await request(app).get("/api/usage").set("x-tenant-id", "demo");

    expect(traceResponse.body.steps.length).toBeGreaterThan(0);
    expect(usageResponse.body.events).toBeGreaterThan(0);
  });

  it("books an appointment end to end through the check-availability and create-appointment tools", async () => {
    const slotsResponse = await pool.query("SELECT id FROM calendar_slots WHERE tenant_id = 'demo' AND is_booked = false LIMIT 1");
    const slotId = slotsResponse.rows[0].id as string;

    llm.queueResponse({
      message: { role: "assistant", content: "" },
      toolCalls: [{ id: "c1", name: "create_appointment", arguments: { slot_id: slotId, patient_ref: "patient-42" } }],
      usage: { promptTokens: 10, completionTokens: 5 },
      model: "test-model",
    });
    llm.queueResponse({
      message: { role: "assistant", content: "You're booked." },
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5 },
      model: "test-model",
    });

    const response = await request(app).post("/api/agent/chat").set("x-tenant-id", "demo").send({ message: "Book me the next slot." });

    expect(response.status).toBe(200);
    const booked = await pool.query("SELECT is_booked FROM calendar_slots WHERE id = $1", [slotId]);
    expect(booked.rows[0].is_booked).toBe(true);
  });

  it("rejects a webhook with an invalid signature", async () => {
    const response = await request(app)
      .post("/api/webhooks/voice")
      .set("x-tenant-id", "demo")
      .set("x-signature", "not-the-right-signature")
      .send({ eventId: "call-1" });

    expect(response.status).toBe(401);
  });

  it("accepts a correctly signed webhook once and treats a replay as already processed", async () => {
    const payload = { eventId: "call-2" };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = computeSignature("test-secret", rawBody);

    const first = await request(app).post("/api/webhooks/voice").set("x-tenant-id", "demo").set("x-signature", signature).send(payload);
    const second = await request(app).post("/api/webhooks/voice").set("x-tenant-id", "demo").set("x-signature", signature).send(payload);

    expect(first.status).toBe(200);
    expect(first.body.status).toBe("accepted");
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("already processed");
  });
});

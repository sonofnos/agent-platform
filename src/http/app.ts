import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { pinoHttp } from "pino-http";
import type pg from "pg";
import type { Config } from "../config/index.js";
import type { Container } from "../container.js";
import { BudgetExceededError } from "../agent/TenantPolicy.js";
import { LlmProviderError, TransientLlmError } from "../llm/OpenAiCompatibleLlmClient.js";
import { getTrace } from "../tracing/Tracer.js";
import { verifySignature } from "../webhooks/signature.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildApp(pool: pg.Pool, config: Config, container: Container): Express {
  const app = express();
  app.use(pinoHttp());
  app.use(express.static(join(__dirname, "..", "..", "public")));
  app.use(express.json({ verify: (req, _res, buf) => ((req as { rawBody?: Buffer }).rawBody = buf) }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.post("/api/agent/chat", async (req, res) => {
    const tenantId = String(req.header("x-tenant-id") ?? "demo");
    const message = String(req.body?.message ?? "");
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const result = await container.agentService.run(tenantId, message);
    res.json({ traceId: result.traceId, reply: result.reply, costUsd: result.costUsd });
  });

  app.get("/api/traces/:traceId", async (req, res) => {
    const tenantId = String(req.header("x-tenant-id") ?? "demo");
    const steps = await getTrace(pool, tenantId, req.params.traceId!);
    res.json({ traceId: req.params.traceId, steps });
  });

  app.get("/api/usage", async (req, res) => {
    const tenantId = String(req.header("x-tenant-id") ?? "demo");
    const summary = await container.usageTracker.summarizeForTenant(tenantId);
    res.json(summary);
  });

  app.post("/api/webhooks/voice", async (req, res) => {
    const tenantId = String(req.header("x-tenant-id") ?? "demo");
    const rawBody = (req as unknown as { rawBody: Buffer }).rawBody;
    const check = verifySignature(config.voiceWebhookSecret, rawBody, req.header("x-timestamp"), req.header("x-signature"));
    if (!check.ok) {
      res.status(401).json({ error: check.reason === "stale" ? "timestamp outside the replay window" : "invalid signature" });
      return;
    }

    const eventId = String(req.body?.eventId ?? "");
    if (!eventId) {
      res.status(400).json({ error: "eventId is required" });
      return;
    }

    const isNew = await container.webhookEvents.tryRecord(tenantId, eventId);
    if (!isNew) {
      res.status(200).json({ status: "already processed" });
      return;
    }

    // A real integration would hand the call transcript to the agent here. This demo
    // just proves the idempotent-ingestion path with a real database constraint behind it.
    res.status(200).json({ status: "accepted", eventId });
  });

  app.use(errorHandler);

  return app;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // pino-http only logs a generic "5xx happened" note once an error-handling
  // middleware exists to catch it -- the real cause (which provider, which quota)
  // has to be logged explicitly here or it's lost.
  req.log.error({ err }, "request failed");

  if (err instanceof BudgetExceededError) {
    res.status(429).json({ error: "This organisation has reached its monthly AI budget.", spentUsd: err.spentUsd, budgetUsd: err.budgetUsd });
    return;
  }
  if (err instanceof TransientLlmError) {
    res.status(503).json({ error: "The LLM provider is temporarily unavailable or rate-limited. Please try again shortly." });
    return;
  }
  if (err instanceof LlmProviderError) {
    res.status(502).json({ error: "The LLM provider returned an unexpected error." });
    return;
  }

  res.status(500).json({ error: "Internal server error." });
}

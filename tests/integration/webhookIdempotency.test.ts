import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { WebhookEventStore } from "../../src/webhooks/WebhookEventStore.js";
import { startTestDb } from "./testDb.js";

describe("WebhookEventStore against real Postgres", () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let store: WebhookEventStore;

  beforeAll(async () => {
    ({ container, pool } = await startTestDb());
    store = new WebhookEventStore(pool);
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("accepts an event the first time and rejects a replay", async () => {
    const first = await store.tryRecord("demo", "evt-1");
    const second = await store.tryRecord("demo", "evt-1");

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("resolves a genuine race between two concurrent deliveries to exactly one winner", async () => {
    const results = await Promise.all([store.tryRecord("demo", "evt-race"), store.tryRecord("demo", "evt-race")]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("scopes event ids independently per tenant only where the schema allows -- documents current global uniqueness", async () => {
    const first = await store.tryRecord("tenant-a", "evt-shared");
    const second = await store.tryRecord("tenant-b", "evt-shared");

    // event_id is globally unique in this schema (a voice provider's event ids are
    // globally unique too), so a second tenant reusing the same id is rejected --
    // this is intentional, not a leak, since providers never reuse ids across tenants.
    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { BudgetExceededError, TenantPolicy } from "../../src/agent/TenantPolicy.js";
import { startTestDb } from "./testDb.js";

describe("TenantPolicy against real Postgres", () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let policy: TenantPolicy;

  beforeAll(async () => {
    ({ container, pool } = await startTestDb());
    policy = new TenantPolicy(pool, 1.0);
  });
  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  const spend = (tenant: string, usd: number, when = "now()") =>
    pool.query(`INSERT INTO usage_events (tenant_id, trace_id, model, prompt_tokens, completion_tokens, cost_usd, created_at) VALUES ($1, gen_random_uuid(), 'm', 1, 1, $2, ${when})`, [tenant, usd]);

  it("uses platform defaults when a tenant has no settings row", async () => {
    expect(await policy.controlsFor("fresh")).toEqual({ monthlyBudgetUsd: 1.0, allowedTools: null });
  });

  it("applies a tenant's own budget and tool allow-list", async () => {
    await pool.query("INSERT INTO tenant_settings (tenant_id, monthly_budget_usd, allowed_tools) VALUES ('clinic-a', 0.25, ARRAY['search_knowledge_base'])");
    const controls = await policy.controlsFor("clinic-a");
    expect(controls.monthlyBudgetUsd).toBe(0.25);
    expect([...controls.allowedTools!]).toEqual(["search_knowledge_base"]);
  });

  it("counts only this month's spend, and only this tenant's", async () => {
    await spend("clinic-b", 0.4);
    await spend("clinic-b", 5, "now() - interval '40 days'");
    await spend("someone-else", 9);
    expect(await policy.monthToDateSpendUsd("clinic-b")).toBeCloseTo(0.4);
  });

  it("blocks a tenant at or over budget and lets one under it through", async () => {
    await spend("clinic-c", 1.0);
    await expect(policy.assertWithinBudget("clinic-c", await policy.controlsFor("clinic-c"))).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(policy.assertWithinBudget("clinic-d", await policy.controlsFor("clinic-d"))).resolves.toBeUndefined();
  });

  it("treats a budget of zero as AI switched off for that tenant", async () => {
    await pool.query("INSERT INTO tenant_settings (tenant_id, monthly_budget_usd) VALUES ('clinic-off', 0)");
    await expect(policy.assertWithinBudget("clinic-off", await policy.controlsFor("clinic-off"))).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

import type pg from "pg";

/** $ per 1M tokens, (prompt, completion). Update to match whatever the configured model actually bills. */
const PRICING: Record<string, { prompt: number; completion: number }> = {
  "fake-fallback": { prompt: 0, completion: 0 },
  default: { prompt: 0.5, completion: 1.5 },
};

export class UsageTracker {
  constructor(private readonly pool: pg.Pool) {}

  async record(tenantId: string, traceId: string, model: string, promptTokens: number, completionTokens: number): Promise<number> {
    const pricing = PRICING[model] ?? PRICING.default!;
    const costUsd = (promptTokens / 1_000_000) * pricing.prompt + (completionTokens / 1_000_000) * pricing.completion;

    await this.pool.query(
      "INSERT INTO usage_events (tenant_id, trace_id, model, prompt_tokens, completion_tokens, cost_usd) VALUES ($1, $2, $3, $4, $5, $6)",
      [tenantId, traceId, model, promptTokens, completionTokens, costUsd],
    );

    return costUsd;
  }

  async summarizeForTenant(tenantId: string): Promise<{ totalCostUsd: number; totalPromptTokens: number; totalCompletionTokens: number; events: number }> {
    const result = await this.pool.query<{ total_cost: string; total_prompt: string; total_completion: string; events: string }>(
      `SELECT
         COALESCE(SUM(cost_usd), 0) AS total_cost,
         COALESCE(SUM(prompt_tokens), 0) AS total_prompt,
         COALESCE(SUM(completion_tokens), 0) AS total_completion,
         COUNT(*) AS events
       FROM usage_events WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = result.rows[0]!;
    return {
      totalCostUsd: Number(row.total_cost),
      totalPromptTokens: Number(row.total_prompt),
      totalCompletionTokens: Number(row.total_completion),
      events: Number(row.events),
    };
  }
}

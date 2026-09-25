import type pg from "pg";

export interface TenantControls {
  monthlyBudgetUsd: number;
  allowedTools: Set<string> | null;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly tenantId: string,
    readonly spentUsd: number,
    readonly budgetUsd: number,
  ) {
    super(`Tenant ${tenantId} has used $${spentUsd.toFixed(4)} of its $${budgetUsd.toFixed(4)} monthly AI budget.`);
  }
}

export class TenantPolicy {
  constructor(
    private readonly pool: pg.Pool,
    private readonly defaultMonthlyBudgetUsd: number,
  ) {}

  async controlsFor(tenantId: string): Promise<TenantControls> {
    const { rows } = await this.pool.query<{ monthly_budget_usd: string | null; allowed_tools: string[] | null }>(
      "SELECT monthly_budget_usd, allowed_tools FROM tenant_settings WHERE tenant_id = $1",
      [tenantId],
    );
    const row = rows[0];
    return {
      monthlyBudgetUsd: row?.monthly_budget_usd != null ? Number(row.monthly_budget_usd) : this.defaultMonthlyBudgetUsd,
      allowedTools: row?.allowed_tools ? new Set(row.allowed_tools) : null,
    };
  }

  async monthToDateSpendUsd(tenantId: string): Promise<number> {
    const { rows } = await this.pool.query<{ spent: string }>(
      "SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM usage_events WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())",
      [tenantId],
    );
    return Number(rows[0]!.spent);
  }

  /** Throws before any model call if the tenant is already at or over budget; a run in progress is allowed to finish. */
  async assertWithinBudget(tenantId: string, controls: TenantControls): Promise<void> {
    const spent = await this.monthToDateSpendUsd(tenantId);
    if (spent >= controls.monthlyBudgetUsd) throw new BudgetExceededError(tenantId, spent, controls.monthlyBudgetUsd);
  }
}

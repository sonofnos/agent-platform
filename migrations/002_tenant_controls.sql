-- Per-tenant controls. A missing row means platform defaults (config), so a new
-- tenant is governed from its first request without anyone having to create settings.
CREATE TABLE tenant_settings (
    tenant_id TEXT PRIMARY KEY,
    -- NULL: use the platform default budget. 0: AI disabled for this tenant.
    monthly_budget_usd NUMERIC(12, 4),
    -- NULL: every registered tool. Otherwise only these tool names are offered to or executed for the model.
    allowed_tools TEXT[],
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_tenant_created ON usage_events (tenant_id, created_at);

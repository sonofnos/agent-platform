import type pg from "pg";

export class Tracer {
  private stepIndex = 0;

  constructor(
    private readonly pool: pg.Pool,
    private readonly tenantId: string,
    public readonly traceId: string,
  ) {}

  async record(stepType: string, payload: unknown): Promise<void> {
    await this.pool.query(
      "INSERT INTO agent_traces (tenant_id, trace_id, step_index, step_type, payload) VALUES ($1, $2, $3, $4, $5)",
      [this.tenantId, this.traceId, this.stepIndex++, stepType, JSON.stringify(payload)],
    );
  }
}

export interface TraceStep {
  stepIndex: number;
  stepType: string;
  payload: unknown;
  createdAt: Date;
}

export async function getTrace(pool: pg.Pool, tenantId: string, traceId: string): Promise<TraceStep[]> {
  const result = await pool.query<{ step_index: number; step_type: string; payload: unknown; created_at: Date }>(
    "SELECT step_index, step_type, payload, created_at FROM agent_traces WHERE tenant_id = $1 AND trace_id = $2 ORDER BY step_index",
    [tenantId, traceId],
  );
  return result.rows.map((r) => ({ stepIndex: r.step_index, stepType: r.step_type, payload: r.payload, createdAt: r.created_at }));
}

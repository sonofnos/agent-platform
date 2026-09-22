import type pg from "pg";

const UNIQUE_VIOLATION = "23505";

export class WebhookEventStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Returns true the first time an eventId is seen; a unique DB constraint makes replays and races both resolve to false. */
  async tryRecord(tenantId: string, eventId: string): Promise<boolean> {
    try {
      await this.pool.query("INSERT INTO webhook_events (event_id, tenant_id) VALUES ($1, $2)", [eventId, tenantId]);
      return true;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === UNIQUE_VIOLATION;
}

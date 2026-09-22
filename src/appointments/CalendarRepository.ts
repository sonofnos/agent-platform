import type pg from "pg";

export interface Slot {
  id: string;
  slotStart: Date;
  isBooked: boolean;
}

export class CalendarRepository {
  constructor(private readonly pool: pg.Pool) {}

  async seedSlots(tenantId: string, slots: Date[]): Promise<void> {
    for (const slotStart of slots) {
      await this.pool.query(
        "INSERT INTO calendar_slots (tenant_id, slot_start) VALUES ($1, $2) ON CONFLICT (tenant_id, slot_start) DO NOTHING",
        [tenantId, slotStart],
      );
    }
  }

  async listAvailable(tenantId: string, limit = 5): Promise<Slot[]> {
    const result = await this.pool.query<{ id: string; slot_start: Date; is_booked: boolean }>(
      "SELECT id, slot_start, is_booked FROM calendar_slots WHERE tenant_id = $1 AND is_booked = false AND slot_start > now() ORDER BY slot_start LIMIT $2",
      [tenantId, limit],
    );
    return result.rows.map((r) => ({ id: r.id, slotStart: r.slot_start, isBooked: r.is_booked }));
  }

  async findById(tenantId: string, slotId: string): Promise<Slot | null> {
    const result = await this.pool.query<{ id: string; slot_start: Date; is_booked: boolean }>(
      "SELECT id, slot_start, is_booked FROM calendar_slots WHERE tenant_id = $1 AND id = $2",
      [tenantId, slotId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, slotStart: row.slot_start, isBooked: row.is_booked } : null;
  }

  async markBooked(tenantId: string, slotId: string): Promise<void> {
    await this.pool.query("UPDATE calendar_slots SET is_booked = true WHERE tenant_id = $1 AND id = $2", [tenantId, slotId]);
  }
}

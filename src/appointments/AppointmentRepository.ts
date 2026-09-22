import type pg from "pg";

export interface Appointment {
  id: string;
  slotId: string;
  patientRef: string;
  status: string;
}

export class AppointmentRepository {
  constructor(private readonly pool: pg.Pool) {}

  /** Idempotent on (tenantId, idempotencyKey): a retried request returns the original booking, never a second one. */
  async createIdempotent(tenantId: string, patientRef: string, slotId: string, idempotencyKey: string): Promise<Appointment> {
    const existing = await this.pool.query<{ id: string; slot_id: string; patient_ref: string; status: string }>(
      "SELECT id, slot_id, patient_ref, status FROM appointments WHERE tenant_id = $1 AND idempotency_key = $2",
      [tenantId, idempotencyKey],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      return { id: row.id, slotId: row.slot_id, patientRef: row.patient_ref, status: row.status };
    }

    const inserted = await this.pool.query<{ id: string; slot_id: string; patient_ref: string; status: string }>(
      `INSERT INTO appointments (tenant_id, patient_ref, slot_id, idempotency_key)
       VALUES ($1, $2, $3, $4)
       RETURNING id, slot_id, patient_ref, status`,
      [tenantId, patientRef, slotId, idempotencyKey],
    );
    const row = inserted.rows[0]!;
    return { id: row.id, slotId: row.slot_id, patientRef: row.patient_ref, status: row.status };
  }
}

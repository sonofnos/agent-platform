import type pg from "pg";
import { ingestDocument } from "./rag/ingest.js";
import type { Container } from "./container.js";

const DEMO_TENANT = "demo";

const SYNTHETIC_DOCS: Array<{ source: string; content: string }> = [
  {
    source: "clinic-hours-policy",
    content:
      "The clinic is open Monday to Friday, 8am to 5pm, and Saturday 9am to 1pm. It is closed on public holidays.\n\n" +
      "Walk-ins are accepted but patients with a booked appointment are seen first. Please arrive 10 minutes early to check in.",
  },
  {
    source: "cancellation-policy",
    content:
      "Appointments can be cancelled or rescheduled free of charge up to 4 hours before the appointment time.\n\n" +
      "Cancellations within 4 hours, or missed appointments without notice, may be subject to a missed-appointment fee at the clinic's discretion.",
  },
  {
    source: "new-patient-faq",
    content:
      "New patients should arrive 15 minutes early to complete registration. Please bring a valid photo ID and your insurance card if you have one.\n\n" +
      "This is a demo knowledge base with synthetic data only -- no real patient or clinical information is stored here.",
  },
];

export async function seedDemoData(pool: pg.Pool, container: Container): Promise<void> {
  const existing = await pool.query("SELECT 1 FROM documents WHERE tenant_id = $1 LIMIT 1", [DEMO_TENANT]);
  if ((existing.rowCount ?? 0) > 0) return;

  for (const doc of SYNTHETIC_DOCS) {
    await ingestDocument(container.knowledgeBase, container.embeddings, DEMO_TENANT, doc.source, doc.content);
  }

  const now = Date.now();
  const slots = Array.from({ length: 8 }, (_, i) => new Date(now + (i + 1) * 24 * 60 * 60 * 1000));
  await container.calendar.seedSlots(DEMO_TENANT, slots);
}

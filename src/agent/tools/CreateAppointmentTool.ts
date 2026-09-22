import type { AppointmentRepository } from "../../appointments/AppointmentRepository.js";
import type { CalendarRepository } from "../../appointments/CalendarRepository.js";
import type { AgentTool, ToolExecutionContext } from "./Tool.js";

export class CreateAppointmentTool implements AgentTool {
  readonly definition = {
    name: "create_appointment",
    description: "Book an appointment for a patient in a specific slot returned by check_availability.",
    parameters: {
      type: "object" as const,
      properties: {
        slot_id: { type: "string", description: "The slot_id from check_availability." },
        patient_ref: { type: "string", description: "An opaque patient reference, never a real name or medical detail." },
      },
      required: ["slot_id", "patient_ref"],
    },
  };

  constructor(
    private readonly calendar: CalendarRepository,
    private readonly appointments: AppointmentRepository,
  ) {}

  async execute(context: ToolExecutionContext, args: Record<string, unknown>): Promise<string> {
    const slotId = String(args.slot_id ?? "");
    const patientRef = String(args.patient_ref ?? "");

    const slot = await this.calendar.findById(context.tenantId, slotId);
    if (!slot) return `No such slot: ${slotId}.`;
    if (slot.isBooked) return `Slot ${slotId} is already booked. Call check_availability again.`;

    // Idempotency key is derived from the trace, not supplied by the model: if the
    // agent loop retries this step within the same run, it must not double-book.
    const idempotencyKey = `${context.traceId}:${slotId}`;
    const appointment = await this.appointments.createIdempotent(context.tenantId, patientRef, slotId, idempotencyKey);
    await this.calendar.markBooked(context.tenantId, slotId);

    return `Booked appointment ${appointment.id} for slot ${slotId}.`;
  }
}

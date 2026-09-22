import type { CalendarRepository } from "../../appointments/CalendarRepository.js";
import type { AgentTool, ToolExecutionContext } from "./Tool.js";

export class CheckAvailabilityTool implements AgentTool {
  readonly definition = {
    name: "check_availability",
    description: "List the next available appointment slots for the clinic.",
    parameters: { type: "object" as const, properties: {} },
  };

  constructor(private readonly calendar: CalendarRepository) {}

  async execute(context: ToolExecutionContext): Promise<string> {
    const slots = await this.calendar.listAvailable(context.tenantId, 5);
    if (slots.length === 0) return "No appointment slots are currently available.";

    return slots.map((s) => `slot_id=${s.id} start=${s.slotStart.toISOString()}`).join("\n");
  }
}

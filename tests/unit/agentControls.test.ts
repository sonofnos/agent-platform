import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentService } from "../../src/agent/AgentService.js";
import { PromptStore } from "../../src/agent/PromptStore.js";
import { BudgetExceededError, type TenantPolicy } from "../../src/agent/TenantPolicy.js";
import type { AgentTool, ToolExecutionContext } from "../../src/agent/tools/Tool.js";
import { FakeLlmClient } from "../../src/llm/FakeLlmClient.js";
import type { ChatCompletionResult } from "../../src/llm/types.js";
import { UsageTracker } from "../../src/usage/UsageTracker.js";
import { FakePool } from "./FakePool.js";

class RecordingTool implements AgentTool {
  calls: Record<string, unknown>[] = [];
  constructor(
    readonly definition: AgentTool["definition"],
    readonly argsSchema: z.ZodType<Record<string, unknown>>,
    readonly sideEffect: boolean,
  ) {}
  async execute(_ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> {
    this.calls.push(args);
    return "done";
  }
}

const bookTool = () =>
  new RecordingTool(
    { name: "create_appointment", description: "book", parameters: { type: "object", properties: {} } },
    z.object({ slot_id: z.uuid(), patient_ref: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }),
    true,
  );

function toolCall(name: string, args: Record<string, unknown>): ChatCompletionResult {
  return { message: { role: "assistant", content: "" }, toolCalls: [{ id: "c1", name, arguments: args }], usage: { promptTokens: 1, completionTokens: 1 }, model: "m" };
}
const done: ChatCompletionResult = { message: { role: "assistant", content: "ok" }, toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, model: "m" };

function policy(controls: { monthlyBudgetUsd?: number; allowedTools?: string[] | null; overBudget?: boolean }) {
  return {
    controlsFor: async () => ({ monthlyBudgetUsd: controls.monthlyBudgetUsd ?? 5, allowedTools: controls.allowedTools ? new Set(controls.allowedTools) : null }),
    assertWithinBudget: async (tenantId: string) => {
      if (controls.overBudget) throw new BudgetExceededError(tenantId, 5.2, 5);
    },
  } as unknown as TenantPolicy;
}

function service(pool: FakePool, llm: FakeLlmClient, tools: AgentTool[], p: TenantPolicy) {
  return new AgentService(pool.asPgPool(), llm, tools, new PromptStore(pool.asPgPool()), new UsageTracker(pool.asPgPool()), p);
}

const stepsRecorded = (pool: FakePool) => pool.queries.filter((q) => q.text.includes("agent_traces")).map((q) => String(q.params[3]));

describe("agent controls", () => {
  it("does not offer a tool the tenant has not enabled, and refuses it if the model calls it anyway", async () => {
    const pool = new FakePool();
    const llm = new FakeLlmClient();
    const chatSpy = vi.spyOn(llm, "chat");
    const tool = bookTool();
    llm.queueResponse(toolCall("create_appointment", { slot_id: "4b0c1c1e-8a55-4c55-9b1f-0e3f5d3e9a11", patient_ref: "p-1" }));
    llm.queueResponse(done);

    await service(pool, llm, [tool], policy({ allowedTools: ["search_knowledge_base"] })).run("t1", "book me in");

    expect(chatSpy.mock.calls[0]![1].map((d) => d.name)).not.toContain("create_appointment");
    expect(tool.calls).toHaveLength(0);
    expect(stepsRecorded(pool)).toContain("tool_denied");
  });

  it("rejects arguments that fail the tool's schema without executing it", async () => {
    const pool = new FakePool();
    const llm = new FakeLlmClient();
    const tool = bookTool();
    // A real name with a space is exactly what the opaque-reference rule exists to stop.
    llm.queueResponse(toolCall("create_appointment", { slot_id: "not-a-uuid", patient_ref: "Jane Doe" }));
    llm.queueResponse(done);

    const result = await service(pool, llm, [tool], policy({})).run("t1", "book Jane Doe in");

    expect(tool.calls).toHaveLength(0);
    expect(stepsRecorded(pool)).toContain("tool_args_rejected");
    expect(result.reply).toBe("ok");
  });

  it("executes a permitted tool with validated arguments", async () => {
    const pool = new FakePool();
    const llm = new FakeLlmClient();
    const tool = bookTool();
    llm.queueResponse(toolCall("create_appointment", { slot_id: "4b0c1c1e-8a55-4c55-9b1f-0e3f5d3e9a11", patient_ref: "p-1" }));
    llm.queueResponse(done);

    await service(pool, llm, [tool], policy({ allowedTools: ["create_appointment"] })).run("t1", "book me in");

    expect(tool.calls).toEqual([{ slot_id: "4b0c1c1e-8a55-4c55-9b1f-0e3f5d3e9a11", patient_ref: "p-1" }]);
  });

  it("stops an over-budget tenant before any model call and records why", async () => {
    const pool = new FakePool();
    const llm = new FakeLlmClient();
    const chatSpy = vi.spyOn(llm, "chat");

    await expect(service(pool, llm, [], policy({ overBudget: true })).run("t1", "hi")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(chatSpy).not.toHaveBeenCalled();
    expect(stepsRecorded(pool)).toContain("budget_blocked");
  });
});

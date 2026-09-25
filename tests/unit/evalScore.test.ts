import { describe, expect, it } from "vitest";
import { scoreCase, type EvalCase } from "../../src/evals/score.js";

const base: EvalCase = { id: "c", tenant: "t", message: "m", intent: "i", expect: {} };

describe("scoreCase", () => {
  it("passes when every expectation holds", () => {
    const c = { ...base, expect: { calls: ["search_knowledge_base"], neverCalls: ["create_appointment"], replyIncludesAny: ["4 hours"], replyExcludes: ["free"] } };
    expect(scoreCase(c, { reply: "Cancel up to 4 hours before.", toolsCalled: ["search_knowledge_base"] })).toEqual({ pass: true, failures: [] });
  });

  it("fails and names each broken expectation", () => {
    const c = { ...base, expect: { calls: ["search_knowledge_base"], neverCalls: ["create_appointment"], replyExcludes: ["free"] } };
    const s = scoreCase(c, { reply: "All appointments are FREE.", toolsCalled: ["create_appointment"] });
    expect(s.pass).toBe(false);
    expect(s.failures).toEqual(["expected a call to search_knowledge_base", "must not call create_appointment", 'reply must not contain "free"']);
  });

  it("accepts any one of several acceptable phrasings", () => {
    const c = { ...base, expect: { replyIncludesAny: ["8am", "8 am", "eight"] } };
    expect(scoreCase(c, { reply: "We open at 8 AM.", toolsCalled: [] }).pass).toBe(true);
  });
});

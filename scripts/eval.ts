/**
 * AI regression suite. Runs every case in evals/cases.json against a running
 * instance (EVAL_BASE_URL, default http://localhost:8080) with the real model,
 * reads each run's trace to see which tools were actually called, scores it,
 * and writes a report stamped with the prompt version and models used.
 *
 *   EVAL_BASE_URL=https://kaira.sonofnos.com npm run eval
 *
 * Exits non-zero when the pass rate drops below EVAL_MIN_PASS_RATE (default 1.0),
 * so a prompt or model change that regresses behaviour can fail a pipeline.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreCase, type EvalCase } from "../src/evals/score.js";

const base = (process.env.EVAL_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const minPassRate = Number(process.env.EVAL_MIN_PASS_RATE ?? 1);
const delayMs = Number(process.env.EVAL_DELAY_MS ?? 2000);
const cases: EvalCase[] = JSON.parse(readFileSync(join("evals", "cases.json"), "utf-8"));

interface TraceStep { stepType: string; payload: Record<string, unknown> }

async function runCase(c: EvalCase) {
  const res = await fetch(`${base}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tenant-id": c.tenant },
    body: JSON.stringify({ message: c.message }),
  });
  const body = (await res.json()) as { traceId?: string; reply?: string; costUsd?: number; error?: string };
  if (!res.ok || !body.traceId) return { id: c.id, intent: c.intent, pass: false, failures: [`HTTP ${res.status}: ${body.error ?? "no trace"}`], reply: "", toolsCalled: [] as string[] };

  const trace = (await (await fetch(`${base}/api/traces/${body.traceId}`, { headers: { "x-tenant-id": c.tenant } })).json()) as { steps: TraceStep[] };
  const toolsCalled = trace.steps.filter((s) => s.stepType === "tool_call").map((s) => String(s.payload.name));
  const promptVersion = trace.steps.find((s) => s.stepType === "prompt_selected")?.payload.version;
  const models = [...new Set(trace.steps.filter((s) => s.stepType === "llm_response").map((s) => String(s.payload.model)))];
  const score = scoreCase(c, { reply: body.reply ?? "", toolsCalled });
  return { id: c.id, intent: c.intent, ...score, reply: body.reply ?? "", toolsCalled, traceId: body.traceId, costUsd: body.costUsd, promptVersion, models };
}

const results = [];
for (const c of cases) {
  const r = await runCase(c);
  results.push(r);
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${c.id}${r.pass ? "" : `  -> ${r.failures.join("; ")}`}`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const passed = results.filter((r) => r.pass).length;
const passRate = passed / results.length;
const report = {
  ranAt: new Date().toISOString(),
  baseUrl: base,
  promptVersions: [...new Set(results.map((r) => ("promptVersion" in r ? r.promptVersion : undefined)).filter((v) => v !== undefined))],
  models: [...new Set(results.flatMap((r) => ("models" in r ? r.models : [])))],
  passed,
  total: results.length,
  passRate,
  totalCostUsd: results.reduce((sum, r) => sum + ("costUsd" in r ? Number(r.costUsd ?? 0) : 0), 0),
  results,
};
mkdirSync(join("evals", "results"), { recursive: true });
const file = join("evals", "results", `${report.ranAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`\n${passed}/${results.length} passed (${(passRate * 100).toFixed(0)}%) · models: ${report.models.join(", ")} · $${report.totalCostUsd.toFixed(5)} · ${file}`);
process.exit(passRate >= minPassRate ? 0 : 1);

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
const delayMs = Number(process.env.EVAL_DELAY_MS ?? 5000);
// A 429/503 from the provider says nothing about the agent's behaviour, so it is
// retried and, if it persists, reported as an error rather than a failed case.
const providerRetries = Number(process.env.EVAL_PROVIDER_RETRIES ?? 2);
const providerBackoffMs = Number(process.env.EVAL_PROVIDER_BACKOFF_MS ?? 20000);
const cases: EvalCase[] = JSON.parse(readFileSync(join("evals", "cases.json"), "utf-8"));

interface TraceStep { stepType: string; payload: Record<string, unknown> }

async function runCase(c: EvalCase) {
  let res: Response | undefined;
  let body: { traceId?: string; reply?: string; costUsd?: number; error?: string } = {};
  for (let attempt = 0; attempt <= providerRetries; attempt++) {
    res = await fetch(`${base}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": c.tenant },
      body: JSON.stringify({ message: c.message }),
    });
    body = (await res.json()) as typeof body;
    if (res.status !== 503 && res.status !== 429) break;
    if (attempt < providerRetries) await new Promise((resolve) => setTimeout(resolve, providerBackoffMs));
  }
  if (!res!.ok || !body.traceId) {
    const providerError = res!.status === 503 || res!.status === 429;
    return { id: c.id, intent: c.intent, pass: false, error: providerError, failures: [`HTTP ${res!.status}: ${body.error ?? "no trace"}`], reply: "", toolsCalled: [] as string[] };
  }

  const trace = (await (await fetch(`${base}/api/traces/${body.traceId}`, { headers: { "x-tenant-id": c.tenant } })).json()) as { steps: TraceStep[] };
  const toolsCalled = trace.steps.filter((s) => s.stepType === "tool_call").map((s) => String(s.payload.name));
  const promptVersion = trace.steps.find((s) => s.stepType === "prompt_selected")?.payload.version;
  const models = [...new Set(trace.steps.filter((s) => s.stepType === "llm_response").map((s) => String(s.payload.model)))];
  const score = scoreCase(c, { reply: body.reply ?? "", toolsCalled });
  return { id: c.id, intent: c.intent, ...score, reply: body.reply ?? "", toolsCalled, traceId: body.traceId, costUsd: body.costUsd, promptVersion, models };
}

const results = [];
for (const c of cases) {
  const trials = Math.max(1, c.trials ?? 1);
  const runs = [];
  for (let t = 0; t < trials; t++) {
    runs.push(await runCase(c));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const failed = runs.filter((r) => !r.pass);
  // Report the first failing trial (or the last run) with how many trials held.
  const r = { ...(failed[0] ?? runs[runs.length - 1]!), pass: failed.length === 0, trialsPassed: runs.length - failed.length, trials };
  results.push(r);
  const label = trials > 1 ? ` (${r.trialsPassed}/${trials} trials)` : "";
  const status = r.pass ? "PASS" : "error" in r && r.error ? "ERROR" : "FAIL";
  console.log(`${status}  ${c.id}${label}${r.pass ? "" : `  -> ${r.failures.join("; ")}`}`);
}

const passed = results.filter((r) => r.pass).length;
const errored = results.filter((r) => "error" in r && r.error).length;
// Pass rate is over cases that actually ran; provider errors are reported, not scored.
const passRate = results.length - errored > 0 ? passed / (results.length - errored) : 0;
const report = {
  ranAt: new Date().toISOString(),
  baseUrl: base,
  promptVersions: [...new Set(results.map((r) => ("promptVersion" in r ? r.promptVersion : undefined)).filter((v) => v !== undefined))],
  models: [...new Set(results.flatMap((r) => ("models" in r ? r.models : [])))],
  passed,
  providerErrors: errored,
  total: results.length,
  passRate,
  totalCostUsd: results.reduce((sum, r) => sum + ("costUsd" in r ? Number(r.costUsd ?? 0) : 0), 0),
  results,
};
mkdirSync(join("evals", "results"), { recursive: true });
const file = join("evals", "results", `${report.ranAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`\n${passed}/${results.length - errored} passed (${(passRate * 100).toFixed(0)}%)${errored ? ` · ${errored} provider error(s), not scored` : ""} · models: ${report.models.join(", ")} · $${report.totalCostUsd.toFixed(5)} · ${file}`);
// Provider errors still fail the run: an unscored case is not a pass.
process.exit(passRate >= minPassRate && errored === 0 ? 0 : 1);

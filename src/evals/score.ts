export interface EvalCase {
  id: string;
  tenant: string;
  message: string;
  /** What the case is checking, shown in reports. */
  intent: string;
  /** Runs for behaviour that varies between runs; the case passes only if every trial does. Default 1. */
  trials?: number;
  expect: {
    /** Tools the agent must call at least once. */
    calls?: string[];
    /** Tools the agent must never call (successfully or not). */
    neverCalls?: string[];
    /** At least one of these must appear in the reply (case-insensitive). */
    replyIncludesAny?: string[];
    /** None of these may appear in the reply (case-insensitive). */
    replyExcludes?: string[];
  };
}

export interface EvalObservation {
  reply: string;
  toolsCalled: string[];
}

export interface EvalScore {
  pass: boolean;
  failures: string[];
}

export function scoreCase(c: EvalCase, o: EvalObservation): EvalScore {
  const failures: string[] = [];
  const reply = o.reply.toLowerCase();

  for (const tool of c.expect.calls ?? []) {
    if (!o.toolsCalled.includes(tool)) failures.push(`expected a call to ${tool}`);
  }
  for (const tool of c.expect.neverCalls ?? []) {
    if (o.toolsCalled.includes(tool)) failures.push(`must not call ${tool}`);
  }
  const includesAny = c.expect.replyIncludesAny ?? [];
  if (includesAny.length > 0 && !includesAny.some((s) => reply.includes(s.toLowerCase()))) {
    failures.push(`reply should mention one of: ${includesAny.join(", ")}`);
  }
  for (const s of c.expect.replyExcludes ?? []) {
    if (reply.includes(s.toLowerCase())) failures.push(`reply must not contain "${s}"`);
  }
  return { pass: failures.length === 0, failures };
}

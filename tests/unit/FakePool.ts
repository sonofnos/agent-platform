import type pg from "pg";

/** Records every query instead of touching a real database -- enough for tests that only care about the agent loop's decisions, not persistence. */
export class FakePool {
  public queries: Array<{ text: string; params: unknown[] }> = [];

  async query(text: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    this.queries.push({ text, params });

    if (text.includes("FROM prompts")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  }

  asPgPool(): pg.Pool {
    return this as unknown as pg.Pool;
  }
}

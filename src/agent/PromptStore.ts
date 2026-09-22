import type pg from "pg";

export class PromptStore {
  constructor(private readonly pool: pg.Pool) {}

  async save(name: string, version: number, template: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO prompts (name, version, template) VALUES ($1, $2, $3) ON CONFLICT (name, version) DO NOTHING",
      [name, version, template],
    );
  }

  /** The latest version by number -- prompts are append-only, never edited in place, so a version already served can't change under a caller. */
  async getLatest(name: string): Promise<{ version: number; template: string } | null> {
    const result = await this.pool.query<{ version: number; template: string }>(
      "SELECT version, template FROM prompts WHERE name = $1 ORDER BY version DESC LIMIT 1",
      [name],
    );
    return result.rows[0] ?? null;
  }
}

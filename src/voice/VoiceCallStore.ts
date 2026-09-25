import type pg from "pg";
import type { ChatMessage } from "../llm/types.js";

export type TurnClaim = { kind: "claimed" } | { kind: "done"; reply: string } | { kind: "in_progress" };

export class VoiceCallStore {
  constructor(private readonly pool: pg.Pool) {}

  /** First delivery of a turn claims it; a retry sees either the finished reply or that it's still running. */
  async claim(callSid: string, turn: number, tenantId: string, userText: string): Promise<TurnClaim> {
    const inserted = await this.pool.query(
      "INSERT INTO voice_turns (call_sid, turn, tenant_id, user_text) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [callSid, turn, tenantId, userText],
    );
    if (inserted.rowCount === 1) return { kind: "claimed" };

    const { rows } = await this.pool.query<{ status: string; reply: string | null }>(
      "SELECT status, reply FROM voice_turns WHERE call_sid = $1 AND turn = $2",
      [callSid, turn],
    );
    return rows[0]?.status === "done" ? { kind: "done", reply: rows[0].reply ?? "" } : { kind: "in_progress" };
  }

  async complete(callSid: string, turn: number, reply: string, traceId: string | null): Promise<void> {
    await this.pool.query("UPDATE voice_turns SET reply = $3, trace_id = $4, status = 'done' WHERE call_sid = $1 AND turn = $2", [callSid, turn, reply, traceId]);
  }

  /** Lets Twilio's retry re-run a turn that failed, instead of it being stuck as pending. */
  async release(callSid: string, turn: number): Promise<void> {
    await this.pool.query("DELETE FROM voice_turns WHERE call_sid = $1 AND turn = $2 AND status = 'pending'", [callSid, turn]);
  }

  /** Earlier finished turns of this call, so the agent can resolve "yes, that one" against what it said before. */
  async history(callSid: string, beforeTurn: number, tenantId: string): Promise<ChatMessage[]> {
    const { rows } = await this.pool.query<{ user_text: string; reply: string }>(
      "SELECT user_text, reply FROM voice_turns WHERE call_sid = $1 AND tenant_id = $2 AND turn < $3 AND status = 'done' ORDER BY turn",
      [callSid, tenantId, beforeTurn],
    );
    return rows.flatMap((r): ChatMessage[] => [
      { role: "user", content: r.user_text },
      { role: "assistant", content: r.reply },
    ]);
  }
}

-- One row per spoken turn in a phone call. (call_sid, turn) is the idempotency key:
-- Twilio retries a webhook that times out, and a retried turn must return the
-- answer already given rather than run the agent (and any booking) a second time.
CREATE TABLE voice_turns (
    call_sid TEXT NOT NULL,
    turn INT NOT NULL,
    tenant_id TEXT NOT NULL,
    user_text TEXT NOT NULL,
    reply TEXT,
    trace_id UUID,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (call_sid, turn)
);
CREATE INDEX idx_voice_turns_tenant ON voice_turns (tenant_id);

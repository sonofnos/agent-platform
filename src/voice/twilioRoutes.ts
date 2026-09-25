import express, { type Request, type Response, type Router } from "express";
import twilio from "twilio";
import type { AgentService } from "../agent/AgentService.js";
import { BudgetExceededError } from "../agent/TenantPolicy.js";
import type { VoiceCallStore } from "./VoiceCallStore.js";

const { VoiceResponse } = twilio.twiml;

export interface TwilioVoiceDeps {
  agent: AgentService;
  calls: VoiceCallStore;
  authToken: string | null;
  /** The public origin Twilio calls (e.g. https://kaira.sonofnos.com). Behind a proxy, the Host header can't be trusted to rebuild it. */
  publicBaseUrl: string | null;
  tenantForNumber: (dialedNumber: string) => string;
  /** How long a retried turn waits for the original delivery to finish before asking Twilio to try again. */
  waitForTurnMs?: number;
}

const GREETING = "Hi, you've reached the clinic's assistant. How can I help?";

export function twilioVoiceRouter(deps: TwilioVoiceDeps): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));

  router.use((req, res, next) => {
    if (!deps.authToken || !deps.publicBaseUrl) {
      res.status(503).json({ error: "voice is not configured" });
      return;
    }
    const url = deps.publicBaseUrl + req.originalUrl;
    if (!twilio.validateRequest(deps.authToken, req.header("x-twilio-signature") ?? "", url, req.body ?? {})) {
      res.status(403).json({ error: "invalid Twilio signature" });
      return;
    }
    next();
  });

  router.post("/incoming", (_req, res) => sendTwiml(res, speak(GREETING, 1)));

  router.post("/turn", async (req: Request, res: Response) => {
    const turn = Number(req.query.turn);
    const callSid = String(req.body.CallSid ?? "");
    const speech = String(req.body.SpeechResult ?? "").trim();
    const tenantId = deps.tenantForNumber(String(req.body.To ?? ""));
    if (!Number.isInteger(turn) || turn < 1 || !callSid) {
      res.status(400).json({ error: "turn and CallSid are required" });
      return;
    }
    if (!speech) {
      sendTwiml(res, speak("Sorry, I didn't catch that. Could you say it again?", turn));
      return;
    }

    let claim = await deps.calls.claim(callSid, turn, tenantId, speech);
    const deadline = Date.now() + (deps.waitForTurnMs ?? 10_000);
    while (claim.kind === "in_progress" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      claim = await deps.calls.claim(callSid, turn, tenantId, speech);
    }

    if (claim.kind === "done") {
      sendTwiml(res, speak(claim.reply, turn + 1));
      return;
    }
    if (claim.kind === "in_progress") {
      const r = new VoiceResponse();
      r.say("One moment.");
      r.redirect({ method: "POST" }, req.originalUrl);
      sendTwiml(res, r);
      return;
    }

    try {
      const history = await deps.calls.history(callSid, turn, tenantId);
      const result = await deps.agent.run(tenantId, speech, { channel: "voice", history });
      const reply = forSpeech(result.reply);
      await deps.calls.complete(callSid, turn, reply, result.traceId);
      sendTwiml(res, speak(reply, turn + 1));
    } catch (err) {
      req.log.error({ err, callSid, turn }, "voice turn failed");
      await deps.calls.release(callSid, turn);
      const message =
        err instanceof BudgetExceededError
          ? "Sorry, the assistant isn't available for this clinic right now. Please call back during office hours."
          : "Sorry, I'm having trouble right now. Could you say that again?";
      sendTwiml(res, speak(message, turn));
    }
  });

  return router;
}

function speak(text: string, nextTurn: number) {
  const r = new VoiceResponse();
  const gather = r.gather({ input: ["speech"], action: `/api/voice/twilio/turn?turn=${nextTurn}`, method: "POST", speechTimeout: "auto" });
  gather.say(text);
  r.say("Thanks for calling. Goodbye.");
  r.hangup();
  return r;
}

function sendTwiml(res: Response, twiml: InstanceType<typeof VoiceResponse>) {
  res.type("text/xml").send(twiml.toString());
}

/** Markdown and long IDs are fine on screen and terrible read aloud by text-to-speech. */
export function forSpeech(text: string): string {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return text
    .replace(/[*_`#>]+/g, "")
    .replace(new RegExp(`\\s*\\([^()]*${uuid}[^()]*\\)`, "gi"), "")
    .replace(new RegExp(uuid, "gi"), "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim()
    .slice(0, 600);
}

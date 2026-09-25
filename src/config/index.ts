export interface Config {
  port: number;
  databaseUrl: string;
  llm: {
    baseUrl: string | null;
    apiKey: string | null;
    chatModel: string;
    fallbackChatModels: string[];
    embeddingModel: string;
    embeddingDimensions: number;
  };
  voiceWebhookSecret: string;
  defaultMonthlyBudgetUsd: number;
  voice: {
    twilioAuthToken: string | null;
    publicBaseUrl: string | null;
    numberTenants: Map<string, string>;
    defaultTenant: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: Number(env.PORT ?? 8080),
    databaseUrl:
      env.DATABASE_URL ?? "postgres://agent_platform:agent_platform@localhost:5442/agent_platform",
    llm: {
      baseUrl: env.LLM_BASE_URL ?? null,
      apiKey: env.LLM_API_KEY ?? null,
      chatModel: env.LLM_CHAT_MODEL ?? "gpt-4o-mini",
      fallbackChatModels: (env.LLM_FALLBACK_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean),
      embeddingModel: env.LLM_EMBEDDING_MODEL ?? "text-embedding-3-small",
      embeddingDimensions: Number(env.LLM_EMBEDDING_DIMENSIONS ?? 768),
    },
    voiceWebhookSecret: env.VOICE_WEBHOOK_SECRET ?? "dev-webhook-secret",
    defaultMonthlyBudgetUsd: Number(env.DEFAULT_TENANT_MONTHLY_BUDGET_USD ?? 5),
    voice: {
      twilioAuthToken: env.TWILIO_AUTH_TOKEN ?? null,
      publicBaseUrl: env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? null,
      // "+15551234567=clinic-a,+15557654321=clinic-b": which tenant a dialed number belongs to.
      numberTenants: new Map(
        (env.VOICE_NUMBER_TENANTS ?? "")
          .split(",")
          .map((pair) => pair.split("=").map((x) => x.trim()))
          .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]),
      ),
      defaultTenant: env.VOICE_DEFAULT_TENANT ?? "demo",
    },
  };
}

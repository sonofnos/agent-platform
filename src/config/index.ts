export interface Config {
  port: number;
  databaseUrl: string;
  llm: {
    baseUrl: string | null;
    apiKey: string | null;
    chatModel: string;
    embeddingModel: string;
    embeddingDimensions: number;
  };
  voiceWebhookSecret: string;
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
      embeddingModel: env.LLM_EMBEDDING_MODEL ?? "text-embedding-3-small",
      embeddingDimensions: Number(env.LLM_EMBEDDING_DIMENSIONS ?? 768),
    },
    voiceWebhookSecret: env.VOICE_WEBHOOK_SECRET ?? "dev-webhook-secret",
  };
}

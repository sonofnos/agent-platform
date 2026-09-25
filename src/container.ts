import type pg from "pg";
import { AgentService } from "./agent/AgentService.js";
import { PromptStore } from "./agent/PromptStore.js";
import { TenantPolicy } from "./agent/TenantPolicy.js";
import { CheckAvailabilityTool } from "./agent/tools/CheckAvailabilityTool.js";
import { CreateAppointmentTool } from "./agent/tools/CreateAppointmentTool.js";
import { SearchKnowledgeBaseTool } from "./agent/tools/SearchKnowledgeBaseTool.js";
import type { AgentTool } from "./agent/tools/Tool.js";
import { AppointmentRepository } from "./appointments/AppointmentRepository.js";
import { CalendarRepository } from "./appointments/CalendarRepository.js";
import type { Config } from "./config/index.js";
import { FakeEmbeddingClient } from "./llm/FakeEmbeddingClient.js";
import { FakeLlmClient } from "./llm/FakeLlmClient.js";
import { FallbackLlmClient } from "./llm/FallbackLlmClient.js";
import { OpenAiCompatibleEmbeddingClient } from "./llm/OpenAiCompatibleEmbeddingClient.js";
import { OpenAiCompatibleLlmClient } from "./llm/OpenAiCompatibleLlmClient.js";
import type { EmbeddingClient, LlmClient } from "./llm/types.js";
import { KnowledgeBaseRepository } from "./rag/KnowledgeBaseRepository.js";
import { UsageTracker } from "./usage/UsageTracker.js";
import { WebhookEventStore } from "./webhooks/WebhookEventStore.js";

export interface Container {
  llm: LlmClient;
  embeddings: EmbeddingClient;
  knowledgeBase: KnowledgeBaseRepository;
  calendar: CalendarRepository;
  appointments: AppointmentRepository;
  usageTracker: UsageTracker;
  webhookEvents: WebhookEventStore;
  agentService: AgentService;
  policy: TenantPolicy;
}

export function buildContainer(pool: pg.Pool, config: Config, overrides?: Partial<Pick<Container, "llm" | "embeddings">>): Container {
  const llm: LlmClient = overrides?.llm ?? buildChatClient(config);

  const embeddings: EmbeddingClient =
    overrides?.embeddings ?? (config.llm.baseUrl && config.llm.apiKey
      ? new OpenAiCompatibleEmbeddingClient(config.llm.baseUrl, config.llm.apiKey, config.llm.embeddingModel, config.llm.embeddingDimensions)
      : new FakeEmbeddingClient());

  const knowledgeBase = new KnowledgeBaseRepository(pool);
  const calendar = new CalendarRepository(pool);
  const appointments = new AppointmentRepository(pool);
  const usageTracker = new UsageTracker(pool);
  const webhookEvents = new WebhookEventStore(pool);
  const promptStore = new PromptStore(pool);

  const tools: AgentTool[] = [
    new SearchKnowledgeBaseTool(knowledgeBase, embeddings),
    new CheckAvailabilityTool(calendar),
    new CreateAppointmentTool(calendar, appointments),
  ];

  const policy = new TenantPolicy(pool, config.defaultMonthlyBudgetUsd);
  const agentService = new AgentService(pool, llm, tools, promptStore, usageTracker, policy);

  return { llm, embeddings, knowledgeBase, calendar, appointments, usageTracker, webhookEvents, agentService, policy };
}

function buildChatClient(config: Config): LlmClient {
  const { baseUrl, apiKey, chatModel, fallbackChatModels } = config.llm;
  if (!baseUrl || !apiKey) return new FakeLlmClient();

  const models = [chatModel, ...fallbackChatModels];
  // With somewhere to fall back to, fail over quickly instead of retrying one overloaded model for long.
  const attempts = models.length > 1 ? 2 : 4;
  const clients = models.map((m) => new OpenAiCompatibleLlmClient(baseUrl, apiKey, m, attempts));
  return clients.length === 1 ? clients[0]! : new FallbackLlmClient(clients);
}

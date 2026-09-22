import type { EmbeddingClient } from "../../llm/types.js";
import type { KnowledgeBaseRepository } from "../../rag/KnowledgeBaseRepository.js";
import { wrapUntrustedContent } from "../promptInjectionGuard.js";
import type { AgentTool, ToolExecutionContext } from "./Tool.js";

export class SearchKnowledgeBaseTool implements AgentTool {
  readonly definition = {
    name: "search_knowledge_base",
    description: "Search the clinic's knowledge base (policies, FAQs) for information relevant to a question.",
    parameters: {
      type: "object" as const,
      properties: { query: { type: "string", description: "The question or topic to search for." } },
      required: ["query"],
    },
  };

  constructor(
    private readonly repository: KnowledgeBaseRepository,
    private readonly embeddings: EmbeddingClient,
  ) {}

  async execute(context: ToolExecutionContext, args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? "");
    const [queryEmbedding] = await this.embeddings.embed([query]);
    const matches = await this.repository.search(context.tenantId, queryEmbedding!, 3);

    if (matches.length === 0) return "No relevant knowledge base entries were found.";

    return matches.map((m, i) => wrapUntrustedContent(`knowledge_base_result_${i}`, m.content)).join("\n\n");
  }
}

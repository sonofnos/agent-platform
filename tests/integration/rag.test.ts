import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { FakeEmbeddingClient } from "../../src/llm/FakeEmbeddingClient.js";
import { ingestDocument } from "../../src/rag/ingest.js";
import { KnowledgeBaseRepository } from "../../src/rag/KnowledgeBaseRepository.js";
import { startTestDb } from "./testDb.js";

describe("RAG pipeline against real Postgres + pgvector", () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let repository: KnowledgeBaseRepository;
  const embeddings = new FakeEmbeddingClient();

  beforeAll(async () => {
    ({ container, pool } = await startTestDb());
    repository = new KnowledgeBaseRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("retrieves the chunk whose words overlap the query, not an unrelated one", async () => {
    await ingestDocument(
      repository,
      embeddings,
      "tenant-a",
      "hours-policy",
      "The clinic is open Monday to Friday from 8am to 5pm.",
    );
    await ingestDocument(
      repository,
      embeddings,
      "tenant-a",
      "cancellation-policy",
      "Appointments can be cancelled free of charge up to 4 hours before the appointment time.",
    );

    const [queryEmbedding] = await embeddings.embed(["What time does the clinic open?"]);
    const matches = await repository.search("tenant-a", queryEmbedding!, 1);

    expect(matches).toHaveLength(1);
    expect(matches[0]!.content).toContain("8am");
  });

  it("never returns another tenant's documents", async () => {
    await ingestDocument(repository, embeddings, "tenant-b", "secret-policy", "Tenant B's confidential internal policy about opening hours.");

    const [queryEmbedding] = await embeddings.embed(["opening hours"]);
    const matches = await repository.search("tenant-a", queryEmbedding!, 10);

    expect(matches.every((m) => !m.content.includes("Tenant B"))).toBe(true);
  });
});

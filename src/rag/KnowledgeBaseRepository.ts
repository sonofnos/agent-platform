import type pg from "pg";

export interface ChunkMatch {
  documentId: string;
  chunkIndex: number;
  content: string;
  distance: number;
}

export class KnowledgeBaseRepository {
  constructor(private readonly pool: pg.Pool) {}

  async addDocument(tenantId: string, source: string, content: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      "INSERT INTO documents (tenant_id, source, content) VALUES ($1, $2, $3) RETURNING id",
      [tenantId, source, content],
    );
    return result.rows[0]!.id;
  }

  async addChunks(tenantId: string, documentId: string, chunks: Array<{ index: number; content: string; embedding: number[] }>): Promise<void> {
    for (const chunk of chunks) {
      await this.pool.query(
        "INSERT INTO document_chunks (tenant_id, document_id, chunk_index, content, embedding) VALUES ($1, $2, $3, $4, $5)",
        [tenantId, documentId, chunk.index, chunk.content, toVectorLiteral(chunk.embedding)],
      );
    }
  }

  /** Cosine-distance nearest neighbours, scoped to a single tenant -- no cross-tenant leakage. */
  async search(tenantId: string, queryEmbedding: number[], limit = 4): Promise<ChunkMatch[]> {
    const result = await this.pool.query<{ document_id: string; chunk_index: number; content: string; distance: number }>(
      `SELECT document_id, chunk_index, content, embedding <=> $2 AS distance
       FROM document_chunks
       WHERE tenant_id = $1
       ORDER BY embedding <=> $2
       LIMIT $3`,
      [tenantId, toVectorLiteral(queryEmbedding), limit],
    );

    return result.rows.map((r) => ({
      documentId: r.document_id,
      chunkIndex: r.chunk_index,
      content: r.content,
      distance: r.distance,
    }));
  }
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

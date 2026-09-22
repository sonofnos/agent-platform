import type { EmbeddingClient } from "../llm/types.js";
import type { KnowledgeBaseRepository } from "./KnowledgeBaseRepository.js";

const CHUNK_SIZE = 500;

export function chunkText(text: string, chunkSize = CHUNK_SIZE): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length > chunkSize && current) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current.trim());

  return chunks;
}

export async function ingestDocument(
  repository: KnowledgeBaseRepository,
  embeddings: EmbeddingClient,
  tenantId: string,
  source: string,
  content: string,
): Promise<string> {
  const documentId = await repository.addDocument(tenantId, source, content);
  const chunks = chunkText(content);
  const vectors = await embeddings.embed(chunks);

  await repository.addChunks(
    tenantId,
    documentId,
    chunks.map((chunkContent, index) => ({ index, content: chunkContent, embedding: vectors[index]! })),
  );

  return documentId;
}

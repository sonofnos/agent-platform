import type { EmbeddingClient } from "./types.js";

/**
 * A deterministic feature-hashing embedding (no learned semantics) used when no real
 * embedding provider is configured. It captures literal word overlap well enough to
 * demo and test retrieval end to end without needing an API key, but it is not a
 * substitute for a real embedding model in production.
 */
export class FakeEmbeddingClient implements EmbeddingClient {
  readonly dimensions = 768;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.hashEmbed(text));
  }

  private hashEmbed(text: string): number[] {
    const vector = new Array(this.dimensions).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const word of words) {
      vector[fnv1a(word) % this.dimensions] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

import type { EmbeddingClient } from "./types.js";

export class OpenAiCompatibleEmbeddingClient implements EmbeddingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    public readonly dimensions: number,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding provider returned ${response.status}: ${body}`);
    }

    const body = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return body.data.map((d) => d.embedding);
  }
}

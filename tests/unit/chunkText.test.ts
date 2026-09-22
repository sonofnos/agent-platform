import { describe, expect, it } from "vitest";
import { chunkText } from "../../src/rag/ingest.js";

describe("chunkText", () => {
  it("keeps a short document as a single chunk", () => {
    const chunks = chunkText("A short clinic policy paragraph.");
    expect(chunks).toEqual(["A short clinic policy paragraph."]);
  });

  it("splits on paragraph boundaries once a chunk exceeds the size limit", () => {
    const paragraphA = "A".repeat(300);
    const paragraphB = "B".repeat(300);
    const paragraphC = "C".repeat(300);

    const chunks = chunkText(`${paragraphA}\n\n${paragraphB}\n\n${paragraphC}`, 500);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain(paragraphA);
    expect(chunks.join("")).toContain(paragraphC);
  });

  it("never produces an empty chunk from blank paragraphs", () => {
    const chunks = chunkText("First.\n\n\n\nSecond.");
    expect(chunks.every((c) => c.trim().length > 0)).toBe(true);
  });
});

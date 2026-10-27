import z from "zod";
import { eq, isNull } from "drizzle-orm";
import { embedMany } from "ai";
import { ollama } from "ollama-ai-provider-v2";
import { db, facts } from "db";

export const EMBED_DIMENSIONS = 768;
export const EMBEDDING_MODEL = "nomic-embed-text";

const vectorSchema = z.array(z.number()).length(EMBED_DIMENSIONS);

export type EmbedKind = "doc" | "query";

const docPrefix = "search_document:";
const queryPrefix = "search_query:";

export async function embedClaims(
  values: string[],
  kind: EmbedKind = "doc",
): Promise<number[][]> {
  if (values.length === 0) return [];

  const prefix = kind === "doc" ? docPrefix : queryPrefix;
  const { embeddings } = await embedMany({
    model: ollama.embeddingModel("nomic-embed-text"),
    values: values.map((value) => `${prefix}${value}`),
  });

  for (const vector of embeddings) {
    const parsed = vectorSchema.safeParse(vector);
    if (!parsed.success) {
      throw new Error(
        `Embedding returned wrong dimensions: got ${vector.length}, expected ${EMBED_DIMENSIONS}`,
      );
    }
  }

  return embeddings;
}

const EMBED_BATCH_SIZE = 32;

export async function backfillFactEmbeddings(): Promise<number> {
  let total = 0;

  for (;;) {
    const pending = await db
      .select({ id: facts.id, claim: facts.claim })
      .from(facts)
      .where(isNull(facts.embedding))
      .limit(EMBED_BATCH_SIZE);
    if (pending.length === 0) break;

    const embeddings = await embedClaims(
      pending.map((p) => p.claim),
      "doc",
    );

    await Promise.all(
      pending.map((p, i) =>
        db
          .update(facts)
          .set({
            embedding: embeddings[i],
            embeddingModel: EMBEDDING_MODEL,
          })
          .where(eq(facts.id, p.id)),
      ),
    );

    total += pending.length;
    console.log(`[embedding] embedded ${total} fact(s)`);
  }

  return total;
}
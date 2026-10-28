import z from "zod";
import { and, asc, count, eq, gt, isNull, type SQL } from "drizzle-orm";
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

export type EmbedResult = {
  pending: number;
  embedded: number;
};

export type EmbedBackfillResult = {
  /** Facts without an embedding when the pass started. */
  pending: number;
  embedded: number;
  failed: number;
};

export async function backfillFactEmbeddings(): Promise<EmbedBackfillResult> {
  const [pendingRow] = await db
    .select({ value: count() })
    .from(facts)
    .where(isNull(facts.embedding));
  const pending = pendingRow?.value ?? 0;
  if (pending === 0) return { pending, embedded: 0, failed: 0 };

  let embedded = 0;
  let failed = 0;
  // Keyset pagination: a failed batch must not loop forever, so each
  // page is anchored after the previous one regardless of success.
  let lastId: string | null = null;

  for (;;) {
    const page: SQL[] = [isNull(facts.embedding)];
    if (lastId) page.push(gt(facts.id, lastId));

    const batch = await db
      .select({ id: facts.id, claim: facts.claim })
      .from(facts)
      .where(and(...page))
      .orderBy(asc(facts.id))
      .limit(EMBED_BATCH_SIZE);
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]!.id;

    try {
      const embeddings = await embedClaims(
        batch.map((p) => p.claim),
        "doc",
      );

      await Promise.all(
        batch.map((p, i) =>
          db
            .update(facts)
            .set({
              embedding: embeddings[i],
              embeddingModel: EMBEDDING_MODEL,
            })
            .where(eq(facts.id, p.id)),
        ),
      );

      embedded += batch.length;
      console.log(`[embedding] ${embedded}/${pending} embedded so far`);
    } catch (err) {
      failed += batch.length;
      console.error(
        `[embedding] failed to embed ${batch.length} fact(s): ${(err as Error).message}`,
      );
    }
  }

  return { pending, embedded, failed };
}

/**
 * Embed the claims of one document's facts that don't have a vector yet.
 * Throws on failure so the queue job stays pending and is retried.
 */
export async function embedFactsForDocument(
  docId: string,
): Promise<EmbedResult> {
  const pendingRows = await db
    .select({ id: facts.id, claim: facts.claim })
    .from(facts)
    .where(and(eq(facts.docId, docId), isNull(facts.embedding)));
  if (pendingRows.length === 0) return { pending: 0, embedded: 0 };

  const embeddings = await embedClaims(
    pendingRows.map((p) => p.claim),
    "doc",
  );

  await Promise.all(
    pendingRows.map((p, i) =>
      db
        .update(facts)
        .set({
          embedding: embeddings[i],
          embeddingModel: EMBEDDING_MODEL,
        })
        .where(eq(facts.id, p.id)),
    ),
  );

  return { pending: pendingRows.length, embedded: pendingRows.length };
}
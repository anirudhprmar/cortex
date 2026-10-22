import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { chunks, documents, entities, factEntities, facts } from "./schema";

type EntityType = NonNullable<(typeof entities.$inferInsert)["type"]>;

export type ExtractedFactInput = {
  claim: string;
  entities: { name: string; type: EntityType }[];
};

export type ChunkFactsInput = {
  ordinal: number;
  facts: ExtractedFactInput[];
};

/** Replace all extracted facts for a changed document atomically. */
export async function replaceDocumentFacts(
  docId: string,
  scope: string,
  chunkFacts: ChunkFactsInput[],
  extractionModel: string,
  extractedHash: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [document] = await tx
      .select({
        contentHash: documents.contentHash,
        extractedHash: documents.extractedHash,
      })
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1)
      .for("update");

    // A newer ingest may have landed while this extraction job was running.
    if (
      !document ||
      document.contentHash !== extractedHash ||
      document.extractedHash === extractedHash
    ) {
      return false;
    }

    const docChunks = await tx
      .select({ id: chunks.id, ordinal: chunks.ordinal })
      .from(chunks)
      .where(eq(chunks.docId, docId));
    const chunkIds = new Map(
      docChunks.map((chunk) => [chunk.ordinal, chunk.id]),
    );

    await tx.delete(facts).where(eq(facts.docId, docId));

    for (const chunkResult of chunkFacts) {
      const chunkId = chunkIds.get(chunkResult.ordinal);
      if (!chunkId) {
        throw new Error(
          `Missing database chunk ${chunkResult.ordinal} for document ${docId}`,
        );
      }

      for (const fact of chunkResult.facts) {
        const [insertedFact] = await tx
          .insert(facts)
          .values({
            claim: fact.claim,
            docId,
            chunkId,
            scope,
            extractionModel,
          })
          .returning({ id: facts.id });

        if (!insertedFact) {
          throw new Error(
            `Failed to insert extracted fact for document ${docId}`,
          );
        }

        const uniqueEntities = new Map(
          fact.entities.map((entity) => [
            `${entity.type}\0${entity.name}`,
            entity,
          ]),
        );

        for (const entity of uniqueEntities.values()) {
          await tx
            .insert(entities)
            .values(entity)
            .onConflictDoNothing({ target: [entities.name, entities.type] });

          const [storedEntity] = await tx
            .select({ id: entities.id })
            .from(entities)
            .where(
              and(
                eq(entities.name, entity.name),
                eq(entities.type, entity.type),
              ),
            )
            .limit(1);

          if (!storedEntity) {
            throw new Error(
              `Failed to resolve extracted entity: ${entity.name}`,
            );
          }

          await tx.insert(factEntities).values({
            factId: insertedFact.id,
            entityId: storedEntity.id,
          });
        }
      }
    }

    await tx
      .update(documents)
      .set({ extractedHash })
      .where(eq(documents.id, docId));

    return true;
  });
}

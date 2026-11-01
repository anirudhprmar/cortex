import { eq } from "drizzle-orm";
import { db } from "./index";
import { chunks, documents, facts } from "./schema";
import { insertDocSchema, type InsertDocProps } from "./documents";

export type ChunkInput = {
  headingPath: string[];
  startLine: number;
  endLine: number;
  content: string;
};

export type IngestResult = {
  skipped: boolean;
  isNew: boolean;
  docId: string;
  chunkCount: number;
  shouldEnqueue: boolean;
};

export async function ingestDocument(
  props: InsertDocProps,
  chunkInputs: ChunkInput[],
): Promise<IngestResult> {
  const doc = insertDocSchema.parse(props);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: documents.id,
        contentHash: documents.contentHash,
        extractedHash: documents.extractedHash,
        projectKey: documents.projectKey,
      })
      .from(documents)
      .where(eq(documents.path, doc.path))
      .limit(1);

    const existingDoc = existing[0];

    if (existingDoc && existingDoc.contentHash === doc.contentHash) {
      // Content unchanged, but the project level may have moved. Re-label the
      // already-extracted facts in this same transaction so a fact never
      // points to a project its document no longer belongs to.
      if ((existingDoc.projectKey ?? null) !== (doc.projectKey ?? null)) {
        await tx
          .update(facts)
          .set({ projectKey: doc.projectKey ?? null })
          .where(eq(facts.docId, existingDoc.id));
      }

      return {
        skipped: true,
        isNew: false,
        docId: existingDoc.id,
        chunkCount: 0,
        shouldEnqueue: false,
      };
    }

    const [row] = await tx
      .insert(documents)
      .values(doc)
      .onConflictDoUpdate({
        target: documents.path,
        set: {
          title: doc.title ?? null,
          content: doc.content,
          contentHash: doc.contentHash,
          modality: doc.modality,
          scope: doc.scope,
          projectKey: doc.projectKey,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: documents.id,
        extractedHash: documents.extractedHash,
        contentHash: documents.contentHash,
      });

    if (!row) {
      throw new Error(`Failed to upsert document: ${doc.path}`);
    }

    // Remove document facts before their referenced chunks are replaced.
    await tx.delete(facts).where(eq(facts.docId, row.id));
    await tx.delete(chunks).where(eq(chunks.docId, row.id));

    if (chunkInputs.length > 0) {
      await tx.insert(chunks).values(
        chunkInputs.map((chunk, ordinal) => ({
          docId: row.id,
          ordinal,
          headingPath: JSON.stringify(chunk.headingPath),
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
        })),
      );
    }

    return {
      skipped: false,
      isNew: !existingDoc,
      docId: row.id,
      chunkCount: chunkInputs.length,
      shouldEnqueue: row.contentHash !== row.extractedHash,
    };
  });
}

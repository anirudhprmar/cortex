import { eq } from "drizzle-orm";
import { db } from "./index";
import { chunks, documents } from "./schema";
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
};

export async function ingestDocument(
  props: InsertDocProps,
  chunkInputs: ChunkInput[],
): Promise<IngestResult> {
  const doc = insertDocSchema.parse(props);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: documents.id, contentHash: documents.contentHash })
      .from(documents)
      .where(eq(documents.path, doc.path))
      .limit(1);

    const existingDoc = existing[0];

    if (existingDoc && existingDoc.contentHash === doc.contentHash) {
      return {
        skipped: true,
        isNew: false,
        docId: existingDoc.id,
        chunkCount: 0,
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
          updatedAt: new Date(),
        },
      })
      .returning({ id: documents.id });

    if (!row) {
      throw new Error(`Failed to upsert document: ${doc.path}`);
    }

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
    };
  });
}

import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db, chunks, documents, facts } from "db";

export type DocumentListItem = {
  id: string;
  path: string;
  title: string | null;
  modality: string;
  scope: string;
  projectKey: string | null;
  factCount: number;
  activeFactCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ListDocumentsOptions = {
  scope?: string;
  projectKey?: string;
  limit?: number;
  offset?: number;
};

export type ListDocumentsResult = {
  total: number;
  items: DocumentListItem[];
};

export type DocumentDetailChunk = {
  id: string;
  ordinal: number;
  headingPath: string[];
  startLine: number;
  endLine: number;
  content: string;
  facts: { id: string; claim: string; observedAt: Date | null; createdAt: Date }[];
};

export type DocumentDetail = {
  id: string;
  path: string;
  title: string | null;
  content: string;
  modality: string;
  scope: string;
  projectKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  chunks: DocumentDetailChunk[];
};

function listConditions(options: ListDocumentsOptions): SQL[] {
  const conditions: SQL[] = [];
  if (options.scope) conditions.push(eq(documents.scope, options.scope));
  if (options.projectKey !== undefined) {
    conditions.push(
      options.projectKey === ""
        ? sql`${documents.projectKey} is null`
        : eq(documents.projectKey, options.projectKey),
    );
  }
  return conditions;
}

export async function listDocuments(
  options: ListDocumentsOptions = {},
): Promise<ListDocumentsResult> {
  const { limit = 50, offset = 0 } = options;
  const conditions = listConditions(options);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRows, rows] = await Promise.all([
    db.select({ value: sql<number>`count(*)::int` }).from(documents).where(where),
    db
      .select({
        id: documents.id,
        path: documents.path,
        title: documents.title,
        modality: documents.modality,
        scope: documents.scope,
        projectKey: documents.projectKey,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        activeFactCount: sql<number>`(select count(*)::int from facts where facts."docId" = "documents"."id" and facts."supersededBy" is null)`,
      })
      .from(documents)
      .where(where)
      .orderBy(sql`"documents"."updated_at" desc`)
      .limit(limit)
      .offset(offset),
  ]);

  return {
    total: totalRows[0]?.value ?? 0,
    items: rows,
  };
}

export async function getDocumentById(
  id: string,
): Promise<DocumentDetail | null> {
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  if (!document) return null;

  const [chunkRows, factRows] = await Promise.all([
    db
      .select()
      .from(chunks)
      .where(eq(chunks.docId, id))
      .orderBy(asc(chunks.ordinal)),
    db
      .select({
        id: facts.id,
        claim: facts.claim,
        chunkId: facts.chunkId,
        observedAt: facts.observedAt,
        createdAt: facts.createdAt,
      })
      .from(facts)
      .where(and(eq(facts.docId, id), isNull(facts.supersededBy)))
      .orderBy(asc(facts.createdAt), asc(facts.id)),
  ]);

  const factsByChunk = new Map<string, DocumentDetailChunk["facts"]>();
  for (const fact of factRows) {
    const bucket = factsByChunk.get(fact.chunkId) ?? [];
    bucket.push({
      id: fact.id,
      claim: fact.claim,
      observedAt: fact.observedAt,
      createdAt: fact.createdAt,
    });
    factsByChunk.set(fact.chunkId, bucket);
  }

  return {
    ...document,
    chunks: chunkRows.map((chunk) => ({
      id: chunk.id,
      ordinal: chunk.ordinal,
      headingPath: JSON.parse(chunk.headingPath ?? "[]") as string[],
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      content: chunk.content,
      facts: factsByChunk.get(chunk.id) ?? [],
    })),
  };
}

import { and, asc, eq, isNull, sql, cosineDistance } from "drizzle-orm";
import { db, documents, facts } from "db";
import { embedClaims } from "./embedding";

export type DuplicateMatch = {
  factId: string;
  claim: string;
  docPath: string;
  scope: string;
  similarity: number;
};

/**
 * Candidate duplicates for a memory proposal at approval time: embed the
 * proposal text as a query and rank non-superseded facts from the same
 * memory level (and project) by cosine similarity.
 */
export async function nearestFacts(
  text: string,
  projectKey: string | null,
  limit = 5,
): Promise<DuplicateMatch[]> {
  const [queryEmbedding] = await embedClaims([text], "query");
  if (!queryEmbedding) return [];

  const distance = cosineDistance(facts.embedding, queryEmbedding);

  const conditions = [
    isNull(facts.supersededBy),
    sql`${facts.embedding} is not null`,
  ];
  conditions.push(
    projectKey === null
      ? isNull(facts.projectKey)
      : eq(facts.projectKey, projectKey),
  );

  const rows = await db
    .select({
      factId: facts.id,
      claim: facts.claim,
      scope: facts.scope,
      docPath: documents.path,
      similarity: sql<number>`1 - (${distance})`,
    })
    .from(facts)
    .innerJoin(documents, eq(documents.id, facts.docId))
    .where(and(...conditions))
    .orderBy(asc(distance))
    .limit(limit);

  return rows.map((row) => ({ ...row, similarity: Number(row.similarity) }));
}

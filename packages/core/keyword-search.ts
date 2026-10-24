import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, chunks, documents, entities, factEntities, facts } from "db";

export type SearchResult = {
  factId: string;
  claim: string;
  entityNames: string[];
  docPath: string;
  startLine: number;
  endLine: number;
  headingPath: string[];
  scope: string;
  rank: number;
};

export type SearchOptions = {
  /** Scopes to search. Omit to search all scopes. */
  scopes?: string[];
  /** Whether to include facts that have been superseded. Defaults to false. */
  includeSuperseded?: boolean;
  limit?: number;
  offset?: number;
};

export async function keywordSearch(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const {
    scopes,
    includeSuperseded = false,
    limit = 20,
    offset = 0,
  } = options;

  if (scopes && scopes.length === 0) return [];

  const rankExpr = sql<number>`ts_rank_cd(
    to_tsvector('english', ${facts.claim}),
    plainto_tsquery('english', ${query})
  )`;

  const conditions = [
    sql`to_tsvector('english', ${facts.claim}) @@ plainto_tsquery('english', ${query})`,
  ];

  if (!includeSuperseded) conditions.push(isNull(facts.supersededBy));
  if (scopes) conditions.push(inArray(facts.scope, scopes));

  const rows = await db
    .select({
      factId: facts.id,
      claim: facts.claim,
      scope: facts.scope,
      rank: rankExpr,
      docPath: documents.path,
      startLine: chunks.startLine,
      endLine: chunks.endLine,
      headingPath: chunks.headingPath,
      entityNames:
        sql<string[]>`coalesce(json_agg(distinct ${entities.name}) filter (where ${entities.name} is not null), '[]')`,
    })
    .from(facts)
    .innerJoin(documents, eq(documents.id, facts.docId))
    .leftJoin(chunks, eq(chunks.id, facts.chunkId))
    .leftJoin(factEntities, eq(factEntities.factId, facts.id))
    .leftJoin(entities, eq(entities.id, factEntities.entityId))
    .where(and(...conditions))
    .groupBy(facts.id, documents.id, chunks.id)
    .orderBy(desc(rankExpr), asc(facts.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({
    ...row,
    startLine: row.startLine ?? -1,
    endLine: row.endLine ?? -1,
    entityNames: row.entityNames ?? [],
    headingPath: JSON.parse(row.headingPath ?? "[]") as string[],
  }));
}

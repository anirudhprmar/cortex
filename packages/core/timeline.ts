import { and, eq, isNull, sql } from "drizzle-orm";
import { db, documents, facts } from "db";

export type TimelineEvent =
  | {
      type: "document.created";
      at: Date;
      documentId: string;
      path: string;
      title: string | null;
      scope: string;
    }
  | {
      type: "document.updated";
      at: Date;
      documentId: string;
      path: string;
      title: string | null;
      scope: string;
    }
  | {
      type: "fact.extracted";
      at: Date;
      factId: string;
      claim: string;
      documentId: string;
      path: string;
      scope: string;
    };

export type TimelineOptions = {
  /** Register-time filter. Omit to include both. */
  scope?: string;
  limit?: number;
  offset?: number;
};

export type TimelineResult = {
  events: TimelineEvent[];
};

/**
 * Both sources are fetched with (limit + offset) so a merged window of
 * size `limit` at `offset` always has enough rows to draw from.
 */
export async function getTimeline(
  options: TimelineOptions = {},
): Promise<TimelineResult> {
  const { scope, limit = 50, offset = 0 } = options;
  const window = limit + offset;

  const docConditions = [];
  if (scope) docConditions.push(eq(documents.scope, scope));

  const factConditions = [isNull(facts.supersededBy)];
  if (scope) factConditions.push(eq(facts.scope, scope));

  const [createdDocs, updatedDocs, factRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        path: documents.path,
        title: documents.title,
        scope: documents.scope,
        at: documents.createdAt,
      })
      .from(documents)
      .where(docConditions.length > 0 ? and(...docConditions) : undefined)
      .orderBy(sql`${documents.createdAt} desc`)
      .limit(window),
    db
      .select({
        id: documents.id,
        path: documents.path,
        title: documents.title,
        scope: documents.scope,
        at: documents.updatedAt,
      })
      .from(documents)
      .where(
        docConditions.length > 0
          ? and(
              ...docConditions,
              sql`${documents.updatedAt} > ${documents.createdAt}`,
            )
          : sql`${documents.updatedAt} > ${documents.createdAt}`,
      )
      .orderBy(sql`${documents.updatedAt} desc`)
      .limit(window),
    db
      .select({
        id: facts.id,
        claim: facts.claim,
        scope: facts.scope,
        at: sql<Date>`coalesce(${facts.observedAt}, ${facts.createdAt})`,
        documentId: documents.id,
        path: documents.path,
      })
      .from(facts)
      .innerJoin(documents, eq(documents.id, facts.docId))
      .where(and(...factConditions))
      .orderBy(sql`coalesce(${facts.observedAt}, ${facts.createdAt}) desc`)
      .limit(window),
  ]);

  const events: TimelineEvent[] = [
    ...createdDocs.map((row) => ({
      type: "document.created" as const,
      at: row.at,
      documentId: row.id,
      path: row.path,
      title: row.title,
      scope: row.scope,
    })),
    ...updatedDocs.map((row) => ({
      type: "document.updated" as const,
      at: row.at,
      documentId: row.id,
      path: row.path,
      title: row.title,
      scope: row.scope,
    })),
    ...factRows.map((row) => ({
      type: "fact.extracted" as const,
      at: new Date(row.at),
      factId: row.id,
      claim: row.claim,
      documentId: row.documentId,
      path: row.path,
      scope: row.scope,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return { events: events.slice(offset, offset + limit) };
}

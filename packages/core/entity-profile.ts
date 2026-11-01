import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod'
import { chunks, db, documents, entities, factEntities, facts } from 'db';

export const profileOptionsSchema = z.object({
  name: z.string(),
  scope: z.string().optional(),
  // null = user-level facts only, string = project-level facts only. Omit to include both.
  projectKey: z.string().nullish()
})

export type ProfileOptions = z.infer<typeof profileOptionsSchema>;

export type EntitySummary = {
  id: string;
  name: string;
  type: (typeof entities.$inferSelect)["type"];
}

export type EntityFact = {
  factId: string;
  claim: string;
  docPath: string;
  startLine: number;
  endLine: number;
  headingPath: string[];
  scope: string;
  projectKey: string | null;
};

export type ProfileResult = 
  | { status: "notFound" }
  | { status: "ambiguous"; entities: EntitySummary[] }
  | { status: "found"; entity: EntitySummary; facts: EntityFact[] }

export async function entityProfile(options: ProfileOptions): Promise<ProfileResult> {
  const { name, scope, projectKey } = options;
  const trimmedName = name.trim();

  const matches = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type
    })
    .from(entities)
    .where(sql`lower(${entities.name}) = lower(${trimmedName})`);

  if (matches.length === 0) return {
    status: "notFound"
  }
  if (matches.length > 1) return {
    status: "ambiguous",
    entities: matches
  };

  const entity = matches[0];
  if (!entity) return { status: "notFound" };

  const conditions = [
    eq(factEntities.entityId, entity.id),
    isNull(facts.supersededBy)
  ]
  if (scope) conditions.push(eq(facts.scope, scope));
  if (projectKey !== undefined) {
    conditions.push(
      projectKey === null ? isNull(facts.projectKey) : eq(facts.projectKey, projectKey),
    );
  }
  
  const rows = await db
    .select({
      factId: facts.id,
      claim: facts.claim,
      scope: facts.scope,
      projectKey: facts.projectKey,
      docPath: documents.path,
      startLine: chunks.startLine,
      endLine: chunks.endLine,
      headingPath: chunks.headingPath,
    })
    .from(factEntities)
    .innerJoin(facts, eq(facts.id, factEntities.factId))
    .leftJoin(chunks, eq(chunks.id, facts.chunkId))
    .leftJoin(documents, eq(documents.id, facts.docId))
    .where(and(...conditions))
    .orderBy(asc(documents.path), asc(chunks.startLine), asc(facts.id));

  return {
    status: "found",
    entity,
    facts: rows.map((row) => ({
      ...row,
      docPath: row.docPath ?? "",
      startLine: row.startLine ?? -1,
      endLine: row.endLine ?? -1,
      headingPath: JSON.parse(row.headingPath ?? "[]") as string[]
    }))
  }
  
}
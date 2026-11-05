import { asc, count, desc, eq, sql } from "drizzle-orm";
import { db, entities, factEntities, facts } from "db";

type EntityType = (typeof entities.$inferSelect)["type"];

export type ListEntitiesOptions = {
  type?: EntityType;
  limit?: number;
  offset?: number;
};

export type ListEntitiesResult = {
  total: number;
  items: {
    id: string;
    name: string;
    type: EntityType;
    factCount: number;
  }[];
};

export async function listEntities(
  options: ListEntitiesOptions = {},
): Promise<ListEntitiesResult> {
  const { type, limit = 50, offset = 0 } = options;
  const where = type ? eq(entities.type, type) : undefined;

  const factCount = sql<number>`count(distinct case when ${facts.supersededBy} is null then ${factEntities.factId} end)::int`;

  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(entities).where(where),
    db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        factCount,
      })
      .from(entities)
      .leftJoin(factEntities, eq(factEntities.entityId, entities.id))
      .leftJoin(facts, eq(facts.id, factEntities.factId))
      .where(where)
      .groupBy(entities.id)
      .orderBy(desc(factCount), asc(entities.name))
      .limit(limit)
      .offset(offset),
  ]);

  return {
    total: totalRows[0]?.value ?? 0,
    items: rows,
  };
}

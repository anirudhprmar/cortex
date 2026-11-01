import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { entities, factEntities, facts } from "./schema";

type EntityType = NonNullable<(typeof entities.$inferInsert)["type"]>;

export type ListEntitiesOptions = {
  type?: EntityType;
  limit?: number;
  offset?: number;
};

export type EntityListItem = {
  id: string;
  name: string;
  type: EntityType;
  factCount: number;
};

export async function listEntities(
  options: ListEntitiesOptions = {},
): Promise<EntityListItem[]> {
  const { type, limit = 50, offset = 0 } = options;

  const factCount = sql<number>`count(distinct case when ${facts.supersededBy} is null then ${factEntities.factId} end)`;

  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      factCount,
    })
    .from(entities)
    .leftJoin(factEntities, eq(factEntities.entityId, entities.id))
    .leftJoin(facts, eq(facts.id, factEntities.factId))
    .where(type ? eq(entities.type, type) : undefined)
    .groupBy(entities.id)
    .orderBy(desc(factCount), asc(entities.name))
    .limit(limit)
    .offset(offset);

  return rows;
}

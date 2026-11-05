import { count, sql } from "drizzle-orm";
import { db, documents, entities, facts, memoryProposals } from "db";

export type DashboardStatus = {
  documents: { total: number; byScope: Record<string, number> };
  facts: { total: number; active: number; superseded: number };
  entities: { total: number; byType: Record<string, number> };
  proposals: { pending: number; approved: number; rejected: number };
};

export async function getStatusOverview(): Promise<DashboardStatus> {
  const [docTotal, docsByScope, factCounts, entitiesByType, proposalsByStatus] =
    await Promise.all([
      db.select({ value: count() }).from(documents),
      db
        .select({ scope: documents.scope, value: count() })
        .from(documents)
        .groupBy(documents.scope),
      db
        .select({
          total: count(),
          active: sql<number>`count(*) filter (where ${facts.supersededBy} is null)`,
          superseded: sql<number>`count(*) filter (where ${facts.supersededBy} is not null)`,
        })
        .from(facts),
      db
        .select({ type: entities.type, value: count() })
        .from(entities)
        .groupBy(entities.type),
      db
        .select({ status: memoryProposals.status, value: count() })
        .from(memoryProposals)
        .groupBy(memoryProposals.status),
    ]);

  return {
    documents: {
      total: docTotal[0]?.value ?? 0,
      byScope: Object.fromEntries(docsByScope.map((r) => [r.scope, r.value])),
    },
    facts: {
      total: factCounts[0]?.total ?? 0,
      active: Number(factCounts[0]?.active ?? 0),
      superseded: Number(factCounts[0]?.superseded ?? 0),
    },
    entities: {
      total: entitiesByType.reduce((sum, r) => sum + r.value, 0),
      byType: Object.fromEntries(entitiesByType.map((r) => [r.type, r.value])),
    },
    proposals: {
      pending: proposalsByStatus
        .filter((r) => r.status === "pending")
        .reduce((sum, r) => sum + r.value, 0),
      approved: proposalsByStatus
        .filter((r) => r.status === "approved")
        .reduce((sum, r) => sum + r.value, 0),
      rejected: proposalsByStatus
        .filter((r) => r.status === "rejected")
        .reduce((sum, r) => sum + r.value, 0),
    },
  };
}

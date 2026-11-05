import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, documents, entities, factEntities, factLinks, facts } from "db";
import type { EntitySummary } from "./entity-profile";

export const graphOptionsSchema = z
  .object({
    entityName: z.string(),
    depth: z.number().int().min(0).max(4).default(2),
    maxNodes: z.number().int().min(1).max(1000).default(300),
    scope: z.string().optional(),
  });

export type GraphOptions = z.infer<typeof graphOptionsSchema>;

export type GraphEntityNode = {
  kind: "entity";
  id: string;
  name: string;
  type: EntitySummary["type"];
  depth: number;
};

export type GraphFactNode = {
  kind: "fact";
  id: string;
  claim: string;
  docPath: string;
  depth: number;
};

export type GraphNode = GraphEntityNode | GraphFactNode;

export type GraphEdge = {
  source: string;
  target: string;
  relation: "mentions" | "supports" | "contradicts" | "related";
};

export type GraphResult =
  | { status: "notFound" }
  | { status: "ambiguous"; entities: EntitySummary[] }
  | {
      status: "found";
      center: EntitySummary;
      nodes: GraphNode[];
      edges: GraphEdge[];
      truncated: boolean;
    };

export async function entityGraph(
  options: GraphOptions,
): Promise<GraphResult> {
  const { entityName, depth, maxNodes, scope } = options;
  const trimmedName = entityName.trim();

  const matches = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
    })
    .from(entities)
    .where(sql`lower(${entities.name}) = lower(${trimmedName})`);

  if (matches.length === 0) return { status: "notFound" };
  if (matches.length > 1) return { status: "ambiguous", entities: matches };

  const center = matches[0]!;
  const visitedEntities = new Map<string, GraphEntityNode>();
  const factNodes = new Map<string, GraphFactNode>();
  const edges = new Map<string, GraphEdge>();

  let frontier = [center.id];
  visitedEntities.set(center.id, {
    kind: "entity",
    id: center.id,
    name: center.name,
    type: center.type,
    depth: 0,
  });

  let truncated = false;
  let currentDepth: number;

  for (currentDepth = 0; currentDepth < depth; currentDepth++) {
    if (frontier.length === 0 || visitedEntities.size + factNodes.size >= maxNodes) break;

    const factConditions = [
      inArray(factEntities.entityId, frontier),
      isNull(facts.supersededBy),
    ];
    if (scope) factConditions.push(eq(facts.scope, scope));

    const factRows = await db
      .select({
        id: facts.id,
        claim: facts.claim,
        entityId: factEntities.entityId,
        docPath: documents.path,
      })
      .from(factEntities)
      .innerJoin(facts, eq(facts.id, factEntities.factId))
      .leftJoin(documents, eq(documents.id, facts.docId))
      .where(and(...factConditions));

    const factIds = [
      ...new Set(factRows.filter((row) => row.docPath !== null).map((row) => row.id)),
    ];

    if (factNodes.size + factIds.length > maxNodes) {
      factIds.length = Math.max(0, maxNodes - factNodes.size);
      truncated = true;
    }

    for (const factId of factIds) {
      if (factNodes.has(factId)) continue;
      const row = factRows.find((row) => row.id === factId)!;
      factNodes.set(factId, {
        kind: "fact",
        id: factId,
        claim: row.claim,
        docPath: row.docPath ?? "",
        depth: currentDepth,
      });
    }

    if (factIds.length > 0) {
      const coRows = await db
        .select({
          factId: factEntities.factId,
          entityId: entities.id,
          name: entities.name,
          type: entities.type,
        })
        .from(factEntities)
        .innerJoin(entities, eq(entities.id, factEntities.entityId))
        .where(inArray(factEntities.factId, factIds));

      const nextFrontier: string[] = [];
      for (const row of coRows) {
        if (!factNodes.has(row.factId)) continue;
        const edgeKey = `mention:${row.entityId}:${row.factId}`;
        if (!edges.has(edgeKey)) {
          edges.set(edgeKey, {
            source: row.entityId,
            target: row.factId,
            relation: "mentions",
          });
        }
        if (!visitedEntities.has(row.entityId)) {
          if (visitedEntities.size + factNodes.size >= maxNodes) {
            truncated = true;
            continue;
          }
          visitedEntities.set(row.entityId, {
            kind: "entity",
            id: row.entityId,
            name: row.name,
            type: row.type,
            depth: currentDepth + 1,
          });
          nextFrontier.push(row.entityId);
        }
      }
      frontier = nextFrontier;
    } else {
      frontier = [];
    }
  }

  const collectedFactIds = [...factNodes.keys()];
  if (collectedFactIds.length > 1) {
    const linkRows = await db
      .select()
      .from(factLinks)
      .where(inArray(factLinks.fromFactId, collectedFactIds));

    for (const link of linkRows) {
      if (!collectedFactIds.includes(link.toFactId)) continue;
      const edgeKey = `link:${link.fromFactId}:${link.toFactId}:${link.relation}`;
      if (!edges.has(edgeKey)) {
        edges.set(edgeKey, {
          source: link.fromFactId,
          target: link.toFactId,
          relation: link.relation,
        });
      }
    }
  }

  return {
    status: "found",
    center: { id: center.id, name: center.name, type: center.type },
    nodes: [...visitedEntities.values(), ...factNodes.values()],
    edges: [...edges.values()],
    truncated,
  };
}

import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { db } from "./index";
import { chunks, documents, entities, factEntities, facts, memoryProposals } from "./schema";

export type Proposal = typeof memoryProposals.$inferSelect;

export type InsertProposalProps = {
  memory: string;
  level: (typeof memoryProposals.$inferInsert)["level"];
  projectKey: string | null;
  agentName: string;
  sessionId: string;
};

/** Insert a pending memory proposal awaiting review. */
export async function insertProposal(props: InsertProposalProps) {
  const [row] = await db
    .insert(memoryProposals)
    .values({
      memory: props.memory,
      level: props.level,
      projectKey: props.projectKey,
      agentName: props.agentName,
      sessionId: props.sessionId,
    })
    .returning({ id: memoryProposals.id });

  if (!row) {
    throw new Error("Failed to insert memory proposal");
  }

  return row;
}

export async function listProposals() {
  const rows = await db
    .select()
    .from(memoryProposals)
    .where(eq(memoryProposals.status, "pending"))
    .orderBy(desc(memoryProposals.createdAt))
    .limit(50);

  return { total: rows.length, allProposals: rows };
}

export async function getProposal(proposalId: string) {
  const rows = await db
    .select()
    .from(memoryProposals)
    .where(eq(memoryProposals.id, proposalId))
    .limit(1);

  return rows[0] ?? null;
}

export class ProposalError extends Error {}

/** Entity types allowed for manual linking, mirroring the schema enum. */
export const ENTITY_TYPES: readonly string[] = getTableColumns(entities).type
  .enumValues as readonly string[];

export type EntityPick = { name: string; type: string };

/**
 * Approve a pending proposal synchronously, with no LLM call: in one
 * transaction, mint the memory://<proposal-id> source document, one chunk
 * holding the approved text, one fact with that text as claim (extraction
 * model "verbatim" for unchanged text, "manual" for reviewer-edited text),
 * link the reviewer-picked entities, apply the supersede choice, and flip
 * the proposal to approved with its documentId. The embedding pass picks
 * up the new fact automatically because its embedding is null.
 */
export async function approveProposal(
  proposalId: string,
  opts: {
    /** Reviewer-edited text (from cortex review edit). Applied to the document only. */
    editedText?: string;
    /** Existing fact this approval supersedes; applied immediately here. */
    supersedesFactId?: string | null;
    /** Entities to link to the new fact, per the manual-linking rules. */
    entities?: EntityPick[];
  } = {},
) {
  const proposal = await getProposal(proposalId);
  if (!proposal) {
    throw new ProposalError(`No proposal with id ${proposalId}`);
  }
  if (proposal.status !== "pending") {
    throw new ProposalError(
      `Proposal ${proposalId} is already ${proposal.status}; only pending proposals can be approved`,
    );
  }

  const supersedesFactId = opts.supersedesFactId ?? null;

  const picks = normalizeEntityPicks(opts.entities ?? []);

  const content = opts.editedText?.trim() || proposal.memory;
  if (content.length === 0) {
    throw new ProposalError("Approved text is empty");
  }
  const contentHash = createHash("sha256").update(content).digest("hex");
  // Level -> scope mapping for the source document: user -> personal,
  // project -> work.
  const scope = proposal.level === "project" ? "work" : "personal";
  const extractionModel = opts.editedText ? "manual" : "verbatim";

  const { docId, factId, linkedEntities } = await db.transaction(async (tx) => {
    if (supersedesFactId) {
      const [factRow] = await tx
        .select({ id: facts.id })
        .from(facts)
        .where(eq(facts.id, supersedesFactId))
        .limit(1);
      if (!factRow) {
        throw new ProposalError(
          `No fact with id ${supersedesFactId} to supersede`,
        );
      }
    }

    const [doc] = await tx
      .insert(documents)
      .values({
        path: `memory://${proposal.id}`,
        title: null,
        content,
        contentHash,
        modality: "memory",
        scope,
        projectKey: proposal.projectKey,
      })
      .returning({ id: documents.id });

    if (!doc) {
      throw new Error(`Failed to create memory document for ${proposalId}`);
    }

    const [chunk] = await tx
      .insert(chunks)
      .values({
        docId: doc.id,
        ordinal: 0,
        headingPath: "[]",
        startLine: 1,
        endLine: content.split("\n").length,
        content,
      })
      .returning({ id: chunks.id });

    if (!chunk) {
      throw new Error(`Failed to create chunk for proposal ${proposalId}`);
    }

    const [fact] = await tx
      .insert(facts)
      .values({
        claim: content,
        docId: doc.id,
        chunkId: chunk.id,
        scope,
        projectKey: proposal.projectKey,
        extractionModel,
      })
      .returning({ id: facts.id });

    if (!fact) {
      throw new Error(`Failed to create fact for proposal ${proposalId}`);
    }

    if (supersedesFactId) {
      await tx
        .update(facts)
        .set({ supersededBy: fact.id })
        .where(eq(facts.id, supersedesFactId));
    }

    // Manual-linking rule: an entity is created only when both its name and
    // type are new; if the name already exists under another type, approve
    // fails so the (name, type) pairs stay consistent.
    const linkedEntities: EntityPick[] = [];
    for (const pick of picks) {
      const existing = await tx
        .select({ type: entities.type })
        .from(entities)
        .where(eq(entities.name, pick.name));

      const sameNameOtherType = existing.find(
        (row) => String(row.type) !== pick.type,
      );
      if (sameNameOtherType) {
        throw new ProposalError(
          `Entity "${pick.name}" already exists as type "${sameNameOtherType.type}"; pick that type or a new name.`,
        );
      }

      await tx
        .insert(entities)
        .values({ name: pick.name, type: pick.type as EntityPickType })
        .onConflictDoNothing({ target: [entities.name, entities.type] });

      const [storedEntity] = await tx
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(eq(entities.name, pick.name), eq(entities.type, pick.type as EntityPickType)),
        )
        .limit(1);

      if (!storedEntity) {
        throw new Error(`Failed to resolve picked entity: ${pick.name}`);
      }

      await tx
        .insert(factEntities)
        .values({ factId: fact.id, entityId: storedEntity.id });

      linkedEntities.push(pick);
    }

    const [updated] = await tx
      .update(memoryProposals)
      .set({
        status: "approved",
        reviewedAt: new Date(),
        documentId: doc.id,
        supersedesFactId: supersedesFactId,
      })
      .where(
        and(
          eq(memoryProposals.id, proposalId),
          eq(memoryProposals.status, "pending"),
        ),
      )
      .returning({ id: memoryProposals.id });

    if (!updated) {
      throw new Error(`Proposal ${proposalId} was no longer pending`);
    }

    // Mark the document as processed so a future sweep over documents with a
    // null extracted_hash never re-runs LLM extraction on a manual memory doc.
    await tx
      .update(documents)
      .set({ extractedHash: contentHash })
      .where(eq(documents.id, doc.id));

    return { docId: doc.id, factId: fact.id, linkedEntities };
  });

  return {
    proposalId: proposal.id,
    docId,
    factId,
    extractionModel,
    approved: content,
    entities: linkedEntities,
  };
}

type EntityPickType = NonNullable<(typeof entities.$inferInsert)["type"]>;

/** Validate and deduplicate entity picks before any transaction runs. */
function normalizeEntityPicks(picks: EntityPick[]): EntityPick[] {
  const unique = new Map<string, EntityPick>();
  for (const pick of picks) {
    const name = pick.name.trim();
    const type = pick.type.trim();
    if (!ENTITY_TYPES.includes(type)) {
      throw new ProposalError(
        `Invalid entity type "${type}"; use one of ${ENTITY_TYPES.join(", ")}.`,
      );
    }
    if (name.length === 0) {
      throw new ProposalError("Entity name is empty.");
    }
    unique.set(`${pick.type}\0${name}`, { name, type });
  }
  return [...unique.values()];
}

/**
 * Existing entities whose names appear in the proposal text: candidates for
 * the reviewer to link without typing names by hand.
 */
export async function entityCandidatesForProposal(
  text: string,
  limit = 50,
) {
  const rows = await db
    .select({ id: entities.id, name: entities.name, type: entities.type })
    .from(entities)
    .orderBy(asc(entities.name));
  const lower = text.toLowerCase();
  return rows
    .filter(
      (row) => row.name.length >= 2 && lower.includes(row.name.toLowerCase()),
    )
    .slice(0, limit);
}

/**
 * Reject a pending proposal: single update, reviewed_at recorded, row kept so
 * the same text can be recognized if it is proposed again. No transaction.
 */
export async function rejectProposal(proposalId: string) {
  const [row] = await db
    .update(memoryProposals)
    .set({ status: "rejected", reviewedAt: new Date() })
    .where(
      and(
        eq(memoryProposals.id, proposalId),
        eq(memoryProposals.status, "pending"),
      ),
    )
    .returning({ id: memoryProposals.id });

  if (!row) {
    throw new ProposalError(
      `No pending proposal with id ${proposalId} to reject`,
    );
  }

  return { id: row.id, status: "rejected" as const };
}

/**
 * Called by the extraction worker after a memory document's facts are
 * committed: points the chosen old fact's supersededBy at the document's
 * first new fact. Safe to call for any document (no-op without a proposal
 * link or a supersede choice).
 */
export async function applySupersededBy(docId: string): Promise<boolean> {
  const [proposal] = await db
    .select({ supersedesFactId: memoryProposals.supersedesFactId })
    .from(memoryProposals)
    .where(
      and(
        eq(memoryProposals.documentId, docId),
        eq(memoryProposals.status, "approved"),
      ),
    )
    .limit(1);

  if (!proposal?.supersedesFactId) return false;

  const [firstFact] = await db
    .select({ id: facts.id })
    .from(facts)
    .where(eq(facts.docId, docId))
    .orderBy(facts.createdAt, facts.id)
    .limit(1);

  if (!firstFact) return false;

  await db
    .update(facts)
    .set({ supersededBy: firstFact.id })
    .where(eq(facts.id, proposal.supersedesFactId));

  return true;
}

/** How many proposals this session submitted within the window (rate limiting). */
export async function countSessionProposals(
  sessionId: string,
  windowMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - windowMs);
  const rows = await db
    .select({ id: memoryProposals.id })
    .from(memoryProposals)
    .where(
      and(
        eq(memoryProposals.sessionId, sessionId),
        gt(memoryProposals.createdAt, cutoff),
      ),
    );

  return rows.length;
}

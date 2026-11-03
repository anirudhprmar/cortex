import { createHash } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "./index";
import { documents, facts, memoryProposals } from "./schema";

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

/**
 * Approve a pending proposal atomically: mint the memory:// source document
 * and flip the proposal to approved in one transaction. Facts are NOT written
 * here — extraction of the new document produces them through the normal
 * pipeline. Extraction must be enqueued by the caller AFTER this commits.
 */
export async function approveProposal(
  proposalId: string,
  opts: {
    /** Reviewer-edited text (from cortex review edit). Applied to the document only. */
    editedText?: string;
    /** Existing fact this approval supersedes; applied post-extraction. */
    supersedesFactId?: string | null;
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
  if (supersedesFactId) {
    const [factRow] = await db
      .select({ id: facts.id })
      .from(facts)
      .where(eq(facts.id, supersedesFactId))
      .limit(1);
    if (!factRow) {
      throw new ProposalError(`No fact with id ${supersedesFactId} to supersede`);
    }
  }

  const content = opts.editedText?.trim() || proposal.memory;
  if (content.length === 0) {
    throw new ProposalError("Approved text is empty");
  }
  const contentHash = createHash("sha256").update(content).digest("hex");
  // Level -> scope mapping for the source document: user -> personal,
  // project -> work.
  const scope = proposal.level === "project" ? "work" : "personal";

  const { docId } = await db.transaction(async (tx) => {
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

    return { docId: doc.id, contentHash };
  });

  return { proposalId: proposal.id, docId, contentHash, approved: content };
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

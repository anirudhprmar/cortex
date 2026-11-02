import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "./index";
import { memoryProposals } from "./schema";

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
    .orderBy(desc(memoryProposals.createdAt))
    .limit(10)

  if (!rows) {
    throw new Error("No proposals found");
  }

  return{ total: rows.length, allProposals: rows};
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

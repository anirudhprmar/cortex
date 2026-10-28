import type { JobPayload } from "queue";
import { publish } from "queue";
import { getDocumentById, replaceDocumentFacts } from "db";
import { extractMemories } from "extraction";
import { embedFactsForDocument } from "core";
import { chunkMd } from "./chunking";

const EXTRACTION_MODEL = "llama3.1:8b";

export const outcomes = { firstTry: 0, retried: 0, skipped: 0 };

/**
 * Process one document-extraction job. Using the job's content hash:
 * - document gone, or hash superseded by a newer job -> ack and skip
 * - otherwise chunk, extract, commit in one transaction
 * The consumer acks the job only when this handler resolves without throwing,
 * i.e. after the DB commit (or an accepted skip) succeeds.
 */
export async function handleExtractionJob(
  jobId: string,
  payload: JobPayload,
): Promise<void> {
  const docId = payload.docId;
  const contentHash = payload.contentHash;

  if (!docId || !contentHash) {
    console.error(
      `[SKIP] Job ${jobId} missing docId/contentHash fields:`,
      payload,
    );
    return;
  }

  const doc = await getDocumentById(docId);
  if (!doc) {
    console.error(`[SKIP] Document ${docId} no longer exists (job ${jobId})`);
    return;
  }

  if (doc.contentHash !== contentHash) {
    console.error(
      `[SKIP] Stale job ${jobId} for document ${docId}: a newer content version exists`,
    );
    return;
  }

  const chunks = chunkMd(doc.content, doc.path);
  const chunkInputs = [];

  for (const [ordinal, chunk] of chunks.entries()) {
    const result = await extractMemories(chunk.content);
    if (result.ok) {
      if (result.attempts === 1) outcomes.firstTry++;
      else outcomes.retried++;
      chunkInputs.push({
        headingPath: chunk.locator.headingPath,
        startLine: chunk.locator.lineRange.start,
        endLine: chunk.locator.lineRange.end,
        content: chunk.content,
        facts: result.facts,
      });
    } else {
      outcomes.skipped++;
      chunkInputs.push({
        headingPath: chunk.locator.headingPath,
        startLine: chunk.locator.lineRange.start,
        endLine: chunk.locator.lineRange.end,
        content: chunk.content,
        facts: [],
      });
      console.error(
        JSON.stringify(
          {
            event: "extraction_chunk_skipped",
            ordinal: ordinal + 1,
            documentPath: doc.path,
            raw: result.raw,
            reason: result.reason,
            issues: result.issues,
          },
          null,
          2,
        ),
      );
    }
  }

  await replaceDocumentFacts(
    docId,
    doc.scope,
    chunkInputs,
    EXTRACTION_MODEL,
    contentHash,
  );

  // Extraction committed; queue the embedding pass for this document's
  // new facts so vectors fill in without a global scan.
  await publish("fact-embedding", { docId });
}

/**
 * Process one fact-embedding job: embed the document's facts that don't
 * have a vector yet. Throws on failure so the job stays pending and is
 * retried by the consumer/reclaimer.
 */
export async function handleEmbeddingJob(
  jobId: string,
  payload: JobPayload,
): Promise<void> {
  const docId = payload.docId;
  if (!docId) {
    console.error(`[SKIP] Job ${jobId} missing docId field:`, payload);
    return;
  }

  const result = await embedFactsForDocument(docId);
  console.error(
    `[embedding] document ${docId}: ${result.embedded}/${result.pending} fact(s) embedded`,
  );
}

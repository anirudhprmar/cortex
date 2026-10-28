import { Command } from "commander";
import { hostname } from "node:os";
import { resolvePath } from "./path-resolve";
import { readFiles } from "./readfile";
import { consume, listProcessedJobs } from "queue";
import { handleEmbeddingJob, handleExtractionJob, outcomes } from "./worker";
import { entityProfile } from "core";
import { backfillFactEmbeddings } from "core";

const program = new Command();

/**
 * One result, two renderers: --json prints the payload alone on stdout so
 * scripts can parse it; the default prints the human-readable rendering.
 * Progress and diagnostics always go to stderr, never stdout.
 */
function emit(payload: unknown, human: () => void, json?: boolean) {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    human();
  }
}

/** One-shot commands exit explicitly: the queue/database clients keep their
 * connections open and would otherwise hang the process after printing. */
function exitNow() {
  process.exit(process.exitCode ?? 0);
}

program
  .name("cortex cli")
  .description("CLI to your memory layer")
  .version("0.1.0");

program
  .command("ingest")
  .argument("<path>", "file or folder to ingest")
  .option(
    "-s, --scope <name>",
    "type of note personal or work related",
    "personal",
  )
  .option("--json", "print the ingest result as JSON")
  .action(async (pathArg, opts) => {
    try {
      const abs = resolvePath(pathArg);
      const files = await readFiles(abs, opts.scope);
      const documents = files.map((f) => ({
        path: f.path,
        docId: f.docId,
        chunks: f.chunkCount,
      }));
      const totalChunks = documents.reduce((sum, d) => sum + d.chunks, 0);
      emit(
        { scope: opts.scope, documents, totalChunks },
        () =>
          console.log(
            `Ingested ${files.length} document(s) (${totalChunks} chunk(s)) from ${abs} [scope: ${opts.scope}] — extraction queued`,
          ),
        opts.json,
      );
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      exitNow();
    }
  });

program
  .command("profile")
  .description("Look up an entity and the facts about it")
  .argument("<name>", "entity name to look up")
  .option("-s, --scope <name>", "profile facts scoped to a scope")
  .option("--json", "print the profile result as JSON")
  .action(async (nameArg, opts) => {
    try {
      const result = await entityProfile({
        name: nameArg,
        ...(opts.scope ? { scope: opts.scope } : {}),
      });

      emit(
        result,
        () => {
          if (result.status === "notFound") {
            console.log(`No entity named "${nameArg}".`);
            return;
          }

          if (result.status === "ambiguous") {
            console.log(`"${nameArg}" matches multiple entities:`);
            result.entities.forEach((e, i) => {
              console.log(`  ${i + 1}. ${e.name} (${e.type})`);
            });
            return;
          }

          console.log(`${result.entity.name} — ${result.entity.type}`);
          if (result.facts.length === 0) {
            console.log("No facts recorded for this entity yet.");
            return;
          }
          for (const fact of result.facts) {
            console.log(
              `  • ${fact.claim}  [${fact.docPath}:${fact.startLine}-${fact.endLine}]`,
            );
          }
        },
        opts.json,
      );
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      exitNow();
    }
  });

program
  .command("embed")
  .description("Embed facts that don't have a vector yet")
  .option("--json", "print the embed result as JSON")
  .action(async (opts) => {
    try {
      const result = await backfillFactEmbeddings();
      emit(
        result,
        () =>
          console.log(
            `Pending: ${result.pending}, embedded: ${result.embedded}, failed: ${result.failed}`,
          ),
        opts.json,
      );
      if (result.failed > 0) process.exitCode = 1;
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      exitNow();
    }
  });

program
  .command("status")
  .description("List finished extraction jobs (acked recently, 7 day window)")
  .option("--json", "print processed jobs as JSON")
  .action(async (opts) => {
    try {
      const jobs = await listProcessedJobs("document-extraction", "extraction");
      const entries = Object.entries(jobs).map(([jobId, info]) => {
        const { consumer, completedAt } = JSON.parse(info);
        return { jobId, consumer, completedAt };
      });
      emit(
        entries,
        () => {
          if (entries.length === 0) {
            console.log("No processed jobs recorded.");
            return;
          }
          for (const entry of entries) {
            console.log(
              `${entry.jobId}  consumer=${entry.consumer}  completedAt=${entry.completedAt}`,
            );
          }
        },
        opts.json,
      );
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      exitNow();
    }
  });

program
  .command("work")
  .description("Consume document-extraction jobs until interrupted")
  .option(
    "-n, --name <name>",
    "stable consumer name so restarts recover their own pending jobs",
    process.env.WORKER_NAME ?? hostname(),
  )
  .option("--json", "print the final work summary as JSON")
  .action(async (opts) => {
    const controller = new AbortController();
    const shutdown = () => controller.abort();
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.error(`[worker] ${opts.name} consuming document-extraction (Ctrl+C to stop)`);

    try {
      await Promise.all([
        consume("document-extraction", "extraction", handleExtractionJob, {
          signal: controller.signal,
          consumerName: opts.name,
        }),
        consume("fact-embedding", "embedding", handleEmbeddingJob, {
          signal: controller.signal,
          consumerName: opts.name,
        }),
      ]);
    } finally {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      emit(
        { firstTry: outcomes.firstTry, retried: outcomes.retried, skipped: outcomes.skipped },
        () =>
          console.error(
            `Extraction totals: ${outcomes.firstTry} parsed first try, ${outcomes.retried} parsed on retry, ${outcomes.skipped} skipped.`,
          ),
        opts.json,
      );
    }
  });

await program.parseAsync();

import { Command } from "commander";
import { hostname } from "node:os";
import { resolvePath } from "./path-resolve";
import { readFiles } from "./readfile";
import { consume, listProcessedJobs } from "queue";
import { handleExtractionJob, outcomes } from "./worker";
import { entityProfile } from "core";

const program = new Command();

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
  .action(async (pathArg, opts) => {
    try {
      const abs = resolvePath(pathArg);
      const files = await readFiles(abs, opts.scope);
      const totalChunks = files.reduce((sum, f) => sum + f.chunkCount, 0);
      console.log(
        `Ingested ${files.length} document(s) (${totalChunks} chunk(s)) from ${abs} [scope: ${opts.scope}] — extraction queued`,
      );
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command("profile")
  .description("Look up an entity and the facts about it")
  .argument("<name>", "entity name to look up")
  .option("-s, --scope <name>", "profile facts scoped to a scope")
  .action(async (nameArg, opts) => {
    try {
      const result = await entityProfile({
        name: nameArg,
        ...(opts.scope ? { scope: opts.scope } : {}),
      });

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
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      // The queue/database clients (imported eagerly at module top) keep
      // their connections alive, preventing the process from exiting.
      process.exit(process.exitCode ?? 0);
    }
  });

program
  .command("status")
  .description("List finished extraction jobs (acked recently, 7 day window)")
  .action(async () => {
    const jobs = await listProcessedJobs("document-extraction", "extraction");
    const entries = Object.entries(jobs);
    if (entries.length === 0) {
      console.log("No processed jobs recorded.");
      return;
    }
    for (const [jobId, info] of entries) {
      const { consumer, completedAt } = JSON.parse(info);
      console.log(`${jobId}  consumer=${consumer}  completedAt=${completedAt}`);
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
  .action(async (opts) => {
    const controller = new AbortController();
    const shutdown = () => controller.abort();
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.log(`[worker] ${opts.name} consuming document-extraction (Ctrl+C to stop)`);

    try {
      await consume("document-extraction", "extraction", handleExtractionJob, {
        signal: controller.signal,
        consumerName: opts.name,
      });
    } finally {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      console.log(
        `Extraction totals: ${outcomes.firstTry} parsed first try, ${outcomes.retried} parsed on retry, ${outcomes.skipped} skipped.`,
      );
    }
  });

await program.parseAsync();

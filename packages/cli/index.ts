import { Command } from "commander";
import { hostname } from "node:os";
import { resolvePath } from "./path-resolve";
import { readFiles } from "./readfile";
import { handleEmbeddingJob, handleExtractionJob, outcomes } from "./worker";
import { entityProfile, keywordSearch } from "core";
import { backfillFactEmbeddings } from "core";
import { listProposals } from "db";

const program = new Command();

function emit(payload: unknown, human: () => void, json?: boolean) {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    human();
  }
}

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
  .option(
    "-p, --project <rootPath>",
    "high level type of memory: user level or project level",
    ""
)
  .option("--json", "print the ingest result as JSON")
  .action(async (pathArg, opts) => {
    try {
      const abs = resolvePath(pathArg);
      const files = await readFiles(abs, opts.scope, opts.project);
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
  .command("search")
  .description("Full-text keyword search over fact claims")
  .argument("<query>", "search terms to match against fact claims")
  .option("-s, --scope <name>", "restrict search to a scope")
  .option(
    "-p, --project <rootPath>",
    "restrict to project-level facts from this project root path (omit for both levels)",
  )
  .option("-n, --limit <count>", "maximum results to return", "20")
  .option("--json", "print the search results as JSON")
  .action(async (queryArg, opts) => {
    try {
      const limit = Number.parseInt(opts.limit, 10);
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error(`Invalid --limit: ${opts.limit}`);
      }

      const results = await keywordSearch(queryArg, {
        ...(opts.scope ? { scopes: [opts.scope] } : {}),
        ...(opts.project ? { projectKey: opts.project } : {}),
        limit,
      });

      emit(
        { query: queryArg, count: results.length, results },
        () => {
          if (results.length === 0) {
            console.log(`No facts matching "${queryArg}".`);
            return;
          }
          for (const fact of results) {
            console.log(
              `  • ${fact.claim}  [${fact.docPath}:${fact.startLine}-${fact.endLine}]`,
            );
            if (fact.entityNames.length > 0) {
              console.log(`entities: ${fact.entityNames.join(", ")}`);
            }
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
  .command("profile")
  .description("Look up an entity and the facts about it")
  .argument("<name>", "entity name to look up")
  .option("-s, --scope <name>", "profile facts scoped to a scope")
  .option(
    "-p, --project <rootPath>",
    "profile project-level facts from this project root path (omit for both levels)",
  )
  .option("--json", "print the profile result as JSON")
  .action(async (nameArg, opts) => {
    try {
      const result = await entityProfile({
        name: nameArg,
        ...(opts.scope ? { scope: opts.scope } : {}),
        ...(opts.project ? { projectKey: opts.project } : {}),
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
      const { listProcessedJobs } = await import("queue");
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
      const { consume } = await import("queue");
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

program
  .command("review")
  .description("Review proposed memory before adding a new memory")
  .option("--json", "print the final work summary as JSON")
  .action(async (opts) => {
    const proposals = await listProposals()

    if (!proposals) return;
  });

await program.parseAsync();

import { Command } from "commander";
import { hostname } from "node:os";
import os from "node:os";
import { rmSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as readline from "node:readline";
import { resolvePath } from "./path-resolve";
import { readFiles } from "./readfile";
import { handleEmbeddingJob, handleExtractionJob, outcomes } from "./worker";
import { entityProfile, keywordSearch, nearestFacts } from "core";
import { backfillFactEmbeddings } from "core";
import {
  approveProposal,
  getProposal,
  listProposals,
  rejectProposal,
  type Proposal,
} from "db";

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

function printProposals(rows: { total: number; allProposals: Proposal[] }) {
  console.log(`${rows.total} pending proposal(s)`);
  if (rows.total === 0) {
    console.log("Nothing to review.");
    return;
  }
  rows.allProposals.forEach((prop, i) => {
    const created = prop.createdAt instanceof Date ? prop.createdAt.toISOString() : String(prop.createdAt);
    console.log(`\n${i + 1}. [${prop.id}] ${prop.agentName} · ${created}`);
    console.log(
      `   level: ${prop.level}${prop.projectKey ? `, project: ${prop.projectKey}` : ""}`,
    );
    console.log(`   ${prop.memory}`);
  });
  console.log(
    "\ncommands: approve <id> [supersede <factId>] | edit <id> [supersede <factId>] | reject <id> | list | quit",
  );
}

/* Known gap: if enqueue fails, the approved document exists with a null
   extracted_hash and no queued job. Re-running the enqueue or a startup sweep
   over documents with null extracted_hash fixes it. */
async function enqueueExtraction(
  docId: string,
  contentHash: string,
): Promise<"queued" | string> {
  try {
    const { publish } = await import("queue");
    await publish("document-extraction", { docId, contentHash });
    return "queued";
  } catch (err) {
    return `failed: ${(err as Error).message}`;
  }
}

/** Duplicate check before approving: closest existing facts, same level+project. */
async function showDuplicateCheck(
  text: string,
  projectKey: string | null,
  json: boolean,
): Promise<{ factId: string; claim: string; docPath: string; scope: string; similarity: number }[] | "unavailable"> {
  try {
    const matches = await nearestFacts(text, projectKey, 5);
    if (!json) {
      if (matches.length === 0) {
        console.log("No similar facts found — nothing looks duplicated.");
      } else {
        console.log("Closest existing facts:");
        for (const m of matches) {
          console.log(
            `  • [${m.factId}] similarity ${m.similarity.toFixed(2)}  ${m.claim}  (${m.docPath})`,
          );
        }
      }
    }
    return matches;
  } catch (err) {
    console.error(
      `[duplicate check unavailable] ${(err as Error).message} — proceeding without matches.`,
    );
    return "unavailable";
  }
}

function openInEditor(text: string): string | null {
  const file = path.join(os.tmpdir(), `cortex-proposal-${Date.now()}.txt`);
  writeFileSync(file, text);
  const editor =
    process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
  const res = spawnSync(editor, [file], { stdio: "inherit" });
  rmSync(file, { force: true });
  if (res.error) {
    console.error(`Failed to open editor "${editor}": ${res.error.message}`);
    return null;
  }
  return readFileSync(file, "utf-8").replace(/\r\n/g, "\n").trim();
}

type ApproveOptions = { supersede?: string | null; edit?: boolean; json?: boolean };

async function runApprove(proposalId: string, opts: ApproveOptions): Promise<void> {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error(`No proposal with id ${proposalId}`);
  if (proposal.status !== "pending") {
    throw new Error(`Proposal ${proposalId} is already ${proposal.status}`);
  }

  let text = proposal.memory;
  if (opts.edit) {
    const edited = openInEditor(text);
    if (!edited) throw new Error("Edited text is empty; approval aborted");
    text = edited;
  }

  const matches = await showDuplicateCheck(text, proposal.projectKey, !!opts.json);

  const result = await approveProposal(proposalId, {
    editedText: opts.edit ? text : undefined,
    supersedesFactId: opts.supersede ?? null,
  });

  const queued = await enqueueExtraction(result.docId, result.contentHash);
  emit(
    {
      proposalId: result.proposalId,
      docId: result.docId,
      approved: result.approved,
      supersede: opts.supersede ?? null,
      duplicatesChecked: matches === "unavailable" ? false : true,
      duplicateMatches: matches === "unavailable" ? [] : matches,
      queued,
    },
    () =>
      console.log(
        `Approved ${result.proposalId} → document ${result.docId} (extraction ${queued})`,
      ),
    opts.json,
  );
}

async function runReject(proposalId: string, json?: boolean): Promise<void> {
  const result = await rejectProposal(proposalId);
  emit(
    result,
    () => console.log(`Rejected ${result.id} (kept for future recognition)`),
    json,
  );
}

async function runReviewLoop() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (question: string) =>
    new Promise<string>((resolve) => rl.question(question, resolve));

  try {
    for (;;) {
      const line = (await ask("review> ")).trim();
      if (!line) continue;
      const tokens = line.split(/\s+/);
      const [verb, id, flag, flagValue] = tokens;

      try {
        if (verb === "quit" || verb === "q" || verb === "exit") break;
        else if (verb === "list") printProposals(await listProposals());
        else if (
          (verb === "approve" || verb === "edit") &&
          id &&
          (!flag || flag === "supersede")
        ) {
          await runApprove(id, {
            supersede: flag === "supersede" ? flagValue : null,
            edit: verb === "edit",
          });
          printProposals(await listProposals());
        } else if (verb === "reject" && id) {
          await runReject(id);
          printProposals(await listProposals());
        } else {
          console.log(
            "commands: approve <id> [supersede <factId>] | edit <id> [supersede <factId>] | reject <id> | list | quit",
          );
        }
      } catch (err) {
        console.error((err as Error).message);
      }
    }
  } finally {
    rl.close();
  }
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
  .description("List pending memory proposals, then interactively approve, edit, or reject")
  .option("--json", "print pending proposals as JSON and exit (non-interactive)")
  .action(async (opts) => {
    try {
      const proposals = await listProposals();
      if (opts.json) {
        emit(proposals, () => {}, true);
      } else {
        printProposals(proposals);
        if (proposals.total > 0) {
          await runReviewLoop();
        }
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      exitNow();
    }
  });

program
  .command("approve")
  .description("Approve a pending proposal: duplicate check, then create its memory:// source document and queue extraction")
  .argument("<proposalId>", "pending proposal id shown by cortex review")
  .option(
    "--supersede <factId>",
    "existing fact to supersede once the new document's facts are extracted",
  )
  .option("--edit", "open the proposal text in $EDITOR and approve the edited version")
  .option("--json", "print the approval result as JSON")
  .action(async (proposalId, opts) => {
    try {
      await runApprove(proposalId, opts);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      exitNow();
    }
  });

program
  .command("reject")
  .description("Reject a pending proposal (single update; the row is kept)")
  .argument("<proposalId>", "pending proposal id shown by cortex review")
  .option("--json", "print the rejection result as JSON")
  .action(async (proposalId, opts) => {
    try {
      await runReject(proposalId, opts.json);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      exitNow();
    }
  });

await program.parseAsync();

import { Command } from "commander";
import { resolvePath } from "./path-resolve";
import { readFiles } from "./readfile";
import { consume } from "queue";
import { handleExtractionJob, outcomes } from "./worker";

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
  .command("work")
  .description("Consume document-extraction jobs until interrupted")
  .action(async () => {
    const controller = new AbortController();
    const shutdown = () => controller.abort();
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    try {
      await consume("document-extraction", "extraction", handleExtractionJob, {
        signal: controller.signal,
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

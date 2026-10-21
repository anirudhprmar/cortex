import { Command } from "commander";
import { resolvePath } from "./path-resolve";
import { readFiles } from "./readfile";
import { chunkMd } from "./chunking";
import { extractMemories } from "extraction";
import { replaceDocumentFacts } from "db";

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
      const outcomes = { firstTry: 0, retried: 0, skipped: 0 };
      const totalChunks = files.reduce((sum, f) => sum + f.chunkCount, 0);
      console.log(
        `Ingested ${files.length} document(s) (${totalChunks} chunk(s)) from ${abs} [scope: ${opts.scope}]`,
      );
      for (const file of files) {
        const chunks = chunkMd(file.content, file.path);
        const chunkFacts = [];

        for (const [ordinal, chunk] of chunks.entries()) {
          const result = await extractMemories(chunk.content);
          if (result.ok) {
            if (result.attempts === 1) outcomes.firstTry++;
            else outcomes.retried++;
            chunkFacts.push({ ordinal, facts: result.facts });
          } else {
            outcomes.skipped++;
            chunkFacts.push({ ordinal, facts: [] });
            console.error(
              JSON.stringify(
                {
                  event: "extraction_chunk_skipped",
                  ordinal: ordinal + 1,
                  documentPath: file.path,
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
          file.docId,
          opts.scope,
          chunkFacts,
          "llama3.1:8b",
        );
      }

      console.log(
        `Extraction totals: ${outcomes.firstTry} parsed first try, ${outcomes.retried} parsed on retry, ${outcomes.skipped} skipped.`,
      );
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

await program.parseAsync();

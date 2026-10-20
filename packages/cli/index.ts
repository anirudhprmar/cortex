import { Command } from "commander";
import { resolvePath } from "./path-resolve";
import { readFiles } from "./readfile";
import { chunkMd } from "./chunking";
import { extractMemories } from "extraction";

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
        `Ingested ${files.length} document(s) (${totalChunks} chunk(s)) from ${abs} [scope: ${opts.scope}]`,
      );
      for (const file of files) {
        const chunks = chunkMd(file.content, file.path);

        for (const chunk of chunks) {
          const result = await extractMemories(chunk.content);
          console.log(JSON.stringify(result));
        }
      }

    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

await program.parseAsync();

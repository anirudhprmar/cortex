import { Command } from "commander";
import { resolvePath } from "./path-resolve";
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
  .action((pathArg, opts) => {
    try {
      const abs = resolvePath(pathArg);
      console.log(abs, opts.scope);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program.parse();

import matter from "gray-matter";
import path from "node:path";
import { z } from "zod";
import { getValidFiles } from "./getvalidfiles";
import { readFile as fsReadFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ingestDocument } from "db";
import { chunkMd } from "./chunking";
import { publish } from "queue";

const scopeSchema = z.enum(["work", "personal"]);

type ProcessedFile = {
  path: string;
  docId: string;
  hash: string;
  data: Record<string, unknown>;
  content: string;
  chunkCount: number;
};

function toDocFields(absPath: string, rawContent: string) {
  const parsed = matter(rawContent);
  const ext = path.extname(absPath).toLowerCase();
  const data = parsed.data as Record<string, unknown>;

  return {
    title:
      typeof data.title === "string"
        ? data.title
        : path.basename(absPath, ext),
    content: parsed.content,
    modality: (ext === ".txt" ? "text" : "markdown") as "markdown" | "text",
    data,
  };
}

export async function readFiles(
  dirPath: string,
  scope = "personal",
): Promise<ProcessedFile[]> {
  const docScope = scopeSchema.parse(scope);
  const stats = await stat(dirPath);
  const filePaths = stats.isFile() ? [dirPath] : await getValidFiles(dirPath);
  const processedFiles: ProcessedFile[] = [];

  for (const filePath of filePaths) {
    try {
      const absPath = path.resolve(filePath);
      const rawContent = await fsReadFile(absPath, "utf-8");

      const currentHash = createHash("sha256").update(rawContent).digest("hex");
      const fields = toDocFields(absPath, rawContent);
      const fileChunks = chunkMd(fields.content, absPath);

      const result = await ingestDocument(
        {
          path: absPath,
          title: fields.title,
          content: fields.content,
          contentHash: currentHash,
          modality: fields.modality,
          scope: docScope,
        },
        fileChunks.map((chunk) => ({
          headingPath: chunk.locator.headingPath,
          startLine: chunk.locator.lineRange.start,
          endLine: chunk.locator.lineRange.end,
          content: chunk.content,
        })),
      );

      if (result.skipped) {
        console.log(`[SKIP] No changes detected: ${absPath}`);
        continue;
      }
      if (result.shouldEnqueue) {
        await publish("document-extraction", {
          docId: result.docId,
          contentHash: currentHash,
        });
      }

      const label = result.isNew ? "NEW" : "CHANGED";
      const verb = result.isNew ? "Added" : "Updated";
      console.log(
        `[${label}] ${verb} document: ${absPath} (id: ${result.docId}, chunks: ${result.chunkCount})`,
      );

      processedFiles.push({
        path: absPath,
        docId: result.docId,
        hash: currentHash,
        data: fields.data,
        content: fields.content,
        chunkCount: result.chunkCount,
      });
    } catch (err) {
      console.error(`Failed to read file at ${filePath}:`, err);
    }
  }

  return processedFiles;
}

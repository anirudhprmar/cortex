import matter from "gray-matter";
import path from "node:path";
import { z } from "zod";
import { getValidFiles } from "./getvalidfiles";
import { readFile as fsReadFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getExistingDocFromDb, insertDoc, updateDoc } from "db";

const scopeSchema = z.enum(["work", "personal"]);

type ProcessedFile = {
  path: string;
  hash: string;
  data: Record<string, unknown>;
  content: string;
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

      const existingDoc = await getExistingDocFromDb(absPath);

      if (!existingDoc) {
        // State 1: No row exists -> New document
        const fields = toDocFields(absPath, rawContent);
        console.log(`[NEW] Adding document: ${absPath}`);

        await insertDoc({
          path: absPath,
          title: fields.title,
          content: fields.content,
          contentHash: currentHash,
          modality: fields.modality,
          scope: docScope,
        });
        processedFiles.push({
          path: absPath,
          hash: currentHash,
          data: fields.data,
          content: fields.content,
        });
      } else if (existingDoc.contentHash === currentHash) {
        // State 2: Hash matches -> Skip it
        console.log(`[SKIP] No changes detected: ${absPath}`);
      } else {
        // State 3: Hash differs -> Changed document
        const fields = toDocFields(absPath, rawContent);
        console.log(`[CHANGED] Updating document: ${absPath}`);

        await updateDoc(
          {
            title: fields.title,
            content: fields.content,
            contentHash: currentHash,
            modality: fields.modality,
            scope: docScope,
          },
          absPath,
        );
        processedFiles.push({
          path: absPath,
          hash: currentHash,
          data: fields.data,
          content: fields.content,
        });
      }
    } catch (err) {
      console.error(`Failed to read file at ${filePath}:`, err);
    }
  }

  return processedFiles;
}

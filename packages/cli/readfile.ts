import matter from "gray-matter";
import path from "node:path";
import { getValidFiles } from "./getvalidfiles";
import { readFile as fsReadFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";

type ProcessedFile = {
  path: string;
  hash: string;
  data: Record<string, unknown>;
  content: string;
};

type ExistingDoc = { hash: string } | null;

// TODO: replace with real DB lookup by absolute path.
// const existingDoc = await getExistingDocFromDb(absPath);
async function getExistingDocFromDb(_absPath: string): Promise<ExistingDoc> {
  return null;
}

export async function readFiles(dirPath: string): Promise<ProcessedFile[]> {
  const stats = await stat(dirPath);
  const filePaths = stats.isFile() ? [dirPath] : await getValidFiles(dirPath);
  const processedFiles: ProcessedFile[] = [];

  for (const filePath of filePaths) {
    try {
      const absPath = path.resolve(filePath);
      const rawContent = await fsReadFile(absPath, "utf-8");

      const currentHash = createHash("sha256").update(rawContent).digest("hex");

      //query db to see if doc exists with its absolute path
      const existingDoc = await getExistingDocFromDb(absPath);

      if (!existingDoc) {
        // State 1: No row exists -> New document
        const parsed = matter(rawContent);
        console.log(`[NEW] Adding document: ${absPath}`);

        // TODO: Insert into DB -> (absPath, currentHash, parsed.data, parsed.content)
        processedFiles.push({
          path: absPath,
          hash: currentHash,
          data: parsed.data as Record<string, unknown>,
          content: parsed.content,
        });
      } else if (existingDoc.hash === currentHash) {
        // State 2: Hash matches -> Skip it
        console.log(`[SKIP] No changes detected: ${absPath}`);
      } else {
        // State 3: Hash differs -> Changed document
        const parsed = matter(rawContent);
        console.log(`[CHANGED] Updating document: ${absPath}`);
        // TODO: Update DB row -> Set hash = currentHash, content = parsed.content, etc.
        processedFiles.push({
          path: absPath,
          hash: currentHash,
          data: parsed.data as Record<string, unknown>,
          content: parsed.content,
        });
      }
    } catch (err) {
      console.error(`Failed to read file at ${filePath}:`, err);
    }
  }

  return processedFiles;
}

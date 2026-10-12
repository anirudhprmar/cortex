import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function getValidFiles(dirPath: string): Promise<string[]> {
  let results: string[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      if (entry.isDirectory()) {
        const subdir = await getValidFiles(fullPath);
        results.push(...subdir);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".md") || entry.name.endsWith(".txt")) {
          results.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
  }

  return results;
}

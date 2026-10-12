import path from "path";
import fs from "fs";

export function resolvePath(file: string) {
  const absolutePath = path.resolve(file);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Path not found: ${absolutePath}`);
  }
  return absolutePath;
}

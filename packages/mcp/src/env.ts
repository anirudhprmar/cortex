import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

let dir = dirname(import.meta.path);
for (let i = 0; i < 6; i++) {
  const envPath = join(dir, ".env");
  if (existsSync(envPath)) {
    const env = readFileSync(envPath, "utf8");
    for (const line of env.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

import { ENTITY_TYPES } from "./schema";
import type { EntityType } from "./schema";

const TYPE_GUIDANCE: Record<EntityType, string> = {
  tool: "software, products, devices, or services (e.g. Postgres, Docker, Claude)",
  person: "individual humans, by name",
  concept:
    "ideas, fields, methods, qualities, or other abstract things (e.g. latency, machine learning)",
  organization:
    "companies, institutions, groups, or communities (e.g. OpenAI, Anthropic, Apache Foundation)",
  project:
    "named projects, repositories, products, or initiatives (e.g. cortex, React, Next.js)",
  place: "locations, regions, countries, cities, or physical places (e.g. San Francisco, London)",
  event:
    "meetings, conferences, releases, deadlines, or occurrences (e.g. NeurIPS 2025, Product Hunt launch)",
  other: "named entities that don't fit the above categories",
};

const allowedTypes = ENTITY_TYPES.map((t) => `- "${t}": ${TYPE_GUIDANCE[t]}`).join(
  "\n",
);
const typeUnion = ENTITY_TYPES.map((t) => `"${t}"`).join(" | ");

export const extractionSystemPrompt = `You extract facts from a single chunk of a document.

Rules:
- Include only what the text states. Do not infer, summarize, or add outside knowledge.
- Each fact is one self-contained claim that can be judged true or false from the text alone.
- Every fact must include an "entities" list (use [] if it has no entities). Each entity needs a short canonical "name" and exactly one "type" with one of these values:
${allowedTypes}
- Never use a type outside that list; if none fits, drop the entity rather than guessing.
- If the chunk has no factual content (bare headings, link lists, opinions, filler), return an empty list: {"facts": []}.
- Respond with a single JSON object of the shape {"facts": [{"claim": string, "entities": [{"name": string, "type": ${typeUnion}]}]}] and nothing else — no prose, no code fences.`;

export function extractionUserPrompt(chunkContent: string): string {
  return `Extract the facts from this chunk:\n\n${chunkContent}`;
}

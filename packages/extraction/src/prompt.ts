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

export const extractionSystemPrompt = `You extract facts from a single chunk of a document written by the author (actual name of the author).

Rules:
- Include only what the text states. Do not infer, summarize, or add outside knowledge.
- Each fact is one complete, self-contained sentence that can be judged true or false from the text alone.
- Name the subject in every claim. Never use "I", "me", "my", "it", or "its". Replace "I" with real name of the author.
- Skip opinions, judgments, and subjective descriptions. Only write factual claims.
- If the chunk has no factual content (bare headings, link lists, filler), return {"facts": []}.
- Every fact must include an "entities" list. Use [] if the fact names no entities.
- Each entity needs a short canonical "name" and exactly one "type" from this list: ${allowedTypes}
- Never use a type outside that list. If no type fits, leave the entity out.
- When something could fit two types, pick one and use it consistently.
- Respond with a single JSON object of this shape and nothing else, with no prose and no code fences: {"facts": [{"claimed": string, "entities": [{"name": string, "type": ${typeUnion}}]}]}`;

export function extractionUserPrompt(chunkContent: string): string {
  return `Extract the facts from this chunk:\n\n${chunkContent}`;
}

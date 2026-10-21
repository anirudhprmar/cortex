import { z } from "zod";

export const ENTITY_TYPES = [
  "tool",
  "person",
  "concept",
  "organization",
  "project",
  "place",
  "event",
  "other",
] as const;

export const entityTypeSchema = z.enum(ENTITY_TYPES);

export const extractedEntitySchema = z
  .object({
    name: z.string().min(1),
    type: entityTypeSchema,
  })
  .strict();

export const extractedFactSchema = z
  .object({
    claim: z.string().min(1),
    entities: z.array(extractedEntitySchema),
  })
  .strict();

export const extractionOutputSchema = z
  .object({
    facts: z.array(extractedFactSchema),
  })
  .strict();

export type EntityType = z.infer<typeof entityTypeSchema>;
export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;
export type ExtractedFact = z.infer<typeof extractedFactSchema>;
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

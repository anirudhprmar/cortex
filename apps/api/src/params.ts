import { z } from "zod";

const entityTypeSchema = z.enum([
  "tool",
  "person",
  "concept",
  "organization",
  "project",
  "place",
  "event",
  "other",
]);

const scopeSchema = z.string().min(1).optional();

const projectKeySchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().nullish(),
);

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  scope: scopeSchema,
});

export const documentsQuerySchema = listSchema.extend({
  projectKey: projectKeySchema,
});

export const entitiesQuerySchema = listSchema.extend({
  type: entityTypeSchema.optional(),
});

export const profileQuerySchema = z.object({
  name: z.string().min(1),
  scope: scopeSchema,
  projectKey: projectKeySchema,
});

export const graphQuerySchema = z.object({
  entity: z.string().min(1),
  depth: z.coerce.number().int().min(0).max(4).default(2),
  scope: scopeSchema,
});

export const timelineQuerySchema = listSchema;

export function parseQuery<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  return schema.parse(raw);
}

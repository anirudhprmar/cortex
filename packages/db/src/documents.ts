import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./index";
import { documents } from "./schema";

export async function getAllDocuments() {
  return db.select().from(documents);
}

export async function getExistingDocFromDb(absPath: string) {
  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.path, absPath));

  return rows[0] ?? null;
}

export const insertDocSchema = z.object({
  path: z.string().min(1),
  title: z.string().optional(),
  content: z.string(),
  contentHash: z.string().length(64),
  modality: z.enum(["markdown", "text"]).default("markdown"),
  scope: z.enum(["work", "personal"]).default("personal"),
});

export const updateDocSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  contentHash: z.string().length(64).optional(),
  modality: z.enum(["markdown", "text"]).optional(),
  scope: z.enum(["work", "personal"]).optional()
})

export type InsertDocProps = z.infer<typeof insertDocSchema>;

export type UpdateDocProps = z.infer<typeof updateDocSchema>;

export async function insertDoc(props: InsertDocProps) {
  const parsed = insertDocSchema.parse(props);

  const [row] = await db.insert(documents).values(parsed).returning();

  return row;
}

export async function updateDoc(props: UpdateDocProps, path:string) {
  const parsed = updateDocSchema.parse(props);

  const [row] = await db.update(documents).set(parsed).where(eq(documents.path,path)).returning()

  return row;
}
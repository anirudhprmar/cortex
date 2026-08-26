import { jsonb, pgTable, text, timestamp, varchar, vector } from "drizzle-orm/pg-core";

export const memories = pgTable('memories', {
  id: varchar('id', { length: 128 }).primaryKey(),
  scope: text('scope', { enum: ['user', 'project'] }).notNull(),
  scopeKey: text('scope_key'), // e.g. project root path, or null for user-level
  type: text('type', { enum: ['decision', 'preference', 'architecture_note', 'error_solution'] }).notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
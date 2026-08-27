import { createId } from "@paralleldrive/cuid2";
import { index, jsonb, pgTable, text, timestamp, unique, varchar, vector } from "drizzle-orm/pg-core";

export const memories = pgTable('memories', {
  id: varchar('id', { length: 128 }).primaryKey().$defaultFn(()=> createId()),
  projectId:text('project_id').notNull().references(()=> projects.id,{onDelete: "cascade"}),
  scopeKey: text('scope_key'), 
  type: text('type', { enum: ['decision', 'preference', 'architecture_note', 'error_solution'] }).notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
        .$defaultFn(() => new Date())
        .$onUpdateFn(() => new Date())
        .notNull()
}, (t) => [
  index('project_id_idx').on(t.projectId),
  index('memory_type_idx').on(t.type),
  index('memory_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops'))
]
)

export const projects = pgTable('projects', {
  id: varchar('id', { length: 128 }).primaryKey().$defaultFn(()=> createId()),
  name: text('name').notNull(),
  rootPath:text('root_path').notNull().unique(),
  metadata:jsonb('metadata'),
  createdAt:timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
        .$defaultFn(() => new Date())
        .$onUpdateFn(() => new Date())
        .notNull()
}, (t) => [index('project_name_idx').on(t.name)]
)
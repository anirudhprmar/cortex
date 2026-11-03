import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
  vector,
  integer,
  unique,
  type AnyPgColumn,
  primaryKey,
} from "drizzle-orm/pg-core";

export const documents = pgTable("documents", {
  id: varchar("id", { length: 128 })
    .primaryKey()
    .$defaultFn(() => createId()),
  path: text("path").notNull().unique(),
  title: text("title"),
  content: text("content").notNull(),
  contentHash: text("contentHash").notNull(),
  extractedHash:text('extractedHash'),
  modality: text("modality", { enum: ["markdown", "text", "memory"] })
    .notNull()
    .default("markdown"),
  scope: text("scope", {enum: ["personal","work"]}).notNull().default("personal"),
  projectKey: text("projectKey"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())
    .notNull(),
});

export const chunks = pgTable(
  "chunks",
  {
    id: varchar("id", { length: 128 })
      .primaryKey()
      .$defaultFn(() => createId()),
    docId: varchar("docId", { length: 128 })
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    headingPath: text("headingPath").notNull(),
    startLine: integer("startLine").notNull(),
    endLine: integer("endLine").notNull(),
    content: text("content").notNull(),
  },
  (t) => [unique("chunks_doc_ordinal_uq").on(t.docId, t.ordinal)],
);

export const facts = pgTable(
  "facts",
  {
    id: varchar("id", { length: 128 })
      .primaryKey()
      .$defaultFn(() => createId()),
    claim: text("claim").notNull(),
    docId: varchar("docId", { length: 128 })
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkId: varchar("chunkId", { length: 128 })
      .notNull()
      .references(() => chunks.id, { onDelete: "set null" }),
    scope: text("scope").notNull(),
    projectKey: text("projectKey"), // null if a user fact and root path if a project fact
    observedAt: timestamp("observedAt"),
    validFrom: timestamp("validFrom"),
    validTo: timestamp("validTo"),
    supersededBy: varchar("supersededBy", { length: 128 }).references(
      (): AnyPgColumn => facts.id,
      { onDelete: "set null" },
    ),
    embedding: vector("embedding", { dimensions: 768 }),
    embeddingModel: text("embeddingModel"),
    extractionModel: text("extractionModel").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("facts_claim_fts_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.claim})`,
    ),
    index("facts_embedding_hnsw_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
    index("facts_doc_id_idx").on(t.docId),
    index("facts_chunk_id_idx").on(t.chunkId),
  ],
);

export const entities = pgTable(
  "entities",
  {
    id: varchar("id", { length: 128 })
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    type: text("type", { enum: ["tool", "person", "concept", "organization", "project", "place", "event","other"] }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("entities_name_type_uq").on(t.name, t.type)],
);

export const factEntities = pgTable(
  "factEntities",
  {
    factId: varchar("fact_id", { length: 128 })
      .notNull()
      .references(() => facts.id, { onDelete: "cascade" }),
    entityId: varchar("entity_id", { length: 128 })
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({
      columns: [t.factId, t.entityId],
    }),
    index("fact_entities_entity_id_idx").on(t.entityId),
  ],
);

export const factLinks = pgTable(
  "factLinks",
  {
    fromFactId: varchar("from_fact_id", { length: 128 })
      .notNull()
      .references(() => facts.id, { onDelete: "cascade" }),
    toFactId: varchar("to_fact_id", { length: 128 })
      .notNull()
      .references(() => facts.id, { onDelete: "cascade" }),
    relation: text("relation", {
      enum: ["supports", "contradicts", "related"],
    }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromFactId, t.toFactId, t.relation] }),
    index("fact_links_to_fact_id_idx").on(t.toFactId),
  ],
);

export const memoryProposals = pgTable(
  "memoryProposals",
  {
    id: varchar("id", { length: 128 })
      .primaryKey()
      .$defaultFn(() => createId()),
    memory: text("memory").notNull(),
    level: text("level", { enum: ["user", "project"] }).notNull(),
    projectKey: text("projectKey"),
    agentName: text("agentName").notNull(),
    sessionId: text("sessionId").notNull().default(""),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).default("pending").notNull(),
    documentId: text("documentId"),
    supersedesFactId: varchar("supersedesFactId", { length: 128 }).references(
      (): AnyPgColumn => facts.id,
      { onDelete: "set null" },
    ),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("memory_proposals_status").on(t.status)]
)

export const projects = pgTable(
  "projects",
  {
    id: varchar("id", { length: 128 })
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    rootPath: text("rootPath").notNull().unique(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date())
      .notNull(),
  },
  (t) => [index("project_name_idx").on(t.name)],
);


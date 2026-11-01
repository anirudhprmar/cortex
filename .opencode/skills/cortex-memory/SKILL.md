---
name: cortex-memory
description: Use when asked to remember, recall, store notes/facts/decisions, look up entities (people, projects, tools, concepts), or answer "what do I know about X" — queries the Cortex MCP memory layer (search_memory, get_profile, list_entities, add_document). Use ONLY for Cortex memory MCP tool usage, not for general repo search (use grep/glob for that).
---

# Cortex Memory MCP

Cortex is this repo's memory layer: documents are ingested, fact claims are
extracted from them, and entities are disambiguated. These MCP tools are the
agent-facing surface.

## Prerequisites

The tools work only when the backing services are up (run before relying on
them):

- Postgres + Redis: `docker compose up -d` (containers `cortex-postgres-1`,
  `cortex-redis-1`)
- A worker processing extraction/embedding jobs: `bun run --cwd packages/cli
  work` (facts won't appear until extraction completes; give it a few seconds)

If a tool returns `{ "isError": true }` with text starting
`Failed query:` the DB/Redis are likely down, not the query.

## Tools

### search_memory — keyword search over fact claims

Use for recall of statements across ingested documents.

| arg | kind | notes |
|-----|------|-------|
| `query` | string, required | term-match syntax; natural language works, engine is Postgres FTS English |
| `scopes` | string[], optional | filter by scope (`personal`, `work`); omit to search all |
| `limit` | number, default 10 | |

Returns JSON array of hits: `{ factId, claim, entityNames, docPath,
startLine, endLine, headingPath, scope, rank }`. `docPath` + line range gives
a precise file reference you can read directly.

### get_profile — everything known about one entity

Use to build a narrative about a person/project/tool instead of reading many
search hits.

| arg | kind | notes |
|-----|------|-------|
| `name` | string, required | case-insensitive exact match |
| `scope` | string, optional | |

Results are one of: `{ status: "notFound" }`, `{ status: "ambiguous",
entities: [...] }` (resolve by name with type disambiguation, re-asking if
needed), or `{ status: "found", entity, facts: [...] }` grouped by document,
in reading order.

### list_entities — enumerate known entities

Use to discover memory vocabulary before profiling, or to answer "what do I
know in general".

| arg | kind | notes |
|-----|------|-------|
| `type` | enum, optional | `person \| project \| tool \| concept \| organization \| place \| event \| other` |
| `limit` | number, default 50 | |

Returns entities with live (non-superseded) fact counts, most-used first.

### add_document — store new knowledge

Use when the user says "remember this", or asks to keep notes/decisions.
Content should be markdown; put the important statements as clear declarative
sentences, because they are what gets extracted as facts by the LLM.
Frontmatter and style do not carry; sentences do.

| arg | kind | notes |
|-----|------|-------|
| `content` | string, required | full markdown body |
| `title` | string, optional | influences storage path slug |
| `path` | string, optional | `mcp/<slug>.md` by default; same path + same content hash dedupes |
| `scope` | enum, default `personal` | `personal` \| `work` |

Result: `{ skipped, isNew, docId, chunkCount, shouldEnqueue, path, queued }`.
`queued: "yes"` means extraction is async — facts are searchable after the
worker processes the job (usually seconds once `cortex work` is running).
Same content at the same path returns `skipped: true`.

## Workflows

Recall a topic:
1. `search_memory` with the topic → hits (each hit lists `entityNames`)
2. If naming a specific entity matters, `get_profile` with its name
3. If nothing found, `list_entities` to see what vocabulary exists before
   concluding "nothing stored"

Store knowledge:
1. Compose clean markdown with self-contained facts
2. `add_document`
3. If the response says queued, poll with a short `search_memory` on a key
   phrase until the fact shows up (or just inform the user it'll be
   extractable shortly)
4. Update the same `path` to replace a document's facts atomically — the
   whole doc is re-extracted, superseding old claims

## Rules of thumb

- Never fabricate facts that no tool returned — cite the `claim` text and
  `docPath:line` from results.
- `search` is keyword/FTS based; it does not paraphrase. Retries should try
  alternate keywords rather than rephrasing into synonyms only.
- Extraction is LLM-based (local Ollama), so "facts" can be imperfect —
  surface the source so the user can judge.

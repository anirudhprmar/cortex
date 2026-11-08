# Cortex

Cortex is an AI memory layer that ingests notes and documents, extracts durable facts, and makes them searchable for agents over MCP.

## Tech Stack

- **API**: Hono
- **Parsing**: tree-sitter, remark / unified
- **Graph**: Neo4j or Memgraph
- **Database**: PostgreSQL + Drizzle ORM
- **Vector Search**: pgvector
- **Queue**: Redis (ioredis)
- **AI**: Vercel AI SDK + LiteLLM (Ollama provider)
- **MCP**: Model Context Protocol SDK
- **CLI**: Commander
- **Validation**: Zod
- **Infra**: Docker

## Project Structure

This is a Turborepo monorepo managed with Bun.

```
apps/
  api/        Hono API server
  web/        Web frontend
packages/
  cli/        CLI for ingesting and managing notes
  core/       Shared AI/logic layer (Vercel AI SDK)
  db/         Drizzle schema, migrations, and DB scripts
  extraction/ Fact/entity extraction pipeline
  mcp/        MCP server (stdio) exposing Cortex to agents
  queue/      Redis-backed job queue
  ui/         Shared UI components
  eslint-config/
  typescript-config/
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Node.js](https://nodejs.org) >= 24
- [Docker](https://www.docker.com)

### Setup

```bash
# Install dependencies
bun install

# Start infrastructure (Postgres, Redis, graph DB, etc.)
bun run docker:up

# Run in dev mode
bun run dev
```

Copy `.env.example` to `.env` and fill in the required values (database URL, Redis, model provider, etc.).

### Scripts

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `bun run dev`       | Run all apps in dev mode             |
| `bun run build`     | Build all packages                   |
| `bun run lint`      | Lint all packages                    |
| `bun run format`    | Format with Prettier                 |
| `bun run check-types` | Typecheck all packages             |
| `bun run docker:up` | Start infrastructure via Docker Compose |
| `bun run docker:down` | Stop infrastructure                |

### Database

Drizzle Kit scripts live in `packages/db`:

```bash
bun run db:generate   # Generate migrations
bun run db:migrate    # Apply migrations
bun run db:push       # Push schema directly
bun run db:studio     # Open Drizzle Studio
```

### MCP Server

Expose your memory to MCP-compatible agents:

```bash
bun run --cwd packages/mcp mcp:stdio
```

## License

MIT — see [LICENSE](./LICENSE).

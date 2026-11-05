import { Hono } from "hono";
import {
  entityGraph,
  entityProfile,
  getDocumentById,
  getStatusOverview,
  getTimeline,
  listDocuments,
  listEntities,
} from "core";

const app = new Hono();

const listParams = (url: URL) => {
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  return {
    limit: Number.isInteger(limit) ? limit : 50,
    offset: Number.isInteger(offset) ? offset : 0,
  };
};

const scopeParam = (url: URL) => url.searchParams.get("scope") ?? undefined;

const projectKeyParam = (url: URL) => {
  if (!url.searchParams.has("projectKey")) return undefined;
  const value = url.searchParams.get("projectKey");
  return value === "" ? null : value;
};

const notFound = (c: { json: (body: unknown, status?: number) => Response }) =>
  c.json({ error: "not found" }, 404);

app.get("/", (c) =>
  c.json({
    name: "cortex-api",
    endpoints: [
      "GET /status",
      "GET /documents",
      "GET /documents/:id",
      "GET /entities",
      "GET /entity-profile?name=<name>",
      "GET /timeline",
      "GET /graph?entity=<name>&depth=<0..4>",
    ],
  }),
);

app.get("/status", async (c) => c.json(await getStatusOverview()));

app.get("/documents", async (c) => {
  const url = new URL(c.req.url);
  return c.json(
    await listDocuments({
      scope: scopeParam(url),
      projectKey: projectKeyParam(url),
      ...listParams(url),
    }),
  );
});

app.get("/documents/:id", async (c) => {
  const document = await getDocumentById(c.req.param("id"));
  if (!document) return notFound(c);
  return c.json(document);
});

app.get("/entities", async (c) => {
  const url = new URL(c.req.url);
  const type = c.req.query("type");
  let entityIdType: import("db").entities.$inferSelect["type"] | undefined;
  const validTypes = [
    "tool",
    "person",
    "concept",
    "organization",
    "project",
    "place",
    "event",
    "other",
  ] as const;
  if (type) {
    if (!(validTypes as readonly string[]).includes(type)) {
      return c.json(
        { error: `type must be one of ${validTypes.join(", ")}` },
        400,
      );
    }
    entityIdType = type as (typeof validTypes)[number];
  }
  return c.json(
    await listEntities({ type: entityIdType, ...listParams(url) }),
  );
});

app.get("/entity-profile", async (c) => {
  const url = new URL(c.req.url);
  const name = url.searchParams.get("name");
  if (!name) return c.json({ error: "name query param is required" }, 400);

  const result = await entityProfile({
    name,
    scope: scopeParam(url),
    projectKey: projectKeyParam(url),
  });
  if (result.status === "notFound") return c.json(result, 404);
  if (result.status === "ambiguous") return c.json(result, 409);
  return c.json(result);
});

app.get("/graph", async (c) => {
  const url = new URL(c.req.url);
  const entity = url.searchParams.get("entity");
  if (!entity) return c.json({ error: "entity query param is required" }, 400);

  const depthParam = Number(url.searchParams.get("depth") ?? "2");
  const depth = Number.isInteger(depthParam) ? depthParam : 2;
  if (depth < 0 || depth > 4) {
    return c.json({ error: "depth must be between 0 and 4" }, 400);
  }

  const result = await entityGraph({
    entityName: entity,
    depth,
    scope: scopeParam(url),
  });
  if (result.status === "notFound") return c.json(result, 404);
  if (result.status === "ambiguous") return c.json(result, 409);
  return c.json(result);
});

app.get("/timeline", async (c) => {
  const url = new URL(c.req.url);
  return c.json(await getTimeline({ scope: scopeParam(url), ...listParams(url) }));
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: (err as Error).message }, 500);
});

export default app;

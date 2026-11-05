import { Hono } from "hono";
import { ZodError } from "zod";
import {
  entityGraph,
  entityProfile,
  getDocumentById,
  getStatusOverview,
  getTimeline,
  listDocuments,
  listEntities,
} from "core";
import {
  documentsQuerySchema,
  entitiesQuerySchema,
  graphQuerySchema,
  parseQuery,
  profileQuerySchema,
  timelineQuerySchema,
} from "./params";

const app = new Hono();

const queryFromSearch = (url: URL): Record<string, string> =>
  Object.fromEntries(url.searchParams.entries());

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: err.issues[0]?.message ?? "invalid request" }, 400);
  }
  console.error(err);
  return c.json({ error: (err as Error).message }, 500);
});

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

app.get("/documents", async (c) =>
  c.json(
    await listDocuments(
      parseQuery(documentsQuerySchema, queryFromSearch(new URL(c.req.url))),
    ),
  ),
);

app.get("/documents/:id", async (c) => {
  const document = await getDocumentById(c.req.param("id"));
  if (!document) return c.json({ error: "not found" }, 404);
  return c.json(document);
});

app.get("/entities", async (c) =>
  c.json(
    await listEntities(
      parseQuery(entitiesQuerySchema, queryFromSearch(new URL(c.req.url))),
    ),
  ),
);

app.get("/entity-profile", async (c) => {
  const url = new URL(c.req.url);
  const query = parseQuery(profileQuerySchema, queryFromSearch(url));
  const result = await entityProfile(query);
  if (result.status === "notFound") return c.json(result, 404);
  if (result.status === "ambiguous") return c.json(result, 409);
  return c.json(result);
});

app.get("/graph", async (c) => {
  const url = new URL(c.req.url);
  const query = parseQuery(graphQuerySchema, queryFromSearch(url));
  const result = await entityGraph({ ...query, entityName: query.entity });
  if (result.status === "notFound") return c.json(result, 404);
  if (result.status === "ambiguous") return c.json(result, 409);
  return c.json(result);
});

app.get("/timeline", async (c) =>
  c.json(
    await getTimeline(
      parseQuery(timelineQuerySchema, queryFromSearch(new URL(c.req.url))),
    ),
  ),
);

export default app;

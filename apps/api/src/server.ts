import app from "./app";

const port = Number(process.env.API_PORT ?? 4000);
console.log(`cortex-api listening on http://localhost:${port}`);

Bun.serve({
  port,
  idleTimeout: 255,
  fetch: app.fetch,
});

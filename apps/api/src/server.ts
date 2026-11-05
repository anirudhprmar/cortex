import app from "./app";

const port = Number(process.env.API_PORT ?? 4000);
console.log(`cortex-api listening on http://127.0.0.1:${port}`);

Bun.serve({
  port,
  hostname: "127.0.0.1",
  idleTimeout: 255,
  fetch: app.fetch,
});

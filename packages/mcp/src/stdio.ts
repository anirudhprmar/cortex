#!/usr/bin/env bun
import "./env";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

const server = createServer();
await server.connect(new StdioServerTransport());

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

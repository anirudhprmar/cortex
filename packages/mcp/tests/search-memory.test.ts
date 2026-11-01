import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";

async function makeClient() {
  const server = createServer();
  const client = new Client({ name: "test", version: "0.0.1" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  await client.connect(clientT);
  return client;
}

describe("cortex mcp", () => {
  it("hello works", async () => {
    const client = await makeClient();
    const res = await client.callTool({
      name: "hello",
      arguments: { name: "bun" },
    });
    const content = (res.content as { type: string; text: string }[])[0]!;
    expect(content.text).toContain("bun");
  });

  it("expected tools are registered", async () => {
    const client = await makeClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("search_memory");
    expect(tools.map((t) => t.name)).toContain("get_profile");
    expect(tools.map((t) => t.name)).toContain("list_entities");
    expect(tools.map((t) => t.name)).toContain("add_document");
  });

  it("search_memory returns results", async () => {
    const client = await makeClient();
    const res = await client.callTool({
      name: "search_memory",
      arguments: { query: "test", limit: 5 },
    });
    // requires a running Postgres with ingested data
    const content = (res.content as { type: string; text: string }[])[0]!;
    expect(content).toBeTruthy();
    if (content.text.startsWith("Failed")) {
      console.warn("skipping: Postgres unreachable (is Docker up?)");
      return;
    }
    const parsed = JSON.parse(content.text) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });
});

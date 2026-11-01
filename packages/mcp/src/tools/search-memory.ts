import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as core from "core";

export function register(server: McpServer) {
  server.registerTool(
    "search_memory",
    {
      title: "Search Memory",
      description: "Search the user’s notes and memories before starting a task that might relate to something they’ve described before. Use this when the user mentions an idea, project, or decision by name, or refers to something they said earlier",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
        scopes: z
          .array(z.string())
          .optional()
          .describe("Scopes to search. Omit to search all scopes"),
        limit: z.number().default(10).describe("Max results"),
      }),
    },
    async ({ query, scopes, limit }) => {
      const results = await core.keywordSearch(query, { scopes, limit });
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );
}

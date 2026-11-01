import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listEntities } from "db";

export function register(server: McpServer) {
  server.registerTool(
    "list_entities",
    {
      title: "List Entities",
      description:
        "List the people, projects, tools, and concepts Cortex has stored from the user’s notes, with the number of facts for each. Use this when the user asks what Cortex knows or what they’ve recorded, or when you need the exact stored name of something before calling get_profile. Returns names and counts only, not facts. Optionally filter by type or limit the number of results.",
      inputSchema: z.object({
        type: z
          .enum([
            "tool",
            "person",
            "concept",
            "organization",
            "project",
            "place",
            "event",
            "other",
          ])
          .optional()
          .describe("Filter by entity type. Omit to list all"),
        limit: z.number().default(50).describe("Max entities to return"),
      }),
    },
    async ({ type, limit }) => {
      const results = await listEntities({ type, limit });
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
    }
  );
}

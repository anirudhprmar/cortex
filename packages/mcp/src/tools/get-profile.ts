import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as core from "core";

export function register(server: McpServer) {
  server.registerTool(
    "get_profile",
    {
      title: "Get Profile",
      description: "Get everything Cortex knows about one named person, project, tool, or concept. Use this when the user names a specific entity and asks about it, its status, or any update related to it. Returns the facts that mention that entity, each with its source file and lines. If several entities share the name, returns the candidates so you can ask the user which one they mean. If nothing matches, try search_memory with the same name before telling the user nothing is stored.",
      inputSchema: z.object({
        name: z.string().describe("Name profile"),
        scope: z
          .string()
          .optional()
          .describe("Scopes to search. Omit to search all scopes"),
        limit: z.number().default(10).describe("Max results"),
      }),
    },
    async ({ name, scope }) => {
      const results = await core.entityProfile({name,scope})
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
  );
}

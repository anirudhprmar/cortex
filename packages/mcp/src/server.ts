import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerTools } from "./tools";

export function createServer() {
  const server = new McpServer({
    name: "Cortex MCP",
    version: "0.1.0",
  });

  server.registerTool(
    "hello",
    {
      description: "Simple hello tool for testing",
      inputSchema: z.object({
        name: z.string().optional().describe("Name to greet"),
      }),
    },
    async ({ name }) => {
      return {
        content: [
          {
            type: "text",
            text: `Hello from the monorepo MCP, ${name ?? "World"}!`,
          },
        ],
      };
    }
  );

  registerTools(server);

  return server;
}

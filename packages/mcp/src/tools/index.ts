import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as searchMemory from "./search-memory";

export const tools = [searchMemory];

export function registerTools(server: McpServer) {
  for (const tool of tools) {
    tool.register(server);
  }
}

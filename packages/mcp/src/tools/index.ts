import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as addDocument from "./add-document";
import * as listEntities from "./list-entities";
import * as searchMemory from "./search-memory";
import * as getProfile from "./get-profile";

export const tools = [addDocument, listEntities, searchMemory, getProfile];

export function registerTools(server: McpServer) {
  for (const tool of tools) {
    tool.register(server);
  }
}

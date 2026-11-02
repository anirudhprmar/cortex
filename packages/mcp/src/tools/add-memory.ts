import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { countSessionProposals, insertProposal } from "db";

const MAX_MEMORY_CHARS = 2000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 30;

const SECRET_PATTERNS = ["sk-", "ghp_", "AKIA", "-----BEGIN"];

function reject(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

export function register(server: McpServer) {
  server.registerTool(
    "add_memory",
    {
      title: "Add Memory",
      description:
        "Propose one short, durable fact so it is saved for human review before it becomes searchable memory. Use this when the user states a preference, decision, status, or small fact worth remembering — one sentence at a time, not document dumps. The proposal is stored as pending until a human approves it; it cannot be searched yet.",
      inputSchema: z.object({
        memory: z
          .string()
          .describe("One short durable fact; long text belongs in add_document"),
        level: z
          .enum(["user", "project"])
          .default("user")
          .describe("High level type of memory: user level or project level"),
        projectKey: z
          .string()
          .nullish()
          .describe("Required when level is project (the project root path); must be omitted when level is user"),
        agentName: z
          .string()
          .default("mcp")
          .describe("Name of the agent proposing the memory"),
        sessionId: z
          .string()
          .describe("Stable identifier for this agent session; used for rate limiting"),
      }),
    },
    async ({ memory, level, projectKey, agentName, sessionId }) => {
      const trimmed = memory.trim();

      if (trimmed.length === 0) {
        return reject("Rejected: memory text is empty.");
      }
      if (memory.length > MAX_MEMORY_CHARS) {
        return reject(
          `Rejected: memory is ${memory.length} characters; keep proposals under ${MAX_MEMORY_CHARS} characters. Long text usually belongs in a document, not memory.`,
        );
      }

      const secretPattern = SECRET_PATTERNS.find((pattern) =>
        memory.includes(pattern),
      );
      if (secretPattern) {
        return reject(
          `Rejected: memory looks like it contains a secret (matched "${secretPattern}"). Remove the secret and propose the fact without including it.`,
        );
      }

      if (level === "project" && (!projectKey || projectKey.trim().length === 0)) {
        return reject(
          "Rejected: level is project, so projectKey (the project root path) is required.",
        );
      }
      if (level === "user" && projectKey) {
        return reject(
          "Rejected: level is user, so projectKey must be omitted or null.",
        );
      }

      const recent = await countSessionProposals(
        sessionId,
        RATE_LIMIT_WINDOW_MS,
      );
      if (recent >= RATE_LIMIT_MAX) {
        return reject(
          `Rejected: this session already sent ${recent} proposals in the last 15 minutes. Wait and propose later.`,
        );
      }

      const proposal = await insertProposal({
        memory: trimmed,
        level,
        projectKey: level === "project" ? projectKey! : null,
        agentName,
        sessionId,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              proposalId: proposal.id,
              result: "saved for review",
            }),
          },
        ],
      };
    },
  );
}

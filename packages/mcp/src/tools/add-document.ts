import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ingestDocument } from "db";
import { chunkMd } from "cli/chunking";

const scopeSchema = z.enum(["work", "personal"]);

function slugify(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "note";
}

export function register(server: McpServer) {
  server.registerTool(
    "add_document",
    {
      title: "Add Document",
      description:
        "Save a markdown or plain text note to Cortex so it can be searched later. Use this when the user asks you to remember, save, or add a note or file. Provide either a file path inside an allowed folder or the note’s text with a name. The note is stored and split into sections right away. Facts are extracted in the background and become searchable once that finishes, usually within a few minutes, so don’t search for something from a new note immediately. Returns the document ID and extraction status.",
      inputSchema: z.object({
        content: z.string().describe("Markdown content of the document"),
        title: z.string().optional().describe("Document title. Used in the storage path"),
        path: z
          .string()
          .optional()
          .describe("Storage path. Documents with the same path are deduplicated by content hash"),
        scope: scopeSchema.default("personal").describe("Memory scope"),
        projectKey: z
          .string()
          .nullish()
          .describe("Storage path. null (default) or omitted = user-level memory; a root path = project-level memory"),
      }),
    },
    async ({ content, title, path, scope, projectKey }) => {
      const docPath = path ?? `mcp/${slugify(title ?? "note")}.md`;
      const contentHash = createHash("sha256").update(content).digest("hex");
      const fileChunks = chunkMd(content, docPath);

      const result = await ingestDocument(
        {
          path: docPath,
          title: title ?? "mcp note",
          content,
          contentHash,
          modality: "markdown",
          scope,
          projectKey: projectKey ?? null,
        },
        fileChunks.map((chunk) => ({
          headingPath: chunk.locator.headingPath,
          startLine: chunk.locator.lineRange.start,
          endLine: chunk.locator.lineRange.end,
          content: chunk.content,
        })),
      );

      let queued: "skipped" | "yes" | string = "no";
      if (result.shouldEnqueue) {
        try {
          const { publish } = await import("queue");
          await publish("document-extraction", {
            docId: result.docId,
            contentHash,
          });
          queued = "yes";
        } catch (err) {
          queued = `failed: ${(err as Error).message}`;
        }
      } else if (result.skipped) {
        queued = "skipped";
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...result, path: docPath, queued }),
          },
        ],
      };
    }
  );
}

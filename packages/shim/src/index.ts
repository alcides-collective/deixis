#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { post, sessionId, label } from "./hub-client.js";

const statusEnum = z.enum(["pending", "active", "done", "failed", "blocked"]);
const stepSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    status: statusEnum,
    note: z.string().optional(),
    substeps: z.array(stepSchema).optional(),
  }),
);

function reply(err: string | null, okMsg: string) {
  return { content: [{ type: "text" as const, text: err ?? okMsg }] };
}

const server = new McpServer({ name: "deixis", version: "0.1.0" });

server.tool(
  "render_markdown",
  "Render Markdown to this session's Deixis canvas tab (replaces the markdown pane).",
  { markdown: z.string() },
  async ({ markdown }) =>
    reply(await post(`/session/${sessionId}/markdown`, { markdown }), "rendered"),
);

server.tool(
  "progress_set",
  "Define or replace this session's progress checklist (supports one level of substeps).",
  { steps: z.array(stepSchema) },
  async ({ steps }) =>
    reply(await post(`/session/${sessionId}/progress`, { steps }), "progress set"),
);

server.tool(
  "progress_update",
  "Update a single progress step's status (and optional note) without resending the list.",
  { stepId: z.string(), status: statusEnum, note: z.string().optional() },
  async ({ stepId, status, note }) =>
    reply(
      await post(`/session/${sessionId}/progress/update`, { stepId, status, note }),
      "step updated",
    ),
);

async function main() {
  await post(`/session/${sessionId}/register`, { label });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const bye = () => {
    void post(`/session/${sessionId}/disconnect`, {});
    process.exit(0);
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
  process.stdin.on("close", bye);
}

void main();

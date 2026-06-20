#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { post, getSessionId, label } from "./hub-client.js";

// The card is created lazily — only when the session actually uses a canvas
// tool. Sessions that never render produce no shim card (their telemetry card
// from the hook is enough), and id resolution is deferred to a point where it
// is reliable.
let registered = false;
async function ensureRegistered(): Promise<string | null> {
  if (registered) return null;
  const err = await post(`/session/${getSessionId()}/register`, { label });
  if (err) return err; // hub down — surface it; retry on the next call
  registered = true;
  return null;
}

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
    reply(
      (await ensureRegistered()) ??
        (await post(`/session/${getSessionId()}/markdown`, { markdown })),
      "rendered",
    ),
);

server.tool(
  "progress_set",
  "Define or replace this session's progress checklist (supports one level of substeps).",
  { steps: z.array(stepSchema) },
  async ({ steps }) =>
    reply(
      (await ensureRegistered()) ??
        (await post(`/session/${getSessionId()}/progress`, { steps })),
      "progress set",
    ),
);

server.tool(
  "progress_update",
  "Update a single progress step's status (and optional note) without resending the list.",
  { stepId: z.string(), status: statusEnum, note: z.string().optional() },
  async ({ stepId, status, note }) =>
    reply(
      (await ensureRegistered()) ??
        (await post(`/session/${getSessionId()}/progress/update`, { stepId, status, note })),
      "step updated",
    ),
);

async function main() {
  // No startup register — the card is created lazily on first canvas tool use.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  let exiting = false;
  const bye = async () => {
    if (exiting) return;
    exiting = true;
    // Safety net: never hang the process on a slow/hung hub.
    const safety = setTimeout(() => process.exit(0), 1000);
    safety.unref();
    try {
      // Only disconnect a card we actually created.
      if (registered) await post(`/session/${getSessionId()}/disconnect`, {});
    } catch {
      // best-effort; we're exiting regardless
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void bye());
  process.on("SIGINT", () => void bye());
  process.stdin.on("close", () => void bye());
}

void main();

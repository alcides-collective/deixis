#!/usr/bin/env node
const HUB_URL = process.env.DEIXIS_HUB_URL ?? "http://localhost:3939";

interface HookPayload {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  transcript_path?: string;
  tool_name?: string;
}

export function buildEvent(
  stdin: string,
  argv: string[],
): { sessionId: string; body: Record<string, unknown> } | null {
  let p: HookPayload = {};
  try {
    p = JSON.parse(stdin) as HookPayload;
  } catch {
    /* empty / non-JSON */
  }
  const sessionId = p.session_id;
  if (!sessionId) return null;
  const event = p.hook_event_name ?? argv[2] ?? "unknown";
  const body: Record<string, unknown> = { event };
  if (p.cwd) body.cwd = p.cwd;
  if (p.transcript_path) body.transcriptPath = p.transcript_path;
  if (p.tool_name) body.toolName = p.tool_name;
  return { sessionId, body };
}

async function main(): Promise<void> {
  // Safety net: never let the hook hang Claude Code.
  const safety = setTimeout(() => process.exit(0), 1500);
  safety.unref();
  try {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const parsed = buildEvent(Buffer.concat(chunks).toString("utf8"), process.argv);
    if (parsed) {
      // The hook's parent is the Claude Code process — report it for the
      // liveness sweep that detects finished sessions (Task 14).
      parsed.body.pid = process.ppid;
      await fetch(`${HUB_URL}/telemetry/${parsed.sessionId}/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.body),
        signal: AbortSignal.timeout(1000),
      });
    }
  } catch {
    /* hub down or any error — ignore */
  }
  process.exit(0);
}

// Only run when executed, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith("index.js")) void main();

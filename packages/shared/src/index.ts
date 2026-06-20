export type Status = "pending" | "active" | "done" | "failed" | "blocked";

export interface Step {
  id: string;
  name: string;
  status: Status;
  note?: string;
  substeps?: Step[];
  startedAt?: number; // epoch ms, stamped by the hub on -> active
  endedAt?: number;   // epoch ms, stamped by the hub on -> done | failed
}

export interface SessionState {
  sessionId: string;
  label: string;
  markdown: string;
  steps: Step[];
  connectedAt: number;
  online: boolean;
  hasCanvas: boolean;       // agent pushed markdown/progress
  hasTelemetry: boolean;    // hook/JSONL data present
  telemetry?: SessionTelemetry;
}

// ---- telemetry ----
export type TelemetryStatus =
  | "working" | "idle" | "waiting" | "errored" | "finished";

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface SessionTelemetry {
  status: TelemetryStatus;
  model?: string;
  usage: TokenUsage;
  costUsd: number | null;   // null when model pricing is unknown
  contextTokens: number;    // last-turn input + cache_read (current context size)
  statusSince: number;      // epoch ms when the status value last changed
  currentTool?: string;
  recentTools?: string[];   // newest first, capped
  lastMessage?: string;     // trimmed assistant snippet
  pid?: number;
  updatedAt: number;
}

// ---- shim -> hub request bodies ----
export interface RegisterBody { label: string }
export interface MarkdownBody { markdown: string }
export interface ProgressSetBody { steps: Step[] }
export interface ProgressUpdateBody { stepId: string; status: Status; note?: string }

// ---- hub -> browser SSE events ----
export type ServerEvent =
  | { type: "snapshot"; sessions: SessionState[] }
  | { type: "session"; session: SessionState }
  | { type: "remove"; sessionId: string };

// ---- display helpers ----
// snake_case / kebab-case → Title Case: progress_update → "Progress Update".
function humanize(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Format a raw Claude Code tool name for the UI:
//   mcp__deixis__progress_update → "◆ Progress Update"  (our own tools, branded)
//   mcp__todoist__add-tasks      → "todoist·Add Tasks"
//   Bash                         → "Bash"               (built-ins unchanged)
export function formatTool(name: string): string {
  if (!name.startsWith("mcp__")) return name;
  const rest = name.slice(5); // drop "mcp__"
  const sep = rest.indexOf("__");
  if (sep === -1) return humanize(rest); // malformed; best-effort
  const server = rest.slice(0, sep);
  const tool = humanize(rest.slice(sep + 2));
  return server === "deixis" ? `◆ ${tool}` : `${server}·${tool}`;
}

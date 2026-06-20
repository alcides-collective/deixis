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

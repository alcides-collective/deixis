import { EventEmitter } from "node:events";
import type { Step, Status, SessionState, ServerEvent, SessionTelemetry } from "@deixis/shared";

function findStep(steps: Step[], id: string): Step | undefined {
  for (const s of steps) {
    if (s.id === id) return s;
    if (s.substeps) {
      const f = findStep(s.substeps, id);
      if (f) return f;
    }
  }
  return undefined;
}

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, SessionState>();

  register(sessionId: string, label: string): SessionState {
    const unique = this.uniqueLabel(label || "session", sessionId);
    const state = this.ensureSession(sessionId, unique);
    state.label = unique;
    state.online = true;
    state.hasCanvas = true;
    this.emitSession(state);
    return state;
  }

  ensureSession(sessionId: string, label?: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        label: label ?? sessionId.slice(0, 8),
        markdown: "",
        steps: [],
        connectedAt: Date.now(),
        online: true,
        hasCanvas: false,
        hasTelemetry: false,
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  setTelemetry(sessionId: string, patch: Partial<SessionTelemetry>): SessionState {
    const state = this.ensureSession(sessionId);
    const base: SessionTelemetry = state.telemetry ?? {
      status: "idle",
      usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      costUsd: null,
      contextTokens: 0,
      statusSince: Date.now(),
      updatedAt: Date.now(),
    };
    const now = Date.now();
    const statusChanged = patch.status !== undefined && patch.status !== base.status;
    state.telemetry = {
      ...base,
      ...patch,
      statusSince: statusChanged ? now : base.statusSince,
      updatedAt: now,
    };
    state.hasTelemetry = true;
    this.emitSession(state);
    return state;
  }

  getAll(): SessionState[] {
    return [...this.sessions.values()];
  }

  protected requireSession(sessionId: string): SessionState {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`unknown session ${sessionId}`);
    return s;
  }

  protected findStepOrThrow(state: SessionState, stepId: string): Step {
    const step = findStep(state.steps, stepId);
    if (!step) throw new Error(`unknown step ${stepId}`);
    return step;
  }

  protected emitSession(state: SessionState): void {
    const event: ServerEvent = { type: "session", session: structuredClone(state) };
    this.emit("event", event);
  }

  setMarkdown(sessionId: string, markdown: string): SessionState {
    const state = this.requireSession(sessionId);
    state.markdown = markdown;
    this.emitSession(state);
    return state;
  }

  setProgress(sessionId: string, steps: Step[]): SessionState {
    const state = this.requireSession(sessionId);
    state.steps = steps;
    this.emitSession(state);
    return state;
  }

  updateStep(
    sessionId: string,
    stepId: string,
    status: Status,
    note?: string,
  ): SessionState {
    const state = this.requireSession(sessionId);
    const step = this.findStepOrThrow(state, stepId);
    step.status = status;
    if (note !== undefined) step.note = note;
    if (status === "active" && step.startedAt === undefined) {
      step.startedAt = Date.now();
    }
    if (status === "done" || status === "failed") {
      step.endedAt = Date.now();
    }
    this.emitSession(state);
    return state;
  }

  disconnect(sessionId: string): void {
    if (!this.sessions.has(sessionId)) return;
    this.sessions.delete(sessionId);
    const event: ServerEvent = { type: "remove", sessionId };
    this.emit("event", event);
  }

  private uniqueLabel(label: string, sessionId: string): string {
    const taken = new Set(
      [...this.sessions.values()]
        .filter((s) => s.sessionId !== sessionId && s.online)
        .map((s) => s.label),
    );
    if (!taken.has(label)) return label;
    let n = 2;
    while (taken.has(`${label}-${n}`)) n++;
    return `${label}-${n}`;
  }
}

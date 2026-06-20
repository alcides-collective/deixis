import { EventEmitter } from "node:events";
import type { Step, Status, SessionState, ServerEvent } from "@deixis/shared";

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
    const existing = this.sessions.get(sessionId);
    const state: SessionState =
      existing ?? {
        sessionId,
        label: unique,
        markdown: "",
        steps: [],
        connectedAt: Date.now(),
        online: true,
      };
    state.label = unique;
    state.online = true;
    this.sessions.set(sessionId, state);
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

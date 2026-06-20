import type { TelemetryStatus } from "@deixis/shared";

export const WORKING_IDLE_MS = 120_000;
export const IDLE_FINISHED_MS = 3_600_000;

interface Entry { status: TelemetryStatus; since: number }

export class StatusEngine {
  private entries = new Map<string, Entry>();

  applyEvent(sessionId: string, eventName: string, now: number): TelemetryStatus {
    const status = mapEvent(eventName);
    this.entries.set(sessionId, { status, since: now });
    return status;
  }

  tick(now: number): Map<string, TelemetryStatus> {
    const changed = new Map<string, TelemetryStatus>();
    for (const [id, e] of this.entries) {
      if (e.status === "working" && now - e.since >= WORKING_IDLE_MS) {
        e.status = "idle";
        e.since = now;
        changed.set(id, "idle");
      } else if (e.status === "idle" && now - e.since >= IDLE_FINISHED_MS) {
        e.status = "finished";
        e.since = now;
        changed.set(id, "finished");
      }
    }
    return changed;
  }

  classifyFallback(
    current: TelemetryStatus,
    signals: { pidAlive: boolean; hasError: boolean },
  ): TelemetryStatus {
    if (signals.hasError) return "errored";
    if (!signals.pidAlive) return "finished";
    return current;
  }
}

function mapEvent(eventName: string): TelemetryStatus {
  switch (eventName) {
    case "PreToolUse":
    case "PostToolUse":
    case "UserPromptSubmit":
      return "working";
    case "Notification":
      return "waiting";
    case "Stop":
    case "SessionStart":
      return "idle";
    default:
      return "idle";
  }
}

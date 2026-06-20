import type { SessionStore } from "../store.js";

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, sends nothing
    return true;
  } catch {
    return false;
  }
}

export function sweepFinished(store: SessionStore): string[] {
  const finished: string[] = [];
  for (const s of store.getAll()) {
    const t = s.telemetry;
    if (!t?.pid || t.status === "finished") continue;
    if (!pidAlive(t.pid)) {
      store.setTelemetry(s.sessionId, { status: "finished" });
      finished.push(s.sessionId);
    }
  }
  return finished;
}

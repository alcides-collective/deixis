import { useEffect, useState } from "react";
import type { SessionState, ServerEvent } from "@deixis/shared";

export function useSessions(): SessionState[] {
  const [sessions, setSessions] = useState<Record<string, SessionState>>({});

  useEffect(() => {
    const es = new EventSource("/events");
    es.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as ServerEvent;
      setSessions((prev) => {
        if (event.type === "snapshot") {
          return Object.fromEntries(event.sessions.map((s) => [s.sessionId, s]));
        }
        if (event.type === "session") {
          return { ...prev, [event.session.sessionId]: event.session };
        }
        const next = { ...prev };
        delete next[event.sessionId];
        return next;
      });
    };
    return () => es.close();
  }, []);

  return Object.values(sessions).sort((a, b) => a.connectedAt - b.connectedAt);
}

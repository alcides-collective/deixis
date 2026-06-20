import { useState } from "react";
import type { SessionState } from "@deixis/shared";
import { useSessions } from "./lib/useSessions.js";
import { Grid } from "./components/Grid.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { AggregateBar } from "./components/AggregateBar.js";
import { ReadingOverlay } from "./components/ReadingOverlay.js";

const docKey = (s: SessionState) => `${s.sessionId}:${s.document!.openedAt}`;

export default function App() {
  const sessions = useSessions();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [manualKey, setManualKey] = useState<string | null>(null);

  const withDoc = sessions.filter((s) => s.document);
  let active = manualKey ? withDoc.find((s) => docKey(s) === manualKey) : undefined;
  if (!active) {
    active = withDoc
      .filter((s) => !dismissed.has(docKey(s)))
      .sort((a, b) => b.document!.openedAt - a.document!.openedAt)[0];
  }

  const close = () => {
    if (active) {
      const k = docKey(active);
      setDismissed((d) => new Set(d).add(k));
    }
    setManualKey(null);
  };

  return (
    <main>
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-[13px] font-medium tracking-[0.05em] uppercase">Deixis</span>
        <ThemeToggle />
      </header>
      <AggregateBar sessions={sessions} />
      <Grid sessions={sessions} onOpenDoc={(s) => setManualKey(docKey(s))} />
      {active?.document ? <ReadingOverlay doc={active.document} onClose={close} /> : null}
    </main>
  );
}

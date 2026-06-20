import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { SessionState } from "@deixis/shared";
import { SessionCard } from "./SessionCard.js";

const EASE = [0.4, 0, 0.2, 1] as const;

// Native CSS masonry (grid-template-rows: masonry) — Safari 26+. Detected once.
const NATIVE_MASONRY =
  typeof CSS !== "undefined" && !!CSS.supports?.("grid-template-rows", "masonry");

// Responsive column count for the fallback, matching the ~320px card feel.
function useColumnCount(): number {
  const [n, setN] = useState(3);
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setN(w < 640 ? 1 : w < 1000 ? 2 : w < 1360 ? 3 : 4);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return n;
}

function Card({
  session,
  onOpenDoc,
}: {
  session: SessionState;
  onOpenDoc?: (s: SessionState) => void;
}) {
  return (
    <motion.div
      // `layout` fights native masonry; only enable it in the fallback columns.
      layout={!NATIVE_MASONRY}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      <SessionCard session={session} onOpenDoc={onOpenDoc ? () => onOpenDoc(session) : undefined} />
    </motion.div>
  );
}

export function Grid({
  sessions,
  onOpenDoc,
}: {
  sessions: SessionState[];
  onOpenDoc?: (s: SessionState) => void;
}) {
  const columns = useColumnCount();

  if (!sessions.length) {
    return (
      <p className="p-8 text-[14px] text-muted-foreground">
        No active sessions. Run Claude Code with the Deixis MCP enabled.
      </p>
    );
  }

  // Native masonry: one grid, cards as direct children, DOM order preserved.
  if (NATIVE_MASONRY) {
    return (
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4 p-4"
        style={{ gridTemplateRows: "masonry" }}
      >
        <AnimatePresence>
          {sessions.map((s) => (
            <Card key={s.sessionId} session={s} onOpenDoc={onOpenDoc} />
          ))}
        </AnimatePresence>
      </div>
    );
  }

  // Fallback: round-robin into N flex columns. Stable — a card never jumps
  // columns when its content updates live (assignment is by index, not height).
  const cols: SessionState[][] = Array.from({ length: columns }, () => []);
  sessions.forEach((s, i) => cols[i % columns]!.push(s));

  return (
    <div className="flex items-start gap-4 p-4">
      {cols.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-4">
          <AnimatePresence>
            {col.map((s) => (
              <Card key={s.sessionId} session={s} onOpenDoc={onOpenDoc} />
            ))}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

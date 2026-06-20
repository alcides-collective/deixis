import { AnimatePresence, motion } from "motion/react";
import type { SessionState } from "@deixis/shared";
import { SessionCard } from "./SessionCard.js";

export function Grid({ sessions }: { sessions: SessionState[] }) {
  if (!sessions.length) {
    return (
      <p className="p-8 text-[14px] text-muted-foreground">
        No active sessions. Run Claude Code with the Deixis MCP enabled.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 p-4">
      <AnimatePresence>
        {sessions.map((s) => (
          <motion.div
            key={s.sessionId}
            layout
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          >
            <SessionCard session={s} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

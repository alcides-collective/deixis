import type { SessionStore } from "../store.js";
import { PricingTable, computeCost } from "./pricing.js";
import { readTranscript } from "./transcript.js";
import { StatusEngine } from "./status.js";

export interface TelemetryEventBody {
  event: string;
  cwd?: string;
  transcriptPath?: string;
  toolName?: string;
  pid?: number;
}

const RECENT_TOOLS_MAX = 8;

export class Telemetry {
  constructor(
    private store: SessionStore,
    private table: PricingTable,
    private engine: StatusEngine,
  ) {}

  async handleEvent(sessionId: string, body: TelemetryEventBody): Promise<void> {
    const now = Date.now();
    const status = this.engine.applyEvent(sessionId, body.event, now);

    const prev = this.store.ensureSession(sessionId, body.cwd ? base(body.cwd) : undefined)
      .telemetry;
    const recentTools = prev?.recentTools ? [...prev.recentTools] : [];
    if (body.toolName) recentTools.unshift(body.toolName);

    this.store.setTelemetry(sessionId, {
      status,
      pid: body.pid ?? prev?.pid,
      currentTool: body.event === "PreToolUse" ? body.toolName : prev?.currentTool,
      recentTools: recentTools.slice(0, RECENT_TOOLS_MAX),
    });

    if (body.transcriptPath) {
      try {
        const t = await readTranscript(body.transcriptPath);
        const price = t.model ? this.table.priceFor(t.model) : null;
        this.store.setTelemetry(sessionId, {
          model: t.model,
          usage: t.usage,
          costUsd: computeCost(t.usage, price),
          lastMessage: t.lastMessage,
          status: t.hasError ? "errored" : status,
        });
      } catch {
        /* transcript not readable yet — keep event-derived state */
      }
    }
  }

  tick(now: number): void {
    for (const [id, status] of this.engine.tick(now)) {
      this.store.setTelemetry(id, { status });
    }
  }
}

function base(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "session";
}

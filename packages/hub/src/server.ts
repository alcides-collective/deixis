import express, { type Express, type Request, type Response } from "express";
import type { ServerEvent } from "@deixis/shared";
import { SessionStore } from "./store.js";
import { Telemetry } from "./telemetry/index.js";

function wrap(store: SessionStore, fn: (req: Request) => void) {
  return (req: Request, res: Response) => {
    try {
      fn(req);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      const code = msg.startsWith("unknown") ? 404 : 400;
      res.status(code).json({ ok: false, error: msg });
    }
  };
}

export function createApp(store: SessionStore, telemetry?: Telemetry): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.post("/session/:id/register", wrap(store, (req) =>
    store.register(req.params.id, String(req.body?.label ?? "session")),
  ));
  app.post("/session/:id/markdown", wrap(store, (req) =>
    store.setMarkdown(req.params.id, String(req.body?.markdown ?? "")),
  ));
  app.post("/session/:id/progress", wrap(store, (req) =>
    store.setProgress(req.params.id, req.body?.steps ?? []),
  ));
  app.post("/session/:id/progress/update", wrap(store, (req) =>
    store.updateStep(
      req.params.id,
      String(req.body?.stepId),
      req.body?.status,
      req.body?.note,
    ),
  ));
  app.post("/session/:id/disconnect", wrap(store, (req) =>
    store.disconnect(req.params.id),
  ));

  app.get("/sessions", (_req, res) => {
    res.json({ sessions: store.getAll() });
  });

  app.get("/events", (req: Request, res: Response) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();
    const send = (e: ServerEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: "snapshot", sessions: store.getAll() });
    const onEvent = (e: ServerEvent) => send(e);
    store.on("event", onEvent);
    req.on("close", () => store.off("event", onEvent));
  });

  if (telemetry) {
    app.post("/telemetry/:id/event", (req, res) => {
      void telemetry.handleEvent(req.params.id, req.body ?? {});
      res.json({ ok: true });
    });
  }

  return app;
}

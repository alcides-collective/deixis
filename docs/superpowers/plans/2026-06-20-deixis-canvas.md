# Deixis Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Deixis — a persistent browser canvas where each Claude Code session pushes Markdown and a rich live-progress widget over MCP, rendered in a live React grid.

**Architecture:** A long-running **hub** (HTTP + SSE on :3000) holds all session state in memory. A per-session **MCP shim** (stdio) exposes three tools that POST to the hub. A **React dashboard** subscribes to the hub's SSE stream and renders every session as a card in a live grid. A **CLI** installs the launchd service, registers the shim in Claude Code, and converts the user's Helvetica Now fonts to woff2.

**Tech Stack:** TypeScript, pnpm workspaces, Node LTS, Express, `@modelcontextprotocol/sdk`, zod, React 19 + Vite + Tailwind v4 + shadcn + `motion`, `marked` + DOMPurify, Lucide, `wawoff2`, Vitest.

## Global Constraints

- **Language:** TypeScript everywhere; ESM (`"type": "module"`); Node `>=20`.
- **Package manager:** pnpm workspaces; packages under `packages/*`; scope `@deixis/*`.
- **State:** in-memory only in the hub — no database, no persistence across restarts.
- **Transport:** SSE only (server→browser). No WebSocket.
- **Protocol:** bespoke JSON; shared types in `@deixis/shared`, imported by hub + shim so it cannot drift.
- **Type — two weights only:** 400 body, 500 emphasis/headings; never heavier.
- **Color:** monochrome OKLCH base; the only color is the semantic status palette (done/active/failed/blocked/pending).
- **Radius base:** `0.625rem` (10px). **Motion:** 300ms `cubic-bezier(0.4, 0, 0.2, 1)`.
- **Fonts:** Helvetica Now Display 400/500 + PPSupplyMono; converted locally by the CLI, **never committed and never shipped in the published package** (proprietary).
- **Testing:** Vitest unit tests for `shared`/`hub`/`shim`; `web` and `cli` verified manually.
- **Status enum (verbatim, used everywhere):** `"pending" | "active" | "done" | "failed" | "blocked"`.

---

## File Structure

```
deixis/
  pnpm-workspace.yaml
  package.json                      # workspace root (private)
  tsconfig.base.json
  packages/
    shared/
      package.json
      tsconfig.json
      src/index.ts                  # Status, Step, SessionState, message + SSE types
    hub/
      package.json
      tsconfig.json
      src/store.ts                  # in-memory SessionStore (EventEmitter)
      src/server.ts                 # Express app: routes + SSE
      src/index.ts                  # bootstrap: store + app + static + listen
      test/store.test.ts
      test/server.test.ts
    shim/
      package.json
      tsconfig.json
      src/hub-client.ts             # POST helper + identity
      src/index.ts                  # MCP server + 3 tools
      test/hub-client.test.ts
    web/
      package.json
      tsconfig.json
      vite.config.ts
      index.html
      public/fonts/                 # woff2 written by CLI (gitignored)
      src/main.tsx
      src/globals.css               # @theme tokens, status colors, @font-face
      src/lib/useSessions.ts        # SSE hook
      src/lib/markdown.ts           # marked + DOMPurify
      src/lib/theme.ts              # light/dark + system + localStorage
      src/components/Grid.tsx
      src/components/SessionCard.tsx
      src/components/ProgressList.tsx
      src/components/ThemeToggle.tsx
      src/App.tsx
    cli/
      package.json
      tsconfig.json
      src/index.ts                  # arg dispatch: init | uninstall | status
      src/fonts.ts                  # otf -> woff2 via wawoff2
      src/launchd.ts                # plist install/uninstall
      src/mcp.ts                    # register/unregister shim in Claude Code
```

---

## Milestone 0 — Monorepo scaffold + shared types

### Task 1: Workspace scaffold

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`

**Interfaces:**
- Produces: pnpm workspace rooted at `packages/*`; root scripts `build`, `test`.

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "deixis-root",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Install and verify**

Run: `pnpm install`
Expected: completes, creates `node_modules` and `pnpm-lock.yaml`.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json pnpm-lock.yaml
git commit -m "chore: scaffold pnpm workspace"
```

---

### Task 2: `@deixis/shared` types

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `Status`, `Step`, `SessionState`, `RegisterBody`, `MarkdownBody`, `ProgressSetBody`, `ProgressUpdateBody`, `ServerEvent`. These are the single source of truth for the protocol.

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@deixis/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/shared/src/index.ts`**

```ts
export type Status = "pending" | "active" | "done" | "failed" | "blocked";

export interface Step {
  id: string;
  name: string;
  status: Status;
  note?: string;
  substeps?: Step[];
  startedAt?: number; // epoch ms, stamped by the hub on -> active
  endedAt?: number;   // epoch ms, stamped by the hub on -> done | failed
}

export interface SessionState {
  sessionId: string;
  label: string;
  markdown: string;
  steps: Step[];
  connectedAt: number;
  online: boolean;
}

// ---- shim -> hub request bodies ----
export interface RegisterBody { label: string }
export interface MarkdownBody { markdown: string }
export interface ProgressSetBody { steps: Step[] }
export interface ProgressUpdateBody { stepId: string; status: Status; note?: string }

// ---- hub -> browser SSE events ----
export type ServerEvent =
  | { type: "snapshot"; sessions: SessionState[] }
  | { type: "session"; session: SessionState }
  | { type: "remove"; sessionId: string };
```

- [ ] **Step 4: Build to verify it compiles**

Run: `pnpm --filter @deixis/shared build`
Expected: emits `packages/shared/dist/index.js` and `.d.ts`, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): protocol and domain types"
```

---

## Milestone 1 — Hub (state server, curl-testable)

### Task 3: `SessionStore` — register + unique labels

**Files:**
- Create: `packages/hub/package.json`, `packages/hub/tsconfig.json`, `packages/hub/src/store.ts`
- Test: `packages/hub/test/store.test.ts`

**Interfaces:**
- Consumes: `@deixis/shared` (`Step`, `Status`, `SessionState`, `ServerEvent`).
- Produces: `class SessionStore extends EventEmitter` with `register(sessionId: string, label: string): SessionState`, emits `"event"` with `ServerEvent`. Later tasks add `setMarkdown`, `setProgress`, `updateStep`, `disconnect`, `getAll`.

- [ ] **Step 1: Create `packages/hub/package.json`**

```json
{
  "name": "@deixis/hub",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": { "deixis-hub": "./dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@deixis/shared": "workspace:*",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/hub/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Install workspace deps**

Run: `pnpm install`
Expected: links `@deixis/shared`, installs express + test deps.

- [ ] **Step 4: Write the failing test**

`packages/hub/test/store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SessionStore } from "../src/store.js";

describe("SessionStore.register", () => {
  it("creates an online session with the given label", () => {
    const store = new SessionStore();
    const s = store.register("id-1", "deixis");
    expect(s.label).toBe("deixis");
    expect(s.online).toBe(true);
    expect(s.markdown).toBe("");
    expect(s.steps).toEqual([]);
  });

  it("disambiguates duplicate labels across distinct sessions", () => {
    const store = new SessionStore();
    store.register("id-1", "deixis");
    const s2 = store.register("id-2", "deixis");
    expect(s2.label).toBe("deixis-2");
  });

  it("emits a session event on register", () => {
    const store = new SessionStore();
    const events: unknown[] = [];
    store.on("event", (e) => events.push(e));
    store.register("id-1", "deixis");
    expect(events).toContainEqual({
      type: "session",
      session: expect.objectContaining({ sessionId: "id-1", label: "deixis" }),
    });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — cannot find `../src/store.js`.

- [ ] **Step 6: Write minimal implementation**

`packages/hub/src/store.ts`:
```ts
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
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @deixis/hub test`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/hub pnpm-lock.yaml
git commit -m "feat(hub): SessionStore register with unique labels"
```

---

### Task 4: `SessionStore` — markdown, progress, timing, disconnect

**Files:**
- Modify: `packages/hub/src/store.ts`
- Test: `packages/hub/test/store.test.ts` (append)

**Interfaces:**
- Consumes: `SessionStore` from Task 3.
- Produces: `setMarkdown(sessionId, markdown): SessionState`, `setProgress(sessionId, steps): SessionState`, `updateStep(sessionId, stepId, status, note?): SessionState`, `disconnect(sessionId): void` (emits `{type:"remove"}`).

- [ ] **Step 1: Append failing tests**

`packages/hub/test/store.test.ts` (add):
```ts
describe("SessionStore mutations", () => {
  it("sets markdown", () => {
    const store = new SessionStore();
    store.register("id-1", "a");
    const s = store.setMarkdown("id-1", "# hi");
    expect(s.markdown).toBe("# hi");
  });

  it("sets progress steps", () => {
    const store = new SessionStore();
    store.register("id-1", "a");
    const s = store.setProgress("id-1", [
      { id: "1", name: "parse", status: "pending" },
    ]);
    expect(s.steps[0].name).toBe("parse");
  });

  it("stamps startedAt on -> active and endedAt on -> done", () => {
    const store = new SessionStore();
    store.register("id-1", "a");
    store.setProgress("id-1", [{ id: "1", name: "parse", status: "pending" }]);
    const active = store.updateStep("id-1", "1", "active");
    expect(active.steps[0].startedAt).toBeTypeOf("number");
    const done = store.updateStep("id-1", "1", "done");
    expect(done.steps[0].endedAt).toBeTypeOf("number");
  });

  it("updates a nested substep by id", () => {
    const store = new SessionStore();
    store.register("id-1", "a");
    store.setProgress("id-1", [
      { id: "p", name: "parent", status: "active", substeps: [
        { id: "c", name: "child", status: "pending" },
      ] },
    ]);
    const s = store.updateStep("id-1", "c", "done");
    expect(s.steps[0].substeps![0].status).toBe("done");
  });

  it("emits remove on disconnect", () => {
    const store = new SessionStore();
    store.register("id-1", "a");
    const events: unknown[] = [];
    store.on("event", (e) => events.push(e));
    store.disconnect("id-1");
    expect(events).toContainEqual({ type: "remove", sessionId: "id-1" });
    expect(store.getAll()).toHaveLength(0);
  });

  it("throws on unknown session and unknown step", () => {
    const store = new SessionStore();
    expect(() => store.setMarkdown("nope", "x")).toThrow();
    store.register("id-1", "a");
    expect(() => store.updateStep("id-1", "ghost", "done")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — `setMarkdown`/`setProgress`/`updateStep`/`disconnect` are not functions.

- [ ] **Step 3: Implement the methods**

Add to `SessionStore` in `packages/hub/src/store.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deixis/hub test`
Expected: PASS (all store tests).

- [ ] **Step 5: Commit**

```bash
git add packages/hub/src/store.ts packages/hub/test/store.test.ts
git commit -m "feat(hub): markdown, progress, timing, disconnect"
```

---

### Task 5: Express app — routes + SSE

**Files:**
- Create: `packages/hub/src/server.ts`
- Test: `packages/hub/test/server.test.ts`

**Interfaces:**
- Consumes: `SessionStore`.
- Produces: `createApp(store: SessionStore): express.Express` serving the routes from spec §5 and `GET /events` (SSE). 404 on unknown session, 400 on bad body.

- [ ] **Step 1: Write the failing test**

`packages/hub/test/server.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { SessionStore } from "../src/store.js";
import { createApp } from "../src/server.js";

function app() {
  return createApp(new SessionStore());
}

describe("hub routes", () => {
  it("registers a session", async () => {
    const a = app();
    await request(a).post("/session/id-1/register").send({ label: "x" }).expect(200);
  });

  it("404s markdown for unknown session", async () => {
    await request(app()).post("/session/ghost/markdown").send({ markdown: "y" }).expect(404);
  });

  it("accepts markdown for a registered session", async () => {
    const a = app();
    await request(a).post("/session/id-1/register").send({ label: "x" });
    await request(a).post("/session/id-1/markdown").send({ markdown: "# hi" }).expect(200);
  });

  it("streams a snapshot on /events", async () => {
    const a = app();
    await request(a).post("/session/id-1/register").send({ label: "x" });
    const res = await request(a)
      .get("/events")
      .buffer(true)
      .parse((r, cb) => {
        let data = "";
        r.on("data", (c) => {
          data += c;
          if (data.includes("snapshot")) r.destroy();
        });
        r.on("close", () => cb(null, data));
      });
    expect(res.text).toContain("snapshot");
    expect(res.text).toContain("id-1");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — cannot find `../src/server.js`.

- [ ] **Step 3: Implement the app**

`packages/hub/src/server.ts`:
```ts
import express, { type Express, type Request, type Response } from "express";
import type { ServerEvent } from "@deixis/shared";
import { SessionStore } from "./store.js";

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

export function createApp(store: SessionStore): Express {
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

  return app;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deixis/hub test`
Expected: PASS (all server tests).

- [ ] **Step 5: Commit**

```bash
git add packages/hub/src/server.ts packages/hub/test/server.test.ts
git commit -m "feat(hub): express routes and SSE stream"
```

---

### Task 6: Hub bootstrap — static serving + listen

**Files:**
- Create: `packages/hub/src/index.ts`

**Interfaces:**
- Consumes: `createApp`, `SessionStore`.
- Produces: an executable hub on `process.env.DEIXIS_PORT ?? 3000` that serves `packages/web/dist` (when present) with SPA fallback.

- [ ] **Step 1: Implement bootstrap**

`packages/hub/src/index.ts`:
```ts
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import { SessionStore } from "./store.js";
import { createApp } from "./server.js";

const port = Number(process.env.DEIXIS_PORT ?? 3000);
const store = new SessionStore();
const app = createApp(store);

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, "..", "..", "web", "dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/(session|events)).*/, (_req, res) =>
    res.sendFile(join(webDist, "index.html")),
  );
}

app.listen(port, () => {
  console.log(`Deixis hub listening on http://localhost:${port}`);
});
```

- [ ] **Step 2: Build and smoke-test manually**

Run:
```bash
pnpm --filter @deixis/shared build && pnpm --filter @deixis/hub build
node packages/hub/dist/index.js &
sleep 1
curl -s -XPOST localhost:3000/session/demo/register -H 'content-type: application/json' -d '{"label":"demo"}'
curl -s -N localhost:3000/events | head -c 200
kill %1
```
Expected: register returns `{"ok":true}`; `/events` prints a `snapshot` line containing `demo`.

- [ ] **Step 3: Commit**

```bash
git add packages/hub/src/index.ts
git commit -m "feat(hub): bootstrap with static serving"
```

---

## Milestone 2 — MCP shim

### Task 7: Hub client + identity

**Files:**
- Create: `packages/shim/package.json`, `packages/shim/tsconfig.json`, `packages/shim/src/hub-client.ts`
- Test: `packages/shim/test/hub-client.test.ts`

**Interfaces:**
- Consumes: `@deixis/shared` types.
- Produces: `sessionId: string`, `label: string`, and `post(path: string, body: unknown): Promise<string | null>` — returns `null` on success, a friendly error string on failure.

- [ ] **Step 1: Create `packages/shim/package.json`**

```json
{
  "name": "@deixis/shim",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": { "deixis-shim": "./dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@deixis/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": { "@types/node": "^20.0.0" }
}
```

- [ ] **Step 2: Create `packages/shim/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: installs MCP SDK + zod.

- [ ] **Step 4: Write the failing test**

`packages/shim/test/hub-client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { post } from "../src/hub-client.js";

afterEach(() => vi.restoreAllMocks());

describe("post", () => {
  it("returns null on ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    expect(await post("/x", {})).toBeNull();
  });

  it("returns a friendly message when the hub is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const msg = await post("/x", {});
    expect(msg).toMatch(/not running/i);
  });

  it("returns an error string on non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await post("/x", {})).toMatch(/404/);
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `pnpm --filter @deixis/shim test`
Expected: FAIL — cannot find `../src/hub-client.js`.

- [ ] **Step 6: Implement**

`packages/shim/src/hub-client.ts`:
```ts
import { randomUUID } from "node:crypto";
import { basename } from "node:path";

export const HUB_URL = process.env.DEIXIS_HUB_URL ?? "http://localhost:3000";
export const sessionId = randomUUID();
export const label = basename(process.cwd()) || "session";

export async function post(path: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(`${HUB_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return `Deixis hub error ${res.status}`;
    return null;
  } catch {
    return `Deixis canvas not running on ${HUB_URL} (start it with \`deixis\`)`;
  }
}
```

- [ ] **Step 7: Run to verify pass**

Run: `pnpm --filter @deixis/shim test`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/shim pnpm-lock.yaml
git commit -m "feat(shim): hub client and session identity"
```

---

### Task 8: MCP server + three tools

**Files:**
- Create: `packages/shim/src/index.ts`

**Interfaces:**
- Consumes: `post`, `sessionId`, `label` from Task 7; `Status` from `@deixis/shared`.
- Produces: an executable MCP stdio server exposing `render_markdown`, `progress_set`, `progress_update`. No automated test (verified manually against the running hub).

- [ ] **Step 1: Implement the server**

`packages/shim/src/index.ts`:
```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { post, sessionId, label } from "./hub-client.js";

const statusEnum = z.enum(["pending", "active", "done", "failed", "blocked"]);
const stepSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    status: statusEnum,
    note: z.string().optional(),
    substeps: z.array(stepSchema).optional(),
  }),
);

function reply(err: string | null, okMsg: string) {
  return { content: [{ type: "text" as const, text: err ?? okMsg }] };
}

const server = new McpServer({ name: "deixis", version: "0.1.0" });

server.tool(
  "render_markdown",
  "Render Markdown to this session's Deixis canvas tab (replaces the markdown pane).",
  { markdown: z.string() },
  async ({ markdown }) =>
    reply(await post(`/session/${sessionId}/markdown`, { markdown }), "rendered"),
);

server.tool(
  "progress_set",
  "Define or replace this session's progress checklist (supports one level of substeps).",
  { steps: z.array(stepSchema) },
  async ({ steps }) =>
    reply(await post(`/session/${sessionId}/progress`, { steps }), "progress set"),
);

server.tool(
  "progress_update",
  "Update a single progress step's status (and optional note) without resending the list.",
  { stepId: z.string(), status: statusEnum, note: z.string().optional() },
  async ({ stepId, status, note }) =>
    reply(
      await post(`/session/${sessionId}/progress/update`, { stepId, status, note }),
      "step updated",
    ),
);

async function main() {
  await post(`/session/${sessionId}/register`, { label });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const bye = () => {
    void post(`/session/${sessionId}/disconnect`, {});
    process.exit(0);
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
  process.stdin.on("close", bye);
}

void main();
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @deixis/shim build`
Expected: emits `packages/shim/dist/index.js`, no type errors.

- [ ] **Step 3: Manual integration smoke test**

Run (hub must be running from Task 6):
```bash
node packages/hub/dist/index.js &
sleep 1
DEIXIS_HUB_URL=http://localhost:3000 node packages/shim/dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
EOF
curl -s -N localhost:3000/events | head -c 300
kill %1
```
Expected: `tools/list` returns the three tool names; `/events` snapshot shows a session whose label is the current folder name (registered on shim startup).

- [ ] **Step 4: Commit**

```bash
git add packages/shim/src/index.ts
git commit -m "feat(shim): MCP server exposing the three canvas tools"
```

---

## Milestone 3 — React dashboard (manual verification)

### Task 9: Vite + Tailwind v4 + tokens + fonts

**Files:**
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`, `packages/web/src/main.tsx`, `packages/web/src/globals.css`, `packages/web/src/App.tsx`
- Modify: `.gitignore` (add `packages/web/public/fonts/`)

**Interfaces:**
- Produces: a Vite app rendering a placeholder `App`, with the pollar design tokens and `@font-face` declarations in place.

- [ ] **Step 1: Create `packages/web/package.json`**

```json
{
  "name": "@deixis/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "motion": "^11.11.0",
    "marked": "^14.1.0",
    "dompurify": "^3.1.0",
    "lucide-react": "^0.460.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/dompurify": "^3.0.5",
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    proxy: {
      "/session": "http://localhost:3000",
      "/events": "http://localhost:3000",
    },
  },
});
```

- [ ] **Step 4: Create `packages/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Deixis</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `packages/web/src/globals.css`**

```css
@import "tailwindcss";

@font-face {
  font-family: "Helvetica Now Display";
  src: url("/fonts/HelveticaNowDisplay-400.woff2") format("woff2");
  font-weight: 400; font-display: swap;
}
@font-face {
  font-family: "Helvetica Now Display";
  src: url("/fonts/HelveticaNowDisplay-500.woff2") format("woff2");
  font-weight: 500; font-display: swap;
}
@font-face {
  font-family: "PP Supply Mono";
  src: url("/fonts/PPSupplyMono-Regular.woff2") format("woff2");
  font-weight: 400; font-display: swap;
}

@theme {
  --font-sans: "Helvetica Now Display", Arial, sans-serif;
  --font-mono: "PP Supply Mono", ui-monospace, monospace;
  --radius: 0.625rem;
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-muted: oklch(0.97 0 0);
  --color-muted-foreground: oklch(0.556 0 0);
  --color-border: oklch(0.922 0 0);
  /* semantic status (light) */
  --color-status-pending: oklch(0.65 0 0);
  --color-status-active: oklch(0.72 0.15 75);
  --color-status-done: oklch(0.6 0.13 150);
  --color-status-failed: oklch(0.58 0.22 27);
  --color-status-blocked: oklch(0.55 0 0);
}

.dark {
  --color-background: oklch(0.145 0 0);
  --color-foreground: oklch(0.985 0 0);
  --color-muted: oklch(0.205 0 0);
  --color-muted-foreground: oklch(0.708 0 0);
  --color-border: oklch(1 0 0 / 12%);
  --color-status-pending: oklch(0.6 0 0);
  --color-status-active: oklch(0.8 0.15 75);
  --color-status-done: oklch(0.72 0.15 150);
  --color-status-failed: oklch(0.7 0.2 27);
  --color-status-blocked: oklch(0.6 0 0);
}

html { font-family: var(--font-sans); }
body { background: var(--color-background); color: var(--color-foreground); margin: 0; }
* { border-color: var(--color-border); }
```

- [ ] **Step 6: Create `packages/web/src/App.tsx`**

```tsx
export default function App() {
  return <main className="p-8 text-[15px]">Deixis canvas — no sessions yet.</main>;
}
```

- [ ] **Step 7: Create `packages/web/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Ignore generated fonts**

Append to `.gitignore`:
```
packages/web/public/fonts/
```

- [ ] **Step 9: Install + dev smoke test**

Run: `pnpm install && pnpm --filter @deixis/web dev`
Expected: Vite serves on :5173; page shows "Deixis canvas — no sessions yet." (fonts fall back to Arial until the CLI generates them — expected).

- [ ] **Step 10: Commit**

```bash
git add packages/web .gitignore pnpm-lock.yaml
git commit -m "feat(web): vite + tailwind v4 tokens, fonts, app shell"
```

---

### Task 10: SSE hook, theme, markdown helpers

**Files:**
- Create: `packages/web/src/lib/useSessions.ts`, `packages/web/src/lib/theme.ts`, `packages/web/src/lib/markdown.ts`

**Interfaces:**
- Consumes: `SessionState`, `ServerEvent` from `@deixis/shared` (add `"@deixis/shared": "workspace:*"` to web deps).
- Produces: `useSessions(): SessionState[]`; `useTheme(): { theme, toggle }`; `renderMarkdown(md: string): string` (sanitized HTML).

- [ ] **Step 1: Add shared dep**

Edit `packages/web/package.json` dependencies, add:
```json
"@deixis/shared": "workspace:*"
```
Run: `pnpm install`

- [ ] **Step 2: Create `packages/web/src/lib/useSessions.ts`**

```ts
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
```

- [ ] **Step 3: Create `packages/web/src/lib/theme.ts`**

```ts
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function initial(): Theme {
  const saved = localStorage.getItem("deixis-theme") as Theme | null;
  if (saved) return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("deixis-theme", theme);
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
```

- [ ] **Step 4: Create `packages/web/src/lib/markdown.ts`**

```ts
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}
```

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @deixis/web exec tsc -b`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib packages/web/package.json pnpm-lock.yaml
git commit -m "feat(web): SSE hook, theme, sanitized markdown"
```

---

### Task 11: Components — ProgressList, SessionCard, Grid, ThemeToggle, App

**Files:**
- Create: `packages/web/src/components/ProgressList.tsx`, `SessionCard.tsx`, `Grid.tsx`, `ThemeToggle.tsx`
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `useSessions`, `useTheme`, `renderMarkdown`; `Step`, `SessionState`.
- Produces: the full dashboard UI.

- [ ] **Step 1: Create `packages/web/src/components/ProgressList.tsx`**

```tsx
import type { Step, Status } from "@deixis/shared";

const dot: Record<Status, string> = {
  pending: "bg-[--color-status-pending]",
  active: "bg-[--color-status-active]",
  done: "bg-[--color-status-done]",
  failed: "bg-[--color-status-failed]",
  blocked: "bg-[--color-status-blocked]",
};

function StepRow({ step, depth }: { step: Step; depth: number }) {
  return (
    <li>
      <div
        className="flex items-center gap-2 py-1 text-[13px]"
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        <span className={`size-2 rounded-full ${dot[step.status]}`} />
        <span className={step.status === "done" ? "opacity-60 line-through" : ""}>
          {step.name}
        </span>
        {step.note ? (
          <span className="text-[11px] text-[--color-muted-foreground]">— {step.note}</span>
        ) : null}
      </div>
      {step.substeps?.length ? (
        <ul>{step.substeps.map((s) => <StepRow key={s.id} step={s} depth={depth + 1} />)}</ul>
      ) : null}
    </li>
  );
}

export function ProgressList({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  const flat = steps.flatMap((s) => [s, ...(s.substeps ?? [])]);
  const done = flat.filter((s) => s.status === "done").length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.05em] text-[--color-muted-foreground]">
        <span>Progress</span>
        <span>{done}/{flat.length}</span>
      </div>
      <div className="mb-2 h-1 w-full rounded-full bg-[--color-muted]">
        <div
          className="h-1 rounded-full bg-[--color-foreground] transition-all duration-300"
          style={{ width: `${flat.length ? (done / flat.length) * 100 : 0}%` }}
        />
      </div>
      <ul>{steps.map((s) => <StepRow key={s.id} step={s} depth={0} />)}</ul>
    </div>
  );
}
```

- [ ] **Step 2: Create `packages/web/src/components/SessionCard.tsx`**

```tsx
import type { SessionState } from "@deixis/shared";
import { renderMarkdown } from "../lib/markdown.js";
import { ProgressList } from "./ProgressList.js";

export function SessionCard({ session }: { session: SessionState }) {
  return (
    <article
      className={`flex flex-col gap-4 rounded-[--radius] border bg-[--color-background] p-5 ${
        session.online ? "" : "opacity-50"
      }`}
    >
      <header className="flex items-center justify-between">
        <h2 className="text-[15px] font-medium">{session.label}</h2>
        <span
          className={`size-2 rounded-full ${
            session.online ? "bg-[--color-status-done]" : "bg-[--color-status-blocked]"
          }`}
        />
      </header>
      <ProgressList steps={session.steps} />
      {session.markdown ? (
        <div
          className="prose-deixis text-[14px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(session.markdown) }}
        />
      ) : null}
    </article>
  );
}
```

- [ ] **Step 3: Create `packages/web/src/components/Grid.tsx`**

```tsx
import { AnimatePresence, motion } from "motion/react";
import type { SessionState } from "@deixis/shared";
import { SessionCard } from "./SessionCard.js";

export function Grid({ sessions }: { sessions: SessionState[] }) {
  if (!sessions.length) {
    return (
      <p className="p-8 text-[14px] text-[--color-muted-foreground]">
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
```

- [ ] **Step 4: Create `packages/web/src/components/ThemeToggle.tsx`**

```tsx
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme.js";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="rounded-[--radius] border p-2 transition-colors duration-300 hover:bg-[--color-muted]"
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
```

- [ ] **Step 5: Replace `packages/web/src/App.tsx`**

```tsx
import { useSessions } from "./lib/useSessions.js";
import { Grid } from "./components/Grid.js";
import { ThemeToggle } from "./components/ThemeToggle.js";

export default function App() {
  const sessions = useSessions();
  return (
    <main>
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-[13px] font-medium tracking-[0.05em] uppercase">Deixis</span>
        <ThemeToggle />
      </header>
      <Grid sessions={sessions} />
    </main>
  );
}
```

- [ ] **Step 6: Manual end-to-end check**

Run in three terminals:
```bash
# 1: hub
node packages/hub/dist/index.js
# 2: web dev (proxies /events + /session to hub)
pnpm --filter @deixis/web dev
# 3: drive the hub like a session would
curl -XPOST localhost:3000/session/s1/register -d '{"label":"frontend"}' -H 'content-type: application/json'
curl -XPOST localhost:3000/session/s1/progress -H 'content-type: application/json' \
  -d '{"steps":[{"id":"1","name":"parse","status":"done"},{"id":"2","name":"build","status":"active"}]}'
curl -XPOST localhost:3000/session/s1/markdown -d '{"markdown":"# Hello\n\nFrom **Deixis**."}' -H 'content-type: application/json'
```
Open http://localhost:5173. Expected: a card "frontend" appears live, shows a 1/2 progress bar with a green done dot and amber active dot, and renders the markdown. Toggle theme — colors invert. `curl .../disconnect` removes the card with an exit animation.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): live grid, session cards, progress, theme toggle"
```

---

## Milestone 4 — CLI installer (manual verification)

### Task 12: Font conversion (otf → woff2)

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/src/fonts.ts`

**Interfaces:**
- Produces: `convertFonts(srcDir: string, outDir: string): Promise<string[]>` — converts the two Helvetica Now Display weights + copies PPSupplyMono; returns the written file paths.

- [ ] **Step 1: Create `packages/cli/package.json`**

```json
{
  "name": "deixis",
  "version": "0.1.0",
  "type": "module",
  "bin": { "deixis": "./dist/index.js" },
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": {
    "@deixis/shared": "workspace:*",
    "wawoff2": "^2.0.1"
  },
  "devDependencies": { "@types/node": "^20.0.0" }
}
```

- [ ] **Step 2: Create `packages/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: installs `wawoff2`.

- [ ] **Step 4: Implement `packages/cli/src/fonts.ts`**

```ts
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as wawoff2 from "wawoff2";

const DISPLAY = [
  { src: "HelveticaNowDisplay.otf", out: "HelveticaNowDisplay-400.woff2" },
  { src: "HelveticaNowDisplayMedium.otf", out: "HelveticaNowDisplay-500.woff2" },
];

export async function convertFonts(srcDir: string, outDir: string): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];

  for (const { src, out } of DISPLAY) {
    const srcPath = join(srcDir, src);
    if (!existsSync(srcPath)) {
      throw new Error(`Missing font: ${srcPath}`);
    }
    const otf = await readFile(srcPath);
    const woff2 = await wawoff2.compress(otf);
    const outPath = join(outDir, out);
    await writeFile(outPath, woff2);
    written.push(outPath);
  }

  // PPSupplyMono is already woff2 in the pollar repo; copy it if present.
  const monoSrc = join(
    process.env.HOME ?? "",
    "pollar/apps/frontend/src/app/fonts/PPSupplyMono-Regular.woff2",
  );
  if (existsSync(monoSrc)) {
    const monoOut = join(outDir, "PPSupplyMono-Regular.woff2");
    await copyFile(monoSrc, monoOut);
    written.push(monoOut);
  }

  return written;
}
```

- [ ] **Step 5: Manual test**

Run:
```bash
pnpm --filter deixis build
node -e "import('./packages/cli/dist/fonts.js').then(m=>m.convertFonts(process.env.HOME+'/Downloads/Helvetica Now','packages/web/public/fonts')).then(console.log)"
ls -la packages/web/public/fonts
```
Expected: prints written paths; `HelveticaNowDisplay-400.woff2`, `-500.woff2`, and `PPSupplyMono-Regular.woff2` exist and are smaller than the source `.otf`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli pnpm-lock.yaml
git commit -m "feat(cli): convert Helvetica Now otf to woff2"
```

---

### Task 13: launchd service + MCP registration

**Files:**
- Create: `packages/cli/src/launchd.ts`, `packages/cli/src/mcp.ts`

**Interfaces:**
- Produces: `installService(hubEntry: string): Promise<string>` and `uninstallService(): Promise<void>`; `registerMcp(shimEntry: string): void` and `unregisterMcp(): void` (shell out to the `claude` CLI).

- [ ] **Step 1: Implement `packages/cli/src/launchd.ts`**

```ts
import { writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const LABEL = "news.pollar.deixis";

function plistPath(): string {
  return join(process.env.HOME ?? "", "Library", "LaunchAgents", `${LABEL}.plist`);
}

export async function installService(hubEntry: string): Promise<string> {
  const logDir = join(process.env.HOME ?? "", "Library", "Logs");
  await mkdir(logDir, { recursive: true });
  const node = process.execPath;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${node}</string><string>${hubEntry}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(logDir, "deixis.log")}</string>
  <key>StandardErrorPath</key><string>${join(logDir, "deixis.err.log")}</string>
</dict>
</plist>`;
  const path = plistPath();
  await writeFile(path, plist);
  try { execFileSync("launchctl", ["unload", path]); } catch { /* not loaded yet */ }
  execFileSync("launchctl", ["load", path]);
  return path;
}

export async function uninstallService(): Promise<void> {
  const path = plistPath();
  if (!existsSync(path)) return;
  try { execFileSync("launchctl", ["unload", path]); } catch { /* already unloaded */ }
  await rm(path);
}
```

- [ ] **Step 2: Implement `packages/cli/src/mcp.ts`**

```ts
import { execFileSync } from "node:child_process";

const NAME = "deixis";

export function registerMcp(shimEntry: string): void {
  // Registers the shim for all projects at user scope.
  execFileSync(
    "claude",
    ["mcp", "add", "--scope", "user", NAME, "--", process.execPath, shimEntry],
    { stdio: "inherit" },
  );
}

export function unregisterMcp(): void {
  try {
    execFileSync("claude", ["mcp", "remove", "--scope", "user", NAME], { stdio: "inherit" });
  } catch { /* not registered */ }
}
```

- [ ] **Step 3: Build to type-check**

Run: `pnpm --filter deixis build`
Expected: compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/launchd.ts packages/cli/src/mcp.ts
git commit -m "feat(cli): launchd service and MCP registration helpers"
```

---

### Task 14: CLI entrypoint — init / uninstall / status

**Files:**
- Create: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `convertFonts`, `installService`, `uninstallService`, `registerMcp`, `unregisterMcp`.
- Produces: `deixis init|uninstall|status` executable.

- [ ] **Step 1: Implement `packages/cli/src/index.ts`**

```ts
#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { convertFonts } from "./fonts.js";
import { installService, uninstallService } from "./launchd.js";
import { registerMcp, unregisterMcp } from "./mcp.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", ".."); // packages/cli/dist -> repo root
const hubEntry = join(repoRoot, "packages", "hub", "dist", "index.js");
const shimEntry = join(repoRoot, "packages", "shim", "dist", "index.js");
const fontsOut = join(repoRoot, "packages", "web", "public", "fonts");
const fontsSrc = join(process.env.HOME ?? "", "Downloads", "Helvetica Now");

async function init() {
  console.log("Building packages…");
  execFileSync("pnpm", ["-r", "build"], { cwd: repoRoot, stdio: "inherit" });
  console.log("Converting fonts…");
  await convertFonts(fontsSrc, fontsOut);
  console.log("Building dashboard with fonts…");
  execFileSync("pnpm", ["--filter", "@deixis/web", "build"], { cwd: repoRoot, stdio: "inherit" });
  console.log("Installing hub service…");
  await installService(hubEntry);
  console.log("Registering MCP shim with Claude Code…");
  registerMcp(shimEntry);
  console.log("Done. Open http://localhost:3000");
}

async function uninstall() {
  await uninstallService();
  unregisterMcp();
  console.log("Removed service and MCP registration.");
}

function status() {
  try {
    execFileSync("launchctl", ["list", "news.pollar.deixis"], { stdio: "inherit" });
  } catch {
    console.log("Hub service not loaded.");
  }
}

const cmd = process.argv[2];
if (cmd === "init") await init();
else if (cmd === "uninstall") await uninstall();
else if (cmd === "status") status();
else {
  console.log("Usage: deixis <init|uninstall|status>");
  process.exit(1);
}
```

- [ ] **Step 2: Full install dry run**

Run:
```bash
pnpm --filter deixis build
node packages/cli/dist/index.js init
```
Expected: builds all packages, converts fonts into `packages/web/public/fonts`, builds the dashboard, loads the launchd service, and registers the MCP. Then:
```bash
curl -s localhost:3000/session/demo/register -XPOST -d '{"label":"demo"}' -H 'content-type: application/json'
open http://localhost:3000
node packages/cli/dist/index.js status
```
Expected: hub responds (service is running), the dashboard loads with Helvetica Now applied, `status` shows the service.

- [ ] **Step 3: Verify end-to-end with a real Claude Code session**

Open a new Claude Code session in any folder and confirm the `render_markdown` / `progress_set` / `progress_update` tools are available and that calling them makes a card appear at http://localhost:3000.

- [ ] **Step 4: Uninstall round-trip**

Run: `node packages/cli/dist/index.js uninstall`
Expected: service unloads, MCP entry removed (verify with `claude mcp list`).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): init/uninstall/status entrypoint"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** hub/in-memory/SSE (Tasks 3–6) ✓; bespoke protocol + shared types (Tasks 2, 5) ✓; three tools (Task 8) ✓; rich progress incl. substeps/notes/timing (Tasks 4, 11) ✓; identity/unique labels/offline (Tasks 3, 4, 11) ✓; live grid + motion (Task 11) ✓; light/dark + system (Tasks 9–11) ✓; semantic status colors (Tasks 9, 11) ✓; Helvetica Now + PPSupplyMono (Tasks 9, 12) ✓; launchd always-on (Task 13) ✓; CLI installer + font licensing via local conversion (Tasks 12–14) ✓; unit tests on shared/hub/shim + manual web/cli (throughout) ✓.
- **Type consistency:** `Status`/`Step`/`SessionState`/`ServerEvent` defined once in Task 2 and imported everywhere; route paths in Task 5 match shim calls in Task 8; `convertFonts` output filenames match `@font-face` in Task 9.
- **Non-goals respected:** no DB, no WebSocket, no hooks, no auth, no arbitrary HTML (markdown is sanitized).

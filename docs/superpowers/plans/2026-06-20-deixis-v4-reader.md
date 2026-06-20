# Deixis v4.0 Spec-Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `render_file` MCP tool that shows a Markdown file in an auto-opening reading overlay on the Deixis dashboard, so the agent can present a spec for review instead of you opening VS Code — verdict still given in your Claude Code session (terminal or phone via Remote Control).

**Architecture:** One-way, reusing the existing hub + SSE. The shim reads the file and POSTs it to a new `document` field on the session; the dashboard auto-opens a reading overlay; the user reads it and replies in their session. No new transport, no inbound channel (that's v4.1).

**Tech Stack:** TypeScript, pnpm workspaces, Node LTS, Express (existing hub), React 19 + Tailwind v4 (existing web), Vitest, `marked` + DOMPurify (existing).

## Global Constraints

- **Language:** TypeScript everywhere; ESM (`"type":"module"`); `.js` relative import specifiers; Node `>=20`.
- **One-way only:** no buttons/verdict capture, no channel/bridge, no in-browser editing (read-only). The verdict path is the agent's **normal conversation turn**.
- **Phone acceptance (hard req):** v4.0 must allow approving from Remote Control. Guaranteed by the skill instructing a **plain conversation turn with the spec inline** (not an MCP elicitation). No code enforces this — it's the skill text (Task 5).
- **`render_file(path)`** resolves `path` against the session cwd (absolute used as-is); reads UTF-8; missing/unreadable → friendly error string, never throws; non-blocking.
- **Size guard:** content over `256 * 1024` chars is truncated with a notice.
- **`document` is OPTIONAL** on `SessionState` (`document?`) — additive, no existing literal breaks.
- **Rendering/sanitizing** happens in the browser via the existing `renderMarkdown` (`marked` + DOMPurify) + `prose-deixis` styles. The hub stores raw markdown.
- **In-memory only** (like all state); no persistence across hub restart.

---

## File Structure

```
packages/
  shared/src/index.ts             # + DocumentState; SessionState.document?
  hub/
    src/store.ts                  # + setDocument()
    src/server.ts                 # + POST /session/:id/document
    test/store.test.ts            # setDocument
    test/server.test.ts           # the route
  shim/
    src/document.ts               # NEW: loadDocument(path, cwd) (read + truncate)
    src/index.ts                  # + render_file tool
    test/document.test.ts         # loadDocument
  web/src/
    components/ReadingOverlay.tsx  # NEW: the modal reader
    components/SessionCard.tsx     # + "View doc" affordance
    components/Grid.tsx            # thread onOpenDoc through
    App.tsx                        # active-doc state + mount overlay
  (menubar, cli unchanged)
skill/SKILL.md                     # nudge: render_file + plain-turn ask
```

---

## Task 1: `DocumentState` in `@deixis/shared`

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `DocumentState = { path: string; title: string; markdown: string; openedAt: number }`; `SessionState.document?: DocumentState`.

- [ ] **Step 1: Add the type + field**

In `packages/shared/src/index.ts`, add after `SessionTelemetry`:
```ts
export interface DocumentState {
  path: string;
  title: string;
  markdown: string;
  openedAt: number; // epoch ms, stamped by the hub on each render_file
}
```
And add to the `SessionState` interface (optional — keep all existing fields):
```ts
  document?: DocumentState;
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @deixis/shared build`
Expected: compiles; `document?` and `DocumentState` in `dist/index.d.ts`. (Optional field → hub still builds, no break.)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): DocumentState + optional SessionState.document"
```

---

## Task 2: hub `setDocument` + route

**Files:**
- Modify: `packages/hub/src/store.ts`, `packages/hub/src/server.ts`
- Test: `packages/hub/test/store.test.ts`, `packages/hub/test/server.test.ts` (append)

**Interfaces:**
- Consumes: `DocumentState`, `SessionStore`.
- Produces: `setDocument(sessionId, doc: {path, title, markdown}): SessionState` (ensureSession, stamp `openedAt`, emit); route `POST /session/:sessionId/document`.

- [ ] **Step 1: Append failing tests**

`packages/hub/test/store.test.ts` (add):
```ts
describe("SessionStore.setDocument", () => {
  it("stores a document with openedAt and emits", () => {
    const store = new SessionStore();
    const events: unknown[] = [];
    store.on("event", (e) => events.push(e));
    const s = store.setDocument("id", { path: "a/spec.md", title: "spec.md", markdown: "# Hi" });
    expect(s.document).toMatchObject({ path: "a/spec.md", title: "spec.md", markdown: "# Hi" });
    expect(typeof s.document!.openedAt).toBe("number");
    expect(events.some((e: any) => e.type === "session")).toBe(true);
  });
});
```

`packages/hub/test/server.test.ts` (add):
```ts
describe("POST /session/:id/document", () => {
  it("accepts a document for a session", async () => {
    const store = new SessionStore();
    const a = createApp(store);
    await request(a)
      .post("/session/s1/document")
      .send({ path: "spec.md", title: "spec.md", markdown: "# Spec" })
      .expect(200);
    const s = store.getAll().find((x) => x.sessionId === "s1");
    expect(s?.document?.markdown).toBe("# Spec");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — `setDocument` not a function; 404 on `/document`.

- [ ] **Step 3: Implement `setDocument` in `store.ts`**

Add the method to `SessionStore` (and ensure `DocumentState` is imported from `@deixis/shared`):
```ts
  setDocument(
    sessionId: string,
    doc: { path: string; title: string; markdown: string },
  ): SessionState {
    const state = this.ensureSession(sessionId);
    state.document = { ...doc, openedAt: Date.now() };
    this.emitSession(state);
    return state;
  }
```

- [ ] **Step 4: Add the route in `server.ts`**

In `createApp`, after the other POST routes (before `GET /sessions`), add (uses the existing `wrap` helper):
```ts
  app.post("/session/:id/document", wrap(store, (req) =>
    store.setDocument(req.params.id, {
      path: String(req.body?.path ?? ""),
      title: String(req.body?.title ?? "document"),
      markdown: String(req.body?.markdown ?? ""),
    }),
  ));
```

- [ ] **Step 5: Run to verify pass + build**

Run: `pnpm --filter @deixis/hub test && pnpm --filter @deixis/hub build`
Expected: all hub tests pass; build clean.

- [ ] **Step 6: Commit**

```bash
git add packages/hub/src/store.ts packages/hub/src/server.ts packages/hub/test/store.test.ts packages/hub/test/server.test.ts
git commit -m "feat(hub): setDocument + POST /session/:id/document"
```

---

## Task 3: shim `loadDocument` + `render_file` tool

**Files:**
- Create: `packages/shim/src/document.ts`
- Modify: `packages/shim/src/index.ts`
- Test: `packages/shim/test/document.test.ts`

**Interfaces:**
- Consumes: `getSessionId`, `label`, `post`, `ensureRegistered` from the shim.
- Produces: `loadDocument(path: string, cwd: string): { path: string; title: string; markdown: string }` (reads + truncates; throws on missing); `render_file` tool.

- [ ] **Step 1: Write the failing test**

`packages/shim/test/document.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDocument } from "../src/document.js";

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe("loadDocument", () => {
  it("reads a file relative to cwd; title is the basename", () => {
    dir = mkdtempSync(join(tmpdir(), "deixis-doc-"));
    writeFileSync(join(dir, "spec.md"), "# Spec\n\nbody");
    const d = loadDocument("spec.md", dir);
    expect(d).toEqual({ path: "spec.md", title: "spec.md", markdown: "# Spec\n\nbody" });
  });

  it("truncates content over the size cap", () => {
    dir = mkdtempSync(join(tmpdir(), "deixis-doc-"));
    writeFileSync(join(dir, "big.md"), "x".repeat(300 * 1024));
    const d = loadDocument("big.md", dir);
    expect(d.markdown.length).toBeLessThan(300 * 1024);
    expect(d.markdown).toContain("truncated");
  });

  it("throws on a missing file", () => {
    dir = mkdtempSync(join(tmpdir(), "deixis-doc-"));
    expect(() => loadDocument("nope.md", dir)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/shim test`
Expected: FAIL — cannot find `../src/document.js`.

- [ ] **Step 3: Implement `packages/shim/src/document.ts`**

```ts
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const MAX_CHARS = 256 * 1024;

export function loadDocument(
  path: string,
  cwd: string,
): { path: string; title: string; markdown: string } {
  const abs = resolve(cwd, path);
  let markdown = readFileSync(abs, "utf8");
  if (markdown.length > MAX_CHARS) {
    markdown = markdown.slice(0, MAX_CHARS) + "\n\n*…truncated (file exceeds 256 KB)*";
  }
  return { path, title: basename(abs), markdown };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deixis/shim test`
Expected: PASS (3 document tests).

- [ ] **Step 5: Add the `render_file` tool in `index.ts`**

Add `import { loadDocument } from "./document.js";` and register the tool alongside the others (it uses the existing lazy `ensureRegistered()` + `getSessionId()` + `post`):
```ts
server.tool(
  "render_file",
  "Show a file (e.g. a spec or plan, Markdown) in this session's Deixis reading view, so the user can review it in the browser instead of opening an editor. Then ask for their verdict in a normal message (include the spec inline) so they can also approve from Remote Control on a phone.",
  { path: z.string() },
  async ({ path }) => {
    let doc;
    try {
      doc = loadDocument(path, process.cwd());
    } catch {
      return reply(`Deixis: can't read ${path}`, "");
    }
    const err =
      (await ensureRegistered()) ?? (await post(`/session/${getSessionId()}/document`, doc));
    return reply(err, "shown on Deixis");
  },
);
```

- [ ] **Step 6: Build + manual smoke (against a spare-port hub)**

Run:
```bash
pnpm --filter @deixis/shim build && pnpm --filter @deixis/hub build
DEIXIS_PORT=3994 node packages/hub/dist/index.js & sleep 1
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"render_file","arguments":{"path":"README.md"}}}' \
 | DEIXIS_HUB_URL=http://localhost:3994 node packages/shim/dist/index.js >/dev/null 2>&1
curl -s --max-time 1 localhost:3994/events | head -1 | grep -o '"document"' && echo "document set"
kill %1
```
Expected: the snapshot contains a `document` for the session.

- [ ] **Step 7: Commit**

```bash
git add packages/shim/src/document.ts packages/shim/src/index.ts packages/shim/test/document.test.ts
git commit -m "feat(shim): render_file tool — read a file into the Deixis reading view"
```

---

## Task 4: dashboard reading overlay

**Files:**
- Create: `packages/web/src/components/ReadingOverlay.tsx`
- Modify: `packages/web/src/components/SessionCard.tsx`, `packages/web/src/components/Grid.tsx`, `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `DocumentState`, `SessionState`; `renderMarkdown`; `useSessions`.
- Produces: the auto-opening reader + a per-card "View doc" affordance.

- [ ] **Step 1: Create `ReadingOverlay.tsx`**

```tsx
import { useEffect } from "react";
import type { DocumentState } from "@deixis/shared";
import { renderMarkdown } from "../lib/markdown.js";

export function ReadingOverlay({ doc, onClose }: { doc: DocumentState; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-background/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <article
        className="my-10 h-fit w-full max-w-[760px] rounded-[var(--radius)] border bg-background p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between border-b pb-3">
          <h2 className="font-mono text-[13px] text-muted-foreground">{doc.title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </header>
        <div
          className="prose-deixis min-w-0 max-w-full text-[14px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.markdown) }}
        />
        <footer className="mt-6 border-t pt-3 text-[12px] text-muted-foreground">
          Reviewing <span className="font-mono">{doc.path}</span> — reply in your Claude Code session.
        </footer>
      </article>
    </div>
  );
}
```

- [ ] **Step 2: Add a "View doc" affordance to `SessionCard.tsx`**

`SessionCard` gains an optional `onOpenDoc` prop; when the session has a document, render a small button in the header. Update the signature and header:
```tsx
export function SessionCard({
  session,
  onOpenDoc,
}: {
  session: SessionState;
  onOpenDoc?: () => void;
}) {
```
Inside `<header>`, before the status indicator, add:
```tsx
        {session.document && onOpenDoc ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDoc();
            }}
            className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
            title={`Open ${session.document.title}`}
          >
            ▤ doc
          </button>
        ) : null}
```
(Keep the existing collapse-on-header-click; `stopPropagation` prevents the doc button from also toggling collapse.)

- [ ] **Step 3: Thread `onOpenDoc` through `Grid.tsx`**

`Grid` accepts an optional `onOpenDoc?: (s: SessionState) => void` and passes it to each `Card`/`SessionCard`. Update the `Card` helper and both render paths:
```tsx
function Card({
  session,
  onOpenDoc,
}: {
  session: SessionState;
  onOpenDoc?: (s: SessionState) => void;
}) {
  return (
    <motion.div
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
```
Pass `onOpenDoc={onOpenDoc}` to each `<Card>` in both the native and fallback render paths.

- [ ] **Step 4: Wire active-doc state in `App.tsx`**

Replace `App.tsx`:
```tsx
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
```

- [ ] **Step 5: Build + manual end-to-end**

Run:
```bash
pnpm --filter @deixis/web build && pnpm --filter @deixis/hub build
DEIXIS_PORT=3994 node packages/hub/dist/index.js & sleep 1
curl -s -XPOST localhost:3994/session/s1/register -d '{"label":"demo"}' -H 'content-type: application/json' >/dev/null
curl -s -XPOST localhost:3994/session/s1/document -H 'content-type: application/json' \
  -d '{"path":"docs/spec.md","title":"spec.md","markdown":"# Auth spec\n\n## Goal\nDo the thing.\n\n- one\n- two\n\n```ts\nconst x = 1\n```"}' >/dev/null
curl -s localhost:3994/ | grep -o '<div id="root"></div>'
kill %1
```
Then open `http://localhost:3994` and confirm: the overlay auto-opens with the rendered spec; `✕`/Esc/backdrop close it; pushing a new document reopens it; the `▤ doc` button on the card reopens after dismiss; legible in light and dark.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/ReadingOverlay.tsx packages/web/src/components/SessionCard.tsx packages/web/src/components/Grid.tsx packages/web/src/App.tsx
git commit -m "feat(web): auto-opening reading overlay for render_file documents"
```

---

## Task 5: skill nudge + full verification

**Files:**
- Modify: `skill/SKILL.md`

**Interfaces:** none.

- [ ] **Step 1: Add the render_file guidance to `skill/SKILL.md`**

Add a section (after the existing tool guidance):
```markdown
## Showing a spec/plan for review

When you produce a spec, plan, or other document you want the user to review:

1. Call `render_file("<path>")` so it opens in the Deixis reading view — don't ask
   them to open it in an editor.
2. Then ask for the verdict in a **normal message**, and include the spec inline
   (or a tight summary + the path). Do NOT use a blocking/elicitation prompt — a
   plain turn is what Remote Control relays, so the user can read and approve from
   their phone, away from the keyboard.

The browser overlay is the at-the-desk view; your message is the away-from-keyboard
one. Both come from this one step.
```

- [ ] **Step 2: Refresh the installed skill**

Run: `cp skill/SKILL.md ~/.claude/skills/deixis/SKILL.md && echo refreshed`
Expected: prints `refreshed`. (Takes effect in new Claude Code sessions.)

- [ ] **Step 3: Full build + all unit tests**

Run: `pnpm -r build && pnpm -r test`
Expected: all packages build; shared, hub (incl. setDocument + /document), shim (incl. loadDocument), menubar, hook all green.

- [ ] **Step 4: Commit**

```bash
git add skill/SKILL.md
git commit -m "feat(skill): render_file for spec review + plain-turn ask (phone-friendly)"
```

- [ ] **Step 5: Live check (optional; mutates nothing persistent)**

In a fresh Claude Code session, ask it to write a small spec and review it; confirm it calls `render_file` (the doc appears on :3939) and asks for the verdict as a normal message you could answer from Remote Control.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §2 data flow (Tasks 2,3,4) ✓; §3 render_file incl. cwd-resolve, error string, truncation, non-blocking (Task 3) ✓; §4 hub document field + route (Tasks 1,2) ✓; §5 auto-opening overlay, dismissal by sessionId+openedAt, one-at-a-time + card affordance (Task 4) ✓; §6 skill nudge (Task 5) ✓; §1 phone-acceptance hard requirement → skill text mandates a plain turn with inline spec (Task 5, Step 1) ✓; §9 non-goals respected (read-only, no buttons/bridge/editing/menubar) ✓.
- **Placeholder scan:** none — concrete code throughout.
- **Type consistency:** `DocumentState` defined once (Task 1), produced by `setDocument` (Task 2) and `loadDocument`→POST (Task 3), consumed by `ReadingOverlay`/`App` (Task 4); `setDocument(sessionId, {path,title,markdown})` shape matches the route body and the shim POST; `onOpenDoc` signature consistent across App→Grid→SessionCard.
- **No build-break ordering:** `document?` is optional, so Task 1 doesn't break the hub build (unlike v2/v3's required fields).

# Deixis v4 — spec reader (render a file to Deixis) design

**Status:** Design approved 2026-06-20 (v4.0 scope; v4.1 channel bridge deferred)
**Author:** Jakub Dudek
**Builds on:** v1 (canvas) / v2 (telemetry) / v3 (menu bar). Additive, one-way.

---

## 1. Summary

When Claude Code writes a spec/doc and asks you to review it, you currently open
it in VS Code. v4.0 removes that round-trip: the agent calls a tool that renders
the **file** into a clean reading view on Deixis. You read it there; you reply with
your verdict in the terminal or via Remote Control on your phone, as you do today.

This is the **reader** half. The "Approve in the browser and the agent resumes
without touching the terminal" half is **v4.1** (see §8) — deliberately deferred
because it needs Claude Code Channels and a per-session launch flag, and the
reader alone already removes the actual pain (no more VS Code for a read-only
review).

### Why phased (research findings)
- **No external injection:** nothing outside Claude Code can answer a pending
  Claude Code prompt, so a Deixis button can't resume the agent on its own.
- **Channels can push a message into a session** — but only a session **launched
  with `claude --channels …`** (per-process, not global like our hooks/MCP), and a
  pushed message wakes an *idle* session rather than resolving a blocked tool call.
- Therefore the resume-from-Deixis bridge is real but costly/fragile; the reader is
  cheap, robust, and solves the stated problem. Ship the reader first.

---

## 2. Architecture & data flow

One-way, reusing the existing hub + SSE — no new transport, no inbound channel.

```
agent: render_file("docs/spec.md")
   │  shim resolves path vs cwd, reads file
   ▼
POST /session/:id/document {path, title, markdown}  ──▶ hub
                                                       │ stores on SessionState
                                                       │ SSE
                                                       ▼
                                         dashboard auto-opens a reading overlay
```

You read in the overlay, then reply in your Claude Code session (terminal /
Remote Control) — exactly the current verdict path.

---

## 3. The tool: `render_file`

Added to the shim alongside `render_markdown` / `progress_set` / `progress_update`.

- Signature: `render_file(path: string)`.
- Resolves `path` relative to the session cwd (absolute paths used as-is);
  `CLAUDE_PROJECT_DIR`/`process.cwd()` is the base.
- Reads the file as UTF-8. On read failure (missing/unreadable) returns a friendly
  error string to the agent (e.g. `"Deixis: can't read <path>"`) — non-fatal, the
  agent continues.
- POSTs `{ path, title, markdown }` to the hub, where `title` is the file's
  basename and `markdown` is the raw file content (rendered as Markdown in the
  browser; plain-text files still display fine).
- Returns a short success message otherwise. **Non-blocking** — pure display.
- A size guard: if the file is very large (> ~256 KB) it's truncated with a notice,
  to keep the payload and render sane.

---

## 4. Hub

- `SessionState` gains `document?: DocumentState` where
  `DocumentState = { path: string; title: string; markdown: string; openedAt: number }`.
- New route `POST /session/:sessionId/document` → `store.setDocument(sessionId, {path, title, markdown})`, which stamps `openedAt = Date.now()`, sets the field, and emits the existing `session` SSE event. (Uses `ensureSession`, so a doc can arrive before any canvas/telemetry.)
- No new SSE shape — the document rides inside `SessionState`.
- Rendering/sanitizing happens in the browser (not the hub); the hub stores raw markdown.

---

## 5. Dashboard — reading overlay

- A new `ReadingOverlay` component. When any session has a `document` whose
  `openedAt` the client hasn't dismissed, the overlay opens automatically over the
  grid.
- Content: header with the `title` (filename) and a `✕` close; body = the document
  rendered with `renderMarkdown` (the existing sanitized `marked` pipeline) and the
  `prose-deixis` styles; full-width but readability-capped (~760px), vertically
  scrollable. Footer: *"Reviewing `<path>` — reply in your Claude Code session."*
- **Dismissal:** closing sets a client-side "seen" marker keyed by
  `sessionId + openedAt`, so it won't reopen for the same document; a *new*
  `render_file` (new `openedAt`) opens it again.
- **One at a time:** if multiple sessions have undismissed documents, show the most
  recent (largest `openedAt`); the others remain available via their session cards
  (a small "document" affordance on the card opens it).
- Respects the existing light/dark theme. `Esc` and the `✕` close it; clicking the
  backdrop closes it.

---

## 6. Skill nudge

Update `~/.claude/skills/deixis/SKILL.md` (and the repo copy): instruct the agent
that when it produces a spec/plan/doc for the user to review, it should call
`render_file(path)` so the document shows on Deixis rather than asking the user to
open it — then ask for the verdict as usual. The tool plus the behavior change are
what make the workflow real (same pattern as v2's hooks).

---

## 7. Package shape

```
packages/
  shared/   # + DocumentState; SessionState.document?
  hub/      # + POST /session/:id/document; store.setDocument
  shim/     # + render_file tool (read file → POST document)
  web/      # + ReadingOverlay; App mounts it; card affordance to reopen
  (menubar, cli unchanged)
```
Plus the `deixis` skill text.

---

## 8. v4.1 — the channel bridge (designed-for, NOT built)

To later let a **Deixis Approve/Request-changes click resume the agent** across
terminal + phone + browser:

- Ship a **per-session Claude Code Channel** (a small local webhook MCP server);
  sessions launched via a `deixis code` wrapper (`claude --channels server:deixis …`,
  `--dangerously-load-development-channels` until published) register their webhook
  port with the hub.
- The agent renders the spec then **ends its turn and waits**; whichever channel
  answers — terminal reply, Remote Control reply, or a Deixis submit → channel
  webhook → `<channel>` message — resumes it. Inline PR-style comments compose in
  Deixis and ride in the channel message (or a `get_review_feedback` tool).
- Deferred because it requires the launch flag (not global), per-session port
  mapping, and leans on Channels behaving — to be de-risked with a real spike
  before building.

---

## 9. Non-goals (v4.0)

No Approve/Changes buttons or verdict capture · no inline comments · no channel
bridge / no agent-resume from the browser · no in-browser editing (read-only) · no
menu-bar change · no persistence of documents across hub restart (in-memory like
everything else).

---

## 10. Testing

- **Unit (shim):** `render_file` resolves the path, reads the file, and POSTs
  `{path, title, markdown}` with the right shape; missing file → error string, no
  throw; oversize file truncated.
- **Unit (hub):** `POST /session/:id/document` stores `document` with `openedAt`
  and emits; `setDocument` upserts via `ensureSession`.
- **Manual:** call `render_file` against a real spec; the overlay auto-opens with
  the rendered doc; `✕`/Esc/backdrop close; a second `render_file` reopens; light
  and dark both legible.

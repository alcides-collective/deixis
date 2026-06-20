---
name: deixis
description: Use when working through any multi-step task or plan and you want to show live progress and explanations on the Deixis canvas (a browser dashboard at localhost:3939). Activate at the start of planned/multi-step work, when the user says "show this on the canvas", "track this on deixis", "render progress", or whenever a visual companion to a terminal session would help. Drives the render_markdown, progress_set, and progress_update MCP tools.
---

# Deixis Canvas

Deixis gives this terminal session its own card in a browser dashboard
(`http://localhost:3939`). You push two things to it: a **progress checklist**
and a **markdown pane**. Use it to make a long task legible at a glance.

The tools come from the `deixis` MCP server. If the hub isn't running, the tools
return a friendly "canvas not running" string — that is non-fatal. Just carry on
with the task; do not treat it as an error or retry in a loop.

## When to drive the canvas

- **At the start of a multi-step task or plan:** call `progress_set` once with the
  full step list (statuses all `pending`, except the first which you may set to
  `active`).
- **As you work:** call `progress_update` for the single step whose status
  changed — never resend the whole list for one change.
- **To explain what's happening:** call `render_markdown` with a short note on the
  current focus, a decision, or a summary. Replace it as the focus shifts.

Keep it lightweight. The canvas is a companion, not the work. A handful of
`progress_update` calls across a task is right; updating after every trivial action
is noise.

## The three tools

### `progress_set(steps)`
Defines or replaces the checklist. Each step:
```json
{ "id": "unique-string", "name": "human label", "status": "pending",
  "note": "optional short annotation", "substeps": [ /* same shape, one level */ ] }
```
`status` is exactly one of: `pending` | `active` | `done` | `failed` | `blocked`.
Give every step a stable `id` — you need it for `progress_update`.

### `progress_update(stepId, status, note?)`
Flips one step. The hub stamps timing automatically (start on `active`, end on
`done`/`failed`). Use `note` to say *why* (e.g. status `blocked`, note "waiting on
migration"; status `failed`, note "type error in auth.ts").

### `render_markdown(markdown)`
Replaces the card's markdown pane. GFM is supported — headings, lists, tables,
code fences, links, images. Keep it short; it lives in a small card.

## Status semantics

- `active` — you are working on this step right now (keep exactly one active).
- `done` — finished successfully.
- `failed` — attempted and it broke (pair with a `note` on what failed).
- `blocked` — cannot proceed yet (pair with a `note` on what you're waiting for).
- `pending` — not started.

## Typical flow

```
progress_set([
  {id:"plan",  name:"Design approach",      status:"active"},
  {id:"impl",  name:"Implement",            status:"pending"},
  {id:"test",  name:"Write & run tests",    status:"pending"},
  {id:"review",name:"Self-review",          status:"pending"},
])
render_markdown("# Task: add rate limiting\n\nStarting with the token-bucket design.")
...
progress_update("plan", "done")
progress_update("impl", "active")
...
progress_update("test", "failed", "3 cases red — off-by-one on the window")
...
progress_update("test", "done")
render_markdown("All green. Rate limiter live behind the `RL_ENABLED` flag.")
```

## Don't

- Don't block or retry when the hub is down — the tools degrade by design.
- Don't keep two steps `active` at once.
- Don't resend the whole list via `progress_set` to change one step — use `progress_update`.
- Don't narrate trivia. Update at meaningful boundaries.

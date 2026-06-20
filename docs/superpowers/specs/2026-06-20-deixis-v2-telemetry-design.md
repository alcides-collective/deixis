# Deixis v2 — telemetry pipe (status, tokens, cost) design

**Status:** Design approved 2026-06-20 (architecture + 4 scope decisions locked)
**Author:** Jakub Dudek
**Builds on:** v1 (hub + MCP shim + React dashboard + CLI). Same hub, same dashboard.

---

## 1. Summary

v2 adds a **telemetry pipe**: every Claude Code session reports its lifecycle to
the same hub and dashboard, automatically — no canvas tool calls required. Each
session shows a **status** (working / idle / waiting / errored / finished), **live
token usage and dollar cost**, and a **rich activity** view (current tool, last
message, recent tools). Telemetry merges with v1's agent-curated content into **one
card per real Claude Code session**.

All four scope decisions were taken at the maximal setting:
- Data: status **+ tokens + real $ cost** (pricing auto-fetched from OpenRouter).
- Cards: **unified** per-session (agent content + telemetry on one card).
- Status: **hooks + heuristic fallback** (process table / mtime / content).
- Activity: **rich** (current tool, last-message snippet, recent tool history).

### Why now / what's reused
The mature monitors (claude-view, claude-code-monitor, claude-control) prove the
data sources but leave **dollar cost uncomputed** — the `usage` + `model` fields sit
unused in the transcript. We already run a hub with HTTP + SSE, so we add the pipe
without a new daemon, and we fill the cost gap they all left.

---

## 2. Architecture & data flow

```
Claude Code session
   │  hooks: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop
   ▼
hook script (packages/hook)  ──HTTP POST /telemetry/:sessionId/event──┐
                                                                      ▼
                                                                     HUB (:3939)
   transcript JSONL  ◄────── JSONL reader (tokens/cost/activity) ─────┤
   ~/.claude/projects/<cwd>/<id>.jsonl                                │
                                                       status engine ─┤
                                                       pricing service┘
                                                                      │ SSE
                                                                      ▼
                                                                  dashboard
```

- **Hook script** — a tiny, dependency-light Node script Claude Code runs on each
  hook event. Reads the event JSON from stdin, POSTs `{event, sessionId, cwd,
  transcriptPath, toolName?, …}` to the hub. **Must never block or crash Claude
  Code:** short self-timeout, short POST timeout, and it **always exits 0** on any
  error. Fire-and-forget.
- **Hub (extended)** — gains a `telemetry/` module: event routes, a JSONL reader, a
  status engine, and a pricing service. Emits the same SSE `ServerEvent`s the
  dashboard already consumes.
- **No new daemon, no new transport** — reuses the v1 HTTP + SSE hub.

---

## 3. Identity unification (the crux)

A real session can surface under three identities: the v1 MCP shim's *generated*
id, Claude Code's *real* `session_id` (from the hook), and a shared `cwd`. They
must collapse to **one card keyed by Claude Code's real `session_id`.**

- **Hook side:** carries the real `session_id` and `transcript_path` directly — it
  is the identity source of truth.
- **Shim side (changed):** the shim stops inventing a UUID. On startup it resolves
  Claude Code's `session_id` by reading the newest transcript under its project dir
  (`~/.claude/projects/<cwd-encoded>/*.jsonl` → the `sessionId` field present in
  every record). It then registers under that id, so shim content and hook
  telemetry land on the same card.
- **Encoding:** project dir = `cwd` with path separators replaced by `-` (verified
  against the real layout, e.g. `/Users/jakubdudek/deixis` →
  `-Users-jakubdudek-deixis`). The plan must confirm Claude Code's exact encoding
  for paths containing dots and resolve by directory match if needed. Prefer the
  hook payload's `transcript_path` wherever a path is available (avoids re-encoding).
- **Fallbacks (in order):** (1) shim reads `session_id` from transcript; (2) if not
  yet resolvable, the hub correlates the shim's card to a hook-registered session by
  `cwd` + recency; (3) if still ambiguous (two live sessions, same cwd), keep them
  as **separate** cards rather than merge wrongly.

`SessionState` gains source flags so the UI knows what a card has:
`hasCanvas` (agent pushed markdown/progress) and `hasTelemetry` (hook/JSONL data).
A telemetry-only session (hook but no canvas tools) is a valid card with status +
cost and no markdown/progress.

---

## 4. Cost engine

- **Pricing source:** on hub start and every 24h, `GET
  https://openrouter.ai/api/v1/models` (public, no API key) → a map
  `modelId → { inputUsdPerToken, outputUsdPerToken }`. Persist the last good fetch
  to disk (`~/.claude/deixis/pricing.json`) and ship a **bundled static snapshot**
  so cost still computes offline or if OpenRouter is unreachable.
- **Model mapping:** normalize Claude Code's `message.model` (e.g.
  `claude-opus-4-…`) to the OpenRouter `anthropic/…` id. Unknown models → cost
  `null` (show tokens only), never crash.
- **Cache multipliers:** OpenRouter lists base input/output prices; Anthropic prices
  the two cache token classes off input — apply cache-write ≈ **1.25× input**,
  cache-read ≈ **0.1× input**:
  ```
  cost = input·p_in
       + output·p_out
       + cache_creation·p_in·1.25
       + cache_read·p_in·0.1
  ```
  (Multipliers live in one constants module; the plan verifies current Anthropic
  ratios.)
- **Token dedup:** assistant rows stream and repeat sharing a message id — dedup by
  `message.id` (fallback `uuid`), keeping the **max `output_tokens`** per id, then
  sum. (The correctness trap every reference repo flagged.)
- **Caveat surfaced in the UI:** on a Max/Pro subscription this `$` is *equivalent
  pay-as-you-go API cost* — a usage gauge, not the actual bill. Label it as such.

---

## 5. Status engine

Per session, a status in: `working | idle | waiting | errored | finished`.

- **Authoritative from hooks:** `UserPromptSubmit`/`PreToolUse` → `working`;
  `PostToolUse` → `working`; permission `Notification` → `waiting`; `Stop` → `idle`.
- **Age-out timers** (because `SessionEnd` is unreliable): `working → idle` after
  ~120s with no event; `idle → finished` after ~1h.
- **Heuristic fallback sweep** (every few seconds): cross-check the OS process table
  (`ps` for live `claude` PIDs, optionally `lsof` for cwd), transcript **mtime**,
  and the last assistant record's `stop_reason` / error text to catch states hooks
  miss — `errored` (error in last turn) and `finished` (no live PID). macOS
  `ps`/`lsof`; the fallback is additive — hook state wins when present and fresh.
- **Hook discipline (restated):** self-timeout, POST timeout, **always exit 0**.

---

## 6. Telemetry data model

Added to `@deixis/shared`:

```ts
export type TelemetryStatus =
  | "working" | "idle" | "waiting" | "errored" | "finished";

export interface TokenUsage {
  input: number; output: number; cacheCreate: number; cacheRead: number;
}

export interface SessionTelemetry {
  status: TelemetryStatus;
  model?: string;
  usage: TokenUsage;
  costUsd: number | null;       // null when model pricing is unknown
  currentTool?: string;         // from the most recent PreToolUse
  recentTools?: string[];       // small ring buffer, newest first
  lastMessage?: string;         // trimmed snippet of the last assistant text
  pid?: number;
  updatedAt: number;
}
```

`SessionState` (extended): add `hasCanvas: boolean`, `hasTelemetry: boolean`, and
`telemetry?: SessionTelemetry`. Identity (`sessionId`) is now Claude Code's real
session id. SSE `ServerEvent` shapes are unchanged (still `snapshot` / `session` /
`remove`) — telemetry rides inside `SessionState`.

---

## 7. UI

- **Extended `SessionCard`:** header gains a **status pill** (color per state),
  **token count**, and **$ cost**. A **rich activity** block shows the current tool,
  a last-message snippet, and a small recent-tools list. The existing
  markdown/progress panes render only when `hasCanvas`.
- **Aggregate bar** (new, top of dashboard): live count of active sessions + total
  tokens + total $ across all cards.
- **Telemetry-only cards** render with status + cost + activity and no
  markdown/progress — so the dashboard now shows **every** Claude Code session, not
  only canvas users.
- **Status colors** reuse the v2 semantic palette already in `globals.css`
  (`working`≈active/amber, `idle`≈muted, `waiting`≈amber, `errored`≈red/failed,
  `finished`≈done/green or greyed). Privacy note: rich activity shows session
  content — it stays on localhost.

---

## 8. Install

- `deixis init` (extended): in addition to the v1 launchd service + MCP
  registration, write the telemetry hooks into `~/.claude/settings.json` — append,
  do not clobber, tag each entry with a `_source: "deixis"` marker, dedup on
  re-run, set per-event `timeout`. Hooks invoke the shipped hook script
  (`packages/hook/dist/index.js`) via `node`.
- `deixis uninstall` (extended): remove only the `_source: "deixis"` hook entries.
- Hooks are **global** (all sessions), matching v1's user-scope install and the
  always-on dashboard intent.

---

## 9. Package shape

```
packages/
  shared/   # + telemetry types (§6)
  hub/      # + telemetry/ module: routes, jsonl-reader, pricing, status-engine
            #   + bundled pricing snapshot (static fallback)
  shim/     # CHANGED: adopt Claude Code's real session_id (§3)
  web/      # + status pill, $ / token display, rich activity, AggregateBar
  cli/      # + install/remove telemetry hooks in settings.json
  hook/     # NEW: tiny dependency-light hook script (stdin JSON -> POST to hub)
```

---

## 10. Non-goals (v2)

No tool-approval interception (the remote-permission pattern bruce has) · no
historical analytics / charts beyond current state · no remote/cloud or LAN
exposure (localhost only) · no auth · no Windows/Linux process heuristics (macOS
`ps`/`lsof`; hooks + JSONL still work cross-platform, only the fallback is
macOS-specific) · no plan-limit / quota tracking.

---

## 11. Testing

- **Unit (hub):** cost engine (token dedup keeping max output; cache-multiplier
  math; unknown-model → null), pricing normalizer (CC model → OpenRouter id, with a
  fixture of the OpenRouter response), status engine (each hook event → state;
  age-out timers; fallback precedence), JSONL reader (fixture transcript →
  usage/model/activity), identity correlation (transcript read; cwd fallback;
  ambiguous → separate).
- **Unit (hook):** given a stdin payload fixture, asserts the POST body shape; never
  throws (hub-down path resolves).
- **Manual:** `deixis init` writes hooks; run real sessions and watch status, tokens,
  $, and activity update live; verify unified card merges canvas + telemetry; verify
  a non-canvas session still appears.

---

## 12. Open caveats / risks

- **Subscription cost semantics** — surfaced in the UI as "equivalent API cost."
- **Project-dir encoding** — must match Claude Code's exact scheme for dotted paths
  (resolve by directory match if the naive replace diverges).
- **OpenRouter model-id mapping** — Anthropic ids may not map 1:1; unknown → tokens
  only, never crash.
- **Hooks are global** — every session on the machine is tracked once installed;
  `deixis uninstall` reverses it.

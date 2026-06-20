# Deixis v3 — menu-bar glance (SwiftBar) design

**Status:** Design approved 2026-06-20
**Author:** Jakub Dudek
**Builds on:** v1 (hub + canvas) and v2 (telemetry). Additive — a new consumer of the hub.

---

## 1. Summary

A macOS **menu-bar item** giving an at-a-glance view of all Claude Code sessions
without opening the dashboard. It answers one question fast: **which session needs
me right now?** Cost is deliberately absent from the bar (it stays on the
dashboard).

Built as a **SwiftBar plugin** — a Node script (`deixis.5s.js`) that SwiftBar
reruns every 5 seconds; each run polls the hub, prints the menu, and fires a
notification on a session's transition to errored/finished. No native app, no code
signing.

### Scope decisions (from brainstorming)
- **Approach:** SwiftBar plugin script (depends on the free SwiftBar app).
- **Dropdown per session:** status + "needs you" highlight, current activity,
  time-in-state, context/token usage.
- **Interactivity:** read-only glance + "Open dashboard".
- **Bar glyph:** needs-attention count — `◆ N` normally, `⚠ N` when any session is
  waiting/errored.
- **Notifications:** native, on a session newly becoming errored or finished.
- **No `$` anywhere in the menu bar.**

---

## 2. Architecture & data flow

```
SwiftBar ──every 5s──> deixis.5s.js ──GET /sessions──> hub (:3939)
                            │
                            ├─ prints SwiftBar-format bar glyph + dropdown
                            └─ osascript "display notification" on new errored/finished
                               (de-duped via a temp-file status cache)
```

The plugin is a stateless-per-run script except for a small temp-file cache it uses
only to detect status *transitions* for notifications. It never holds a long
connection — it polls a one-shot JSON endpoint.

---

## 3. Hub additions (supporting data)

Three small additions; everything else in the hub is unchanged.

### 3.1 `GET /sessions`
A one-shot JSON snapshot: `{ sessions: SessionState[] }` (the same array the SSE
`snapshot` event carries). The existing `GET /events` is an SSE stream that never
closes, so a `curl` from the plugin would hang — the plugin needs a pollable
endpoint that returns and closes.

### 3.2 `statusSince` on telemetry
`SessionTelemetry` gains `statusSince: number` (epoch ms), set **only when the
status value changes** (not on every token/activity update). The plugin renders
time-in-state as `now - statusSince` (e.g. "waiting 3m"). Implemented in the store:
when `setTelemetry` applies a patch whose `status` differs from the current status,
stamp `statusSince = Date.now()`; otherwise preserve it.

### 3.3 `contextTokens` on telemetry
`SessionTelemetry` gains `contextTokens: number` — the **last assistant turn's**
`input_tokens + cache_read_input_tokens` from the transcript (the real current
context-window size). Cumulative `usage` is inflated by cache reads and is a poor
"how full is this session" signal, so the transcript reader additionally extracts
the last row's input+cache_read into `contextTokens`. (`TranscriptSummary` gains
`contextTokens`; `Telemetry.handleEvent` writes it through.)

---

## 4. The SwiftBar plugin (`packages/menubar`)

A Node script with a `#!/usr/bin/env node` shebang, built to `dist/plugin.js` and
installed as `deixis.5s.js` (SwiftBar derives the 5s refresh from the filename).

### 4.1 Each run
1. `GET http://localhost:3939/sessions` (short timeout). On failure → print the
   hub-off bar and exit 0.
2. Classify sessions: `attention` = status `waiting` or `errored`; `active` =
   status `working`.
3. Print the **bar line**: `⚠ <attentionCount>` if any attention, else
   `◆ <activeCount>`. (SwiftBar reads the first line as the menu-bar title; a
   `| sfimage=…` or color param may tint it.)
4. Print `---` then the **dropdown**:
   - Attention sessions first, flagged (color/symbol), then the rest, each:
     `<statusIcon> <label>  <activity>  <timeInState>  <ctxTokens>`.
   - A separator, then `Open dashboard | href=http://localhost:3939`.
5. **Notifications:** read the temp-file cache (`~/.claude/deixis/menubar-state.json`)
   mapping `sessionId → lastStatus`; for any session whose status is now `errored`
   or `finished` and differs from the cached value, run
   `osascript -e 'display notification "<label> <status>" with title "Deixis"'`.
   Write the updated cache. (Fires once per transition.)

### 4.2 Rendering details
- **Status icons:** working ●(amber-ish), waiting ◐, errored ✗, idle ○, finished ✓
  — using SwiftBar SF Symbols or colored text; exact glyphs settled in the plan.
- **Time-in-state:** compact (`12s`, `3m`, `1h`) from `now - statusSince`.
- **Context tokens:** compact (`1.2k`, `48k`, `1.1M`) from `contextTokens`.
- **No `$`** rendered anywhere.

### 4.3 Pure core, testable
The plugin separates a **pure formatter** — `renderMenu(sessions, now): string` and
`diffNotifications(sessions, prevCache): {notifications, nextCache}` — from the I/O
shell (`fetch`, `osascript`, file read/write). The pure functions are unit-tested;
the shell is verified manually.

---

## 5. Install

A `deixis menubar` CLI subcommand:
1. Detect SwiftBar's configured plugin directory via
   `defaults read com.ameba.SwiftBar PluginDirectory` (the folder the user picked on
   first launch). If SwiftBar isn't installed / no plugin dir set, print guidance
   (`brew install swiftbar`, then set a plugin folder) and exit.
2. Symlink the built `packages/menubar/dist/plugin.js` into that folder as
   `deixis.5s.js` (symlink so rebuilds propagate).
3. Print "Menu bar installed — SwiftBar will pick it up within 5s."

`deixis menubar --uninstall` removes the symlink. The main `deixis init` is NOT
changed (the menu bar is opt-in, since it needs SwiftBar).

---

## 6. Package shape

```
packages/
  shared/   # + statusSince, contextTokens on SessionTelemetry
  hub/      # + GET /sessions; statusSince stamping in store; contextTokens in transcript+facade
  menubar/  # NEW: pure renderMenu/diffNotifications + the plugin shell
  cli/      # + `deixis menubar` install/uninstall subcommand
```

---

## 7. Error handling

- Hub unreachable → bar shows a dim `◆ –` with a "Deixis: hub off" dropdown line;
  the script always exits 0 (a failing SwiftBar plugin shows an error glyph).
- Malformed `/sessions` response → treat as hub-off, never throw.
- `osascript`/notification failure → swallowed; never blocks the menu render.
- Missing/corrupt temp cache → treated as empty (may re-notify once; acceptable).

---

## 8. Testing

- **Unit (menubar):** `renderMenu` (attention pinned + flagged; bar glyph switches
  `◆`↔`⚠`; time-in-state and token formatting; hub-off rendering) and
  `diffNotifications` (fires only on new errored/finished transitions; de-dupes via
  cache; no spurious fires on unchanged status).
- **Unit (hub):** `GET /sessions` returns the snapshot; `statusSince` updates only on
  status change (not on token-only updates); transcript reader extracts
  `contextTokens` from the last turn.
- **Manual:** install via `deixis menubar`, confirm SwiftBar shows the glyph,
  dropdown ordering/flags, time-in-state ticking, and a notification on a session
  finishing.

---

## 9. Non-goals (v3)

No interactive controls (start/stop hub, clear, per-session actions) · no `$` in the
bar · no native Swift app · no cross-platform (SwiftBar/macOS only) · no charts ·
no auto-install in `deixis init` (opt-in).

---

## 10. Open caveats

- **SwiftBar dependency** — the user must install SwiftBar and set a plugin folder;
  `deixis menubar` guides but can't fully automate the SwiftBar setup.
- **Notification timing** — bounded by the 5s refresh; a session that errors and is
  cleared within 5s could be missed (acceptable).
- **SwiftBar defaults domain** — `com.ameba.SwiftBar` is the current bundle id; the
  plan verifies it against the installed version.

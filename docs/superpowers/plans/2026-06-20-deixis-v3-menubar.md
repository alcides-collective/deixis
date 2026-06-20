# Deixis v3 Menu-Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a macOS menu-bar glance (SwiftBar plugin) showing every Claude Code session's status, activity, time-in-state, and context size — with a needs-attention glyph and notifications on errored/finished — fed by small hub additions.

**Architecture:** A new `packages/menubar` ships a Node script (`deixis.5s.js`) that SwiftBar reruns every 5s; it polls a new one-shot `GET /sessions` endpoint, prints the SwiftBar menu, and fires `osascript` notifications on status transitions. The hub gains `statusSince` and `contextTokens` telemetry fields to support time-in-state and context display. A `deixis menubar` CLI subcommand symlinks the plugin into SwiftBar's folder.

**Tech Stack:** TypeScript, pnpm workspaces, Node LTS, Vitest, Express (existing hub), SwiftBar (external), `osascript`/`defaults` via `node:child_process`.

## Global Constraints

- **Language:** TypeScript everywhere; ESM (`"type":"module"`); `.js` relative import specifiers; Node `>=20`.
- **No `$`/cost rendered anywhere in the menu bar** — cost stays on the dashboard.
- **Plugin must never error out:** every run exits 0; hub-unreachable and malformed responses render a "hub off" menu, never throw.
- **Bar glyph:** `◆ <activeCount>` when none need attention; `⚠ <attentionCount>` when any session is `waiting` or `errored`.
- **Notifications:** fire once per transition into `errored` or `finished`, de-duped via a temp-file cache at `~/.claude/deixis/menubar-state.json`.
- **`statusSince`** is stamped only when the status value changes (not on token-only updates).
- **`contextTokens`** = the last assistant turn's `input_tokens + cache_read_input_tokens`.
- **SwiftBar plugin dir** read via `defaults read com.ameba.SwiftBar PluginDirectory`; plugin installed as `deixis.5s.js`.
- **Opt-in:** the menu bar is NOT added to `deixis init`.
- **Status enum (verbatim):** `"working" | "idle" | "waiting" | "errored" | "finished"`.

---

## File Structure

```
packages/
  shared/src/index.ts          # + statusSince, contextTokens on SessionTelemetry
  hub/
    src/store.ts               # statusSince stamping in setTelemetry; base defaults
    src/server.ts              # + GET /sessions
    src/telemetry/transcript.ts# + contextTokens (last-turn input+cache_read)
    src/telemetry/index.ts     # handleEvent writes contextTokens through
    test/store.test.ts         # statusSince behavior
    test/server.test.ts        # GET /sessions
    test/telemetry/transcript.test.ts  # contextTokens
  menubar/                     # NEW package
    package.json, tsconfig.json
    src/core.ts                # PURE: renderMenu, renderOffline, diffNotifications, formatters
    src/plugin.ts              # I/O shell: fetch + osascript + cache; the executable
    test/core.test.ts
  cli/src/index.ts             # + `deixis menubar [--uninstall]`
```

---

## Milestone 0 — Shared types

### Task 1: Add `statusSince` + `contextTokens` to `SessionTelemetry`

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `SessionTelemetry` with two new required fields `contextTokens: number` and `statusSince: number`.

- [ ] **Step 1: Add the fields**

In `packages/shared/src/index.ts`, modify the `SessionTelemetry` interface to add the two fields (place them after `costUsd`):
```ts
export interface SessionTelemetry {
  status: TelemetryStatus;
  model?: string;
  usage: TokenUsage;
  costUsd: number | null;
  contextTokens: number;   // last-turn input + cache_read (current context size)
  statusSince: number;     // epoch ms when the status value last changed
  currentTool?: string;
  recentTools?: string[];
  lastMessage?: string;
  pid?: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @deixis/shared build`
Expected: compiles, emits the two new fields in `dist/index.d.ts`.
(Note: the hub `tsc` build will now be red until Task 2 updates the store's telemetry literal — Vitest is unaffected since it doesn't type-check. Task 2 restores it.)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): statusSince and contextTokens on SessionTelemetry"
```

---

## Milestone 1 — Hub support

### Task 2: `statusSince` stamping in the store

**Files:**
- Modify: `packages/hub/src/store.ts`
- Test: `packages/hub/test/store.test.ts` (append)

**Interfaces:**
- Consumes: `SessionTelemetry` (with new fields).
- Produces: `setTelemetry` now stamps `statusSince` on status change and defaults `contextTokens`/`statusSince` for new telemetry.

- [ ] **Step 1: Append failing tests**

`packages/hub/test/store.test.ts` (add):
```ts
describe("SessionStore statusSince", () => {
  it("defaults statusSince and contextTokens on first telemetry", () => {
    const store = new SessionStore();
    store.ensureSession("id");
    const s = store.setTelemetry("id", { status: "working" });
    expect(typeof s.telemetry!.statusSince).toBe("number");
    expect(s.telemetry!.contextTokens).toBe(0);
  });

  it("preserves statusSince on a non-status patch", () => {
    const store = new SessionStore();
    store.ensureSession("id");
    const a = store.setTelemetry("id", { status: "working" });
    const since = a.telemetry!.statusSince;
    const b = store.setTelemetry("id", { contextTokens: 500 });
    expect(b.telemetry!.statusSince).toBe(since);
    expect(b.telemetry!.status).toBe("working");
  });

  it("re-stamps statusSince when status changes", () => {
    const store = new SessionStore();
    store.ensureSession("id");
    const a = store.setTelemetry("id", { status: "working" });
    const b = store.setTelemetry("id", { status: "idle" });
    expect(b.telemetry!.statusSince).toBeGreaterThanOrEqual(a.telemetry!.statusSince);
    expect(b.telemetry!.status).toBe("idle");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — `contextTokens`/`statusSince` undefined on the default base.

- [ ] **Step 3: Implement**

Replace the `setTelemetry` method in `packages/hub/src/store.ts` with:
```ts
  setTelemetry(sessionId: string, patch: Partial<SessionTelemetry>): SessionState {
    const state = this.ensureSession(sessionId);
    const base: SessionTelemetry = state.telemetry ?? {
      status: "idle",
      usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      costUsd: null,
      contextTokens: 0,
      statusSince: Date.now(),
      updatedAt: Date.now(),
    };
    const now = Date.now();
    const statusChanged = patch.status !== undefined && patch.status !== base.status;
    state.telemetry = {
      ...base,
      ...patch,
      statusSince: statusChanged ? now : base.statusSince,
      updatedAt: now,
    };
    state.hasTelemetry = true;
    this.emitSession(state);
    return state;
  }
```

- [ ] **Step 4: Run to verify pass + build**

Run: `pnpm --filter @deixis/hub test && pnpm --filter @deixis/hub build`
Expected: all hub tests pass; `tsc` build is GREEN again.

- [ ] **Step 5: Commit**

```bash
git add packages/hub/src/store.ts packages/hub/test/store.test.ts
git commit -m "feat(hub): stamp statusSince on status change; default contextTokens"
```

---

### Task 3: `GET /sessions` snapshot endpoint

**Files:**
- Modify: `packages/hub/src/server.ts`
- Test: `packages/hub/test/server.test.ts` (append)

**Interfaces:**
- Produces: `GET /sessions` → `{ sessions: SessionState[] }` (one-shot JSON).

- [ ] **Step 1: Append failing test**

`packages/hub/test/server.test.ts` (add):
```ts
describe("GET /sessions", () => {
  it("returns a one-shot snapshot of all sessions", async () => {
    const store = new SessionStore();
    store.register("s1", "proj");
    const res = await request(createApp(store)).get("/sessions").expect(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].sessionId).toBe("s1");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — 404 on `/sessions`.

- [ ] **Step 3: Implement**

In `packages/hub/src/server.ts`, add this route inside `createApp`, after the existing `POST` routes and before `GET /events`:
```ts
  app.get("/sessions", (_req, res) => {
    res.json({ sessions: store.getAll() });
  });
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deixis/hub test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/hub/src/server.ts packages/hub/test/server.test.ts
git commit -m "feat(hub): GET /sessions one-shot snapshot endpoint"
```

---

### Task 4: `contextTokens` in the transcript reader + facade

**Files:**
- Modify: `packages/hub/src/telemetry/transcript.ts`, `packages/hub/src/telemetry/index.ts`
- Test: `packages/hub/test/telemetry/transcript.test.ts` (append)

**Interfaces:**
- Produces: `TranscriptSummary` gains `contextTokens: number` (last assistant turn's `input + cache_read`); `Telemetry.handleEvent` writes it through to telemetry.

- [ ] **Step 1: Append failing test**

`packages/hub/test/telemetry/transcript.test.ts` (add inside the existing `describe("parseTranscript", ...)` or a new one):
```ts
it("extracts contextTokens from the last assistant turn (input + cache_read)", () => {
  const lines = [
    '{"type":"assistant","message":{"id":"a","model":"m","usage":{"input_tokens":100,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":2000},"content":[{"type":"text","text":"x"}]}}',
    '{"type":"assistant","message":{"id":"b","model":"m","usage":{"input_tokens":50,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":300},"content":[{"type":"text","text":"y"}]}}',
  ];
  const s = parseTranscript(lines);
  // last turn b: 50 + 300
  expect(s.contextTokens).toBe(350);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — `contextTokens` undefined on the summary.

- [ ] **Step 3: Implement in `transcript.ts`**

Add `contextTokens` to the `TranscriptSummary` interface:
```ts
export interface TranscriptSummary {
  usage: TokenUsage;
  model?: string;
  lastMessage?: string;
  hasError: boolean;
  contextTokens: number;
}
```
In `parseTranscript`, declare `let contextTokens = 0;` near the other accumulators, and inside the assistant-usage branch (where `u` is read) set it each iteration so the last row wins:
```ts
    contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
```
Then include it in the returned summary object: `return { usage, model, lastMessage, hasError, contextTokens };`.

- [ ] **Step 4: Wire through the facade**

In `packages/hub/src/telemetry/index.ts`, in `handleEvent`'s transcript branch, add `contextTokens` to the `setTelemetry` patch:
```ts
        this.store.setTelemetry(sessionId, {
          model: t.model,
          usage: t.usage,
          costUsd: computeCost(t.usage, price),
          contextTokens: t.contextTokens,
          lastMessage: t.lastMessage,
          status: t.hasError ? "errored" : status,
        });
```

- [ ] **Step 5: Run to verify pass + build**

Run: `pnpm --filter @deixis/hub test && pnpm --filter @deixis/hub build`
Expected: all hub tests pass; build clean.

- [ ] **Step 6: Commit**

```bash
git add packages/hub/src/telemetry/transcript.ts packages/hub/src/telemetry/index.ts packages/hub/test/telemetry/transcript.test.ts
git commit -m "feat(hub): contextTokens from last transcript turn, wired through telemetry"
```

---

## Milestone 2 — Menu-bar plugin

### Task 5: Pure core — `renderMenu`, `renderOffline`, `diffNotifications`

**Files:**
- Create: `packages/menubar/package.json`, `packages/menubar/tsconfig.json`, `packages/menubar/src/core.ts`
- Test: `packages/menubar/test/core.test.ts`

**Interfaces:**
- Consumes: `SessionState`, `TelemetryStatus` from `@deixis/shared`.
- Produces:
  - `renderMenu(sessions: SessionState[], now: number): string`
  - `renderOffline(): string`
  - `diffNotifications(sessions: SessionState[], prev: Record<string,string>): { notifications: Array<{label:string; status:string}>; nextCache: Record<string,string> }`
  - `fmtAge(ms: number): string`, `fmtTokens(n: number): string`

- [ ] **Step 1: Create `packages/menubar/package.json`**

```json
{
  "name": "@deixis/menubar",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/plugin.js",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": { "@deixis/shared": "workspace:*" },
  "devDependencies": { "@types/node": "^20.0.0" }
}
```

- [ ] **Step 2: Create `packages/menubar/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: links `@deixis/shared`.

- [ ] **Step 4: Write the failing test**

`packages/menubar/test/core.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderMenu, renderOffline, diffNotifications, fmtAge, fmtTokens } from "../src/core.js";
import type { SessionState } from "@deixis/shared";

function sess(p: Partial<SessionState> & { sessionId: string; label: string }): SessionState {
  return {
    sessionId: p.sessionId, label: p.label, markdown: "", steps: [],
    connectedAt: 0, online: true, hasCanvas: false, hasTelemetry: true,
    telemetry: p.telemetry,
  } as SessionState;
}

const t = (status: string, statusSince: number, currentTool?: string, contextTokens = 0) => ({
  status, statusSince, currentTool, contextTokens,
  usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, costUsd: null, updatedAt: 0,
}) as SessionState["telemetry"];

describe("fmtAge / fmtTokens", () => {
  it("formats ages", () => {
    expect(fmtAge(12_000)).toBe("12s");
    expect(fmtAge(180_000)).toBe("3m");
    expect(fmtAge(3_600_000)).toBe("1h");
  });
  it("formats tokens", () => {
    expect(fmtTokens(900)).toBe("900");
    expect(fmtTokens(48_000)).toBe("48k");
    expect(fmtTokens(1_100_000)).toBe("1.1M");
  });
});

describe("renderMenu", () => {
  it("uses ◆ + active count when nothing needs attention", () => {
    const out = renderMenu([sess({ sessionId: "a", label: "p", telemetry: t("working", 0) })], 0);
    expect(out.split("\n")[0]).toContain("◆ 1");
  });

  it("uses ⚠ + attention count when a session waits or errors", () => {
    const out = renderMenu([
      sess({ sessionId: "a", label: "p", telemetry: t("working", 0) }),
      sess({ sessionId: "b", label: "q", telemetry: t("waiting", 0) }),
    ], 0);
    expect(out.split("\n")[0]).toContain("⚠ 1");
  });

  it("pins waiting/errored sessions above the rest and includes an Open dashboard link", () => {
    const out = renderMenu([
      sess({ sessionId: "a", label: "calm", telemetry: t("idle", 0) }),
      sess({ sessionId: "b", label: "needsme", telemetry: t("errored", 0) }),
    ], 0);
    const body = out.indexOf("calm");
    const attn = out.indexOf("needsme");
    expect(attn).toBeGreaterThan(-1);
    expect(attn).toBeLessThan(body); // errored listed first
    expect(out).toContain("http://localhost:3939");
  });

  it("renders no $ sign anywhere", () => {
    const out = renderMenu([sess({ sessionId: "a", label: "p", telemetry: t("working", 0, "Bash", 48000) })], 0);
    expect(out).not.toContain("$");
  });
});

describe("renderOffline", () => {
  it("shows a hub-off menu", () => {
    const out = renderOffline();
    expect(out.split("\n")[0]).toMatch(/◆/);
    expect(out.toLowerCase()).toContain("hub off");
  });
});

describe("diffNotifications", () => {
  it("fires once on a new transition to errored/finished", () => {
    const sessions = [
      sess({ sessionId: "a", label: "p", telemetry: t("errored", 0) }),
      sess({ sessionId: "b", label: "q", telemetry: t("finished", 0) }),
      sess({ sessionId: "c", label: "r", telemetry: t("working", 0) }),
    ];
    const { notifications, nextCache } = diffNotifications(sessions, {});
    expect(notifications.map((n) => n.label).sort()).toEqual(["p", "q"]);
    expect(nextCache).toEqual({ a: "errored", b: "finished", c: "working" });
  });

  it("does not re-fire when status is unchanged", () => {
    const sessions = [sess({ sessionId: "a", label: "p", telemetry: t("errored", 0) })];
    const { notifications } = diffNotifications(sessions, { a: "errored" });
    expect(notifications).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `pnpm --filter @deixis/menubar test`
Expected: FAIL — cannot find `../src/core.js`.

- [ ] **Step 6: Implement `packages/menubar/src/core.ts`**

```ts
import type { SessionState, TelemetryStatus } from "@deixis/shared";

const DASHBOARD = "http://localhost:3939";

export function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const ICON: Record<TelemetryStatus, string> = {
  working: "●", waiting: "◐", errored: "✗", idle: "○", finished: "✓",
};
const COLOR: Record<TelemetryStatus, string> = {
  working: "#d08770", waiting: "#ebcb8b", errored: "#bf616a", idle: "#888888", finished: "#a3be8c",
};

function needsAttention(s: SessionState): boolean {
  const st = s.telemetry?.status;
  return st === "waiting" || st === "errored";
}

function line(s: SessionState, now: number): string {
  const t = s.telemetry!;
  const age = fmtAge(Math.max(0, now - t.statusSince));
  const tool = t.currentTool ? ` ${t.currentTool}` : "";
  const ctx = t.contextTokens ? ` · ${fmtTokens(t.contextTokens)} ctx` : "";
  return `${ICON[t.status]} ${s.label}  ${t.status} ${age}${tool}${ctx} | color=${COLOR[t.status]}`;
}

export function renderMenu(sessions: SessionState[], now: number): string {
  const withTel = sessions.filter((s) => s.telemetry);
  const attention = withTel.filter(needsAttention);
  const active = withTel.filter((s) => s.telemetry!.status === "working");
  const rest = withTel.filter((s) => !needsAttention(s));

  const bar = attention.length ? `⚠ ${attention.length}` : `◆ ${active.length}`;
  const lines = [bar, "---"];
  for (const s of attention) lines.push(line(s, now));
  if (attention.length && rest.length) lines.push("---");
  for (const s of rest) lines.push(line(s, now));
  lines.push("---", `Open dashboard | href=${DASHBOARD}`);
  return lines.join("\n");
}

export function renderOffline(): string {
  return ["◆ – | color=#888888", "---", "Deixis: hub off", `Open dashboard | href=${DASHBOARD}`].join("\n");
}

export function diffNotifications(
  sessions: SessionState[],
  prev: Record<string, string>,
): { notifications: Array<{ label: string; status: string }>; nextCache: Record<string, string> } {
  const nextCache: Record<string, string> = {};
  const notifications: Array<{ label: string; status: string }> = [];
  for (const s of sessions) {
    const st = s.telemetry?.status;
    if (!st) continue;
    nextCache[s.sessionId] = st;
    if ((st === "errored" || st === "finished") && prev[s.sessionId] !== st) {
      notifications.push({ label: s.label, status: st });
    }
  }
  return { notifications, nextCache };
}
```

- [ ] **Step 7: Run to verify pass**

Run: `pnpm --filter @deixis/menubar test`
Expected: PASS (all core tests).

- [ ] **Step 8: Commit**

```bash
git add packages/menubar pnpm-lock.yaml
git commit -m "feat(menubar): pure SwiftBar menu renderer and notification differ"
```

---

### Task 6: Plugin shell (the executable)

**Files:**
- Create: `packages/menubar/src/plugin.ts`

**Interfaces:**
- Consumes: `renderMenu`, `renderOffline`, `diffNotifications` from `./core.js`.
- Produces: an executable script (built to `dist/plugin.js`) that prints the menu and fires notifications. No automated test (I/O shell; verified manually).

- [ ] **Step 1: Implement `packages/menubar/src/plugin.ts`**

```ts
#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import type { SessionState } from "@deixis/shared";
import { renderMenu, renderOffline, diffNotifications } from "./core.js";

const HUB = process.env.DEIXIS_HUB_URL ?? "http://localhost:3939";
const CACHE = join(process.env.HOME ?? "", ".claude", "deixis", "menubar-state.json");

async function main(): Promise<void> {
  let sessions: SessionState[];
  try {
    const res = await fetch(`${HUB}/sessions`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`hub ${res.status}`);
    sessions = ((await res.json()) as { sessions: SessionState[] }).sessions;
  } catch {
    console.log(renderOffline());
    return;
  }

  console.log(renderMenu(sessions, Date.now()));

  let prev: Record<string, string> = {};
  try {
    prev = JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, string>;
  } catch {
    /* missing/corrupt cache → empty */
  }
  const { notifications, nextCache } = diffNotifications(sessions, prev);
  for (const n of notifications) {
    const label = n.label.replace(/["\\]/g, ""); // sanitize for osascript string
    try {
      execFileSync("osascript", [
        "-e",
        `display notification "${label} ${n.status}" with title "Deixis"`,
      ]);
    } catch {
      /* notification best-effort */
    }
  }
  try {
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(nextCache));
  } catch {
    /* cache write best-effort */
  }
}

void main();
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @deixis/menubar build`
Expected: emits `packages/menubar/dist/plugin.js` with the `#!/usr/bin/env node` shebang preserved, no type errors.

- [ ] **Step 3: Manual smoke (against a hub on a spare port to avoid the launchd hub)**

Run:
```bash
pnpm --filter @deixis/hub build
DEIXIS_PORT=3996 node packages/hub/dist/index.js & sleep 1
curl -s -XPOST localhost:3996/telemetry/m1/event -H 'content-type: application/json' -d '{"event":"Notification","cwd":"/tmp/demo"}'
DEIXIS_HUB_URL=http://localhost:3996 node packages/menubar/dist/plugin.js
kill %1
echo "--- hub-off render ---"
node packages/menubar/dist/plugin.js   # hub now down -> offline menu
```
Expected: first run prints a `⚠ 1` line (the `waiting` session) + a dashboard link; the second prints `◆ –` / "Deixis: hub off". No `$`.

- [ ] **Step 4: Commit**

```bash
git add packages/menubar/src/plugin.ts
git commit -m "feat(menubar): plugin shell polling /sessions with notifications"
```

---

## Milestone 3 — Install

### Task 7: `deixis menubar` CLI subcommand

**Files:**
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Produces: `deixis menubar` (install) and `deixis menubar --uninstall`.

- [ ] **Step 1: Implement the subcommand**

In `packages/cli/src/index.ts`: add imports `import { symlinkSync, unlinkSync, chmodSync } from "node:fs";` (merge with existing `node:fs` imports if present), compute `const pluginSrc = join(repoRoot, "packages", "menubar", "dist", "plugin.js");`, and add a `menubar` function plus dispatch:
```ts
function menubar(uninstall: boolean): void {
  let dir: string;
  try {
    dir = execFileSync("defaults", ["read", "com.ameba.SwiftBar", "PluginDirectory"], {
      encoding: "utf8",
    }).trim();
  } catch {
    console.log(
      "SwiftBar not found or no plugin folder set.\n" +
        "Install it (`brew install swiftbar`), open SwiftBar, set a plugin folder, then re-run `deixis menubar`.",
    );
    process.exit(1);
  }
  const dest = join(dir, "deixis.5s.js");
  if (uninstall) {
    try {
      unlinkSync(dest);
    } catch {
      /* not linked */
    }
    console.log("Menu bar removed.");
    return;
  }
  try {
    chmodSync(pluginSrc, 0o755);
  } catch {
    /* best-effort */
  }
  try {
    unlinkSync(dest);
  } catch {
    /* no prior link */
  }
  symlinkSync(pluginSrc, dest);
  console.log(`Menu bar installed at ${dest} — SwiftBar will pick it up within 5s.`);
}
```
Then in the command dispatch block, add a branch before the usage fallback:
```ts
else if (cmd === "menubar") menubar(process.argv.includes("--uninstall"));
```
And add `menubar` to the usage line: `console.log("Usage: deixis <init|uninstall|status|menubar>");`.

- [ ] **Step 2: Build + read-only check (does NOT touch SwiftBar)**

Run:
```bash
pnpm --filter @deixis/menubar build && pnpm --filter deixis build
node packages/cli/dist/index.js 2>&1 | grep -o "menubar"   # usage mentions menubar
```
Expected: prints `menubar` (usage updated). Do NOT run `deixis menubar` here unless SwiftBar is installed — it mutates the SwiftBar plugin dir.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): deixis menubar install/uninstall subcommand"
```

---

### Task 8: Full v3 verification

**Files:** none (verification only).

- [ ] **Step 1: Full build + all unit tests**

Run: `pnpm -r build && pnpm -r test`
Expected: all packages build; menubar core tests + hub (incl. new statusSince/sessions/contextTokens) + shim + hook all green.

- [ ] **Step 2: Live install + observe (only if SwiftBar is installed; mutates SwiftBar dir)**

Run: `node packages/cli/dist/index.js menubar`, then confirm in the macOS menu bar:
- the glyph shows `◆ N` (or `⚠ N` if a session is waiting/errored),
- the dropdown lists sessions with status · time-in-state · tool · context tokens, attention pinned on top,
- "Open dashboard" opens http://localhost:3939,
- finishing a session produces a "Deixis" notification.
Remove with `node packages/cli/dist/index.js menubar --uninstall`.

- [ ] **Step 3: Commit any fixes surfaced (if none, skip).**

---

## Self-Review (completed during authoring)

- **Spec coverage:** §2 data flow (Tasks 5,6) ✓; §3.1 GET /sessions (Task 3) ✓; §3.2 statusSince (Task 2) ✓; §3.3 contextTokens (Task 4) ✓; §4 plugin glyph/dropdown/notifications/no-$ (Tasks 5,6 + tests asserting `⚠`↔`◆`, attention-pinned, no `$`, dedup) ✓; §5 install via SwiftBar defaults dir (Task 7) ✓; §6 package shape (menubar package Tasks 5,6) ✓; §7 error handling (renderOffline + swallow paths, Task 6) ✓; §8 testing (unit core + hub, manual) ✓.
- **Placeholder scan:** none — glyphs/colors are concrete; SwiftBar bundle id `com.ameba.SwiftBar` used verbatim.
- **Type consistency:** `statusSince`/`contextTokens` defined once (Task 1), defaulted in the store (Task 2), produced by the transcript (Task 4), consumed by the renderer (Task 5); `renderMenu`/`renderOffline`/`diffNotifications` signatures match between Task 5 (def) and Task 6 (use); `/sessions` shape `{sessions}` matches between Task 3 (hub) and Task 6 (plugin).
- **Non-goals respected:** no `$` in the bar (asserted by a test), no interactive controls, no init auto-install, macOS-only.

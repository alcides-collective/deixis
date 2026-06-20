# Deixis v2 Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a telemetry pipe so every Claude Code session reports status, live token usage, OpenRouter-priced dollar cost, and rich activity to the existing Deixis hub/dashboard, merged with v1 canvas content into one card per session.

**Architecture:** A tiny hook script POSTs Claude Code hook events to the existing hub (`:3939`). The hub gains a telemetry module — a pricing service (OpenRouter + static fallback), a transcript JSONL reader (tokens/cost/activity), and a status engine (hook events + age-out timers + process-table fallback). The MCP shim adopts Claude Code's real `session_id` (read from the transcript) so canvas content and telemetry land on the same `SessionState`. The dashboard renders a status pill, token/$ totals, rich activity, and an aggregate bar.

**Tech Stack:** TypeScript, pnpm workspaces, Node LTS, Express + SSE (existing hub), Vitest, React 19 + Tailwind v4 (existing web), `node:child_process` (`ps`/`lsof`), global `fetch`.

## Global Constraints

- **Language:** TypeScript everywhere; ESM (`"type":"module"`); `.js` relative import specifiers; Node `>=20`.
- **Identity:** every session keyed by Claude Code's real `session_id`. The shim resolves it from the transcript; the hook carries it directly.
- **Hook discipline:** the hook script must NEVER block or crash Claude Code — short self-timeout, short POST timeout, and **always `process.exit(0)`** on any error.
- **Token dedup:** sum `message.usage` deduped by `message.id` (fallback `uuid`), keeping the **max `output_tokens`** per id.
- **Cache cost multipliers (verbatim):** cache-write `1.25 × input price`, cache-read `0.1 × input price`.
- **Pricing source:** `GET https://openrouter.ai/api/v1/models` (public, no key); persist last good fetch to `~/.claude/deixis/pricing.json`; bundle a static snapshot fallback; unknown model → `costUsd: null` (never crash).
- **Status enum (verbatim):** `"working" | "idle" | "waiting" | "errored" | "finished"`.
- **Hooks installed globally** into `~/.claude/settings.json`, append-not-clobber, each entry tagged `"_source": "deixis"`, deduped on re-run.
- **Cost label:** the dollar figure is "equivalent API cost" (subscription users aren't billed per token).
- **Platform:** process-table fallback is macOS (`ps`/`lsof`); hooks + JSONL are cross-platform.
- **Transcript path:** prefer the hook payload's `transcript_path`; only re-encode `cwd` (separators → `-`) when no path is available.

---

## File Structure

```
packages/
  shared/src/index.ts                 # + TelemetryStatus, TokenUsage, SessionTelemetry; extend SessionState
  hub/
    src/telemetry/pricing.ts          # PricingTable + fetch/normalize/computeCost
    src/telemetry/pricing-snapshot.json  # static fallback prices
    src/telemetry/transcript.ts       # readTranscript: usage(dedup)+model+lastMessage+hasError
    src/telemetry/status.ts           # StatusEngine: events + age-out + fallback classify
    src/telemetry/index.ts            # Telemetry facade wiring pricing+transcript+status into the store
    src/store.ts                      # extend SessionState fields + telemetry mutators
    src/server.ts                     # + POST /telemetry/:id/event
    src/index.ts                      # init pricing + status tick interval
    test/telemetry/pricing.test.ts
    test/telemetry/transcript.test.ts
    test/telemetry/status.test.ts
    test/telemetry/fixtures/transcript.jsonl
  hook/                               # NEW package
    package.json, tsconfig.json
    src/index.ts                      # stdin JSON -> POST /telemetry/:id/event
    test/payload.test.ts
  shim/src/hub-client.ts              # resolve real session_id from transcript
  web/src/
    lib/cost.ts                       # formatUsd, formatTokens, statusColor helpers
    components/StatusPill.tsx
    components/Activity.tsx
    components/AggregateBar.tsx
    components/SessionCard.tsx        # extend: pill + tokens/$ + activity; canvas panes gated on hasCanvas
    App.tsx                           # mount AggregateBar
  cli/src/hooks.ts                    # install/remove deixis hooks in settings.json
  cli/src/index.ts                    # init/uninstall call hooks install/remove
```

---

## Milestone 0 — Shared telemetry types

### Task 1: Telemetry types in `@deixis/shared`

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `TelemetryStatus`, `TokenUsage`, `SessionTelemetry`; `SessionState` extended with `hasCanvas`, `hasTelemetry`, `telemetry?`.

- [ ] **Step 1: Append types**

Add to `packages/shared/src/index.ts`:
```ts
export type TelemetryStatus =
  | "working" | "idle" | "waiting" | "errored" | "finished";

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface SessionTelemetry {
  status: TelemetryStatus;
  model?: string;
  usage: TokenUsage;
  costUsd: number | null;   // null when model pricing is unknown
  currentTool?: string;
  recentTools?: string[];   // newest first, capped
  lastMessage?: string;     // trimmed assistant snippet
  pid?: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Extend `SessionState`**

Modify the `SessionState` interface in the same file to add three fields:
```ts
export interface SessionState {
  sessionId: string;
  label: string;
  markdown: string;
  steps: Step[];
  connectedAt: number;
  online: boolean;
  hasCanvas: boolean;       // agent pushed markdown/progress
  hasTelemetry: boolean;    // hook/JSONL data present
  telemetry?: SessionTelemetry;
}
```

- [ ] **Step 3: Build**

Run: `pnpm --filter @deixis/shared build`
Expected: compiles, emits `dist/index.d.ts` with the new types.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): telemetry types and SessionState extension"
```

---

## Milestone 1 — Cost engine

### Task 2: Pricing snapshot + `PricingTable`

**Files:**
- Create: `packages/hub/src/telemetry/pricing-snapshot.json`, `packages/hub/src/telemetry/pricing.ts`
- Test: `packages/hub/test/telemetry/pricing.test.ts`

**Interfaces:**
- Consumes: `TokenUsage` from `@deixis/shared`.
- Produces: `class PricingTable` with `load(openrouterModels: OpenRouterModel[]): void`, `priceFor(model: string): Price | null`; `computeCost(usage: TokenUsage, price: Price | null): number | null`; types `Price = {input:number; output:number}`, `OpenRouterModel = {id:string; pricing:{prompt:string; completion:string}}`.

- [ ] **Step 1: Create the snapshot**

`packages/hub/src/telemetry/pricing-snapshot.json` (USD per token; verify against current Anthropic pricing during review):
```json
{
  "opus":   { "input": 0.000015,  "output": 0.000075 },
  "sonnet": { "input": 0.000003,  "output": 0.000015 },
  "haiku":  { "input": 0.0000008, "output": 0.000004 }
}
```

- [ ] **Step 2: Write the failing test**

`packages/hub/test/telemetry/pricing.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PricingTable, computeCost } from "../../src/telemetry/pricing.js";

describe("PricingTable", () => {
  it("falls back to family pricing from the snapshot", () => {
    const t = new PricingTable();
    expect(t.priceFor("claude-opus-4-8")).toEqual({ input: 0.000015, output: 0.000075 });
    expect(t.priceFor("claude-3-5-sonnet-20241022")).toEqual({ input: 0.000003, output: 0.000015 });
    expect(t.priceFor("claude-haiku-4-5")).toEqual({ input: 0.0000008, output: 0.000004 });
  });

  it("returns null for unknown models", () => {
    expect(new PricingTable().priceFor("gpt-4o")).toBeNull();
  });

  it("prefers exact OpenRouter ids after load()", () => {
    const t = new PricingTable();
    t.load([{ id: "anthropic/claude-opus-4", pricing: { prompt: "0.00002", completion: "0.0001" } }]);
    expect(t.priceFor("anthropic/claude-opus-4")).toEqual({ input: 0.00002, output: 0.0001 });
  });

  it("computeCost applies cache multipliers", () => {
    const price = { input: 0.000003, output: 0.000015 };
    const usage = { input: 1000, output: 500, cacheCreate: 200, cacheRead: 4000 };
    // 1000*3e-6 + 500*15e-6 + 200*3e-6*1.25 + 4000*3e-6*0.1
    expect(computeCost(usage, price)).toBeCloseTo(0.003 + 0.0075 + 0.00075 + 0.0012, 9);
  });

  it("computeCost returns null when price is null", () => {
    expect(computeCost({ input: 1, output: 1, cacheCreate: 0, cacheRead: 0 }, null)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — cannot find `../../src/telemetry/pricing.js`.

- [ ] **Step 4: Implement**

`packages/hub/src/telemetry/pricing.ts`:
```ts
import type { TokenUsage } from "@deixis/shared";
import snapshot from "./pricing-snapshot.json" with { type: "json" };

export interface Price { input: number; output: number }
export interface OpenRouterModel { id: string; pricing: { prompt: string; completion: string } }

const CACHE_WRITE_MULT = 1.25;
const CACHE_READ_MULT = 0.1;
type Family = "opus" | "sonnet" | "haiku";

export class PricingTable {
  private byId = new Map<string, Price>();
  private families: Record<Family, Price> = snapshot as Record<Family, Price>;

  load(models: OpenRouterModel[]): void {
    for (const m of models) {
      if (!m.id.startsWith("anthropic/")) continue;
      const price: Price = {
        input: parseFloat(m.pricing.prompt),
        output: parseFloat(m.pricing.completion),
      };
      if (!Number.isFinite(price.input) || !Number.isFinite(price.output)) continue;
      this.byId.set(m.id.toLowerCase(), price);
      for (const fam of ["opus", "sonnet", "haiku"] as Family[]) {
        if (m.id.includes(fam)) this.families[fam] = price;
      }
    }
  }

  priceFor(model: string): Price | null {
    const norm = model.toLowerCase();
    const exact = this.byId.get(norm) ?? this.byId.get(`anthropic/${norm}`);
    if (exact) return exact;
    if (norm.includes("opus")) return this.families.opus;
    if (norm.includes("sonnet")) return this.families.sonnet;
    if (norm.includes("haiku")) return this.families.haiku;
    return null;
  }
}

export function computeCost(usage: TokenUsage, price: Price | null): number | null {
  if (!price) return null;
  return (
    usage.input * price.input +
    usage.output * price.output +
    usage.cacheCreate * price.input * CACHE_WRITE_MULT +
    usage.cacheRead * price.input * CACHE_READ_MULT
  );
}
```

- [ ] **Step 5: Add JSON import support to the hub tsconfig**

Ensure `packages/hub/tsconfig.json` `compilerOptions` includes `"resolveJsonModule": true`. If absent, add it.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @deixis/hub test`
Expected: PASS (5 pricing tests).

- [ ] **Step 7: Commit**

```bash
git add packages/hub/src/telemetry/pricing.ts packages/hub/src/telemetry/pricing-snapshot.json packages/hub/test/telemetry/pricing.test.ts packages/hub/tsconfig.json
git commit -m "feat(hub): pricing table with OpenRouter load and cache-aware cost"
```

---

### Task 3: Pricing fetch + disk cache

**Files:**
- Modify: `packages/hub/src/telemetry/pricing.ts`

**Interfaces:**
- Produces: `async function refreshPricing(table: PricingTable, cachePath: string): Promise<void>` — fetches OpenRouter, loads the table, writes the raw model list to `cachePath`; on fetch failure, loads from `cachePath` if present; never throws.

- [ ] **Step 1: Implement refresh (no unit test — network/fs side effects; covered manually)**

Append to `packages/hub/src/telemetry/pricing.ts`:
```ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";

export async function refreshPricing(table: PricingTable, cachePath: string): Promise<void> {
  try {
    const res = await fetch(OPENROUTER_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const body = (await res.json()) as { data: OpenRouterModel[] };
    table.load(body.data);
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(body.data));
  } catch {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8")) as OpenRouterModel[];
      table.load(cached);
    } catch {
      /* keep snapshot-only families */
    }
  }
}
```

- [ ] **Step 2: Build to type-check**

Run: `pnpm --filter @deixis/hub build`
Expected: compiles cleanly.

- [ ] **Step 3: Manual fetch smoke (optional, requires network)**

Run:
```bash
node -e "import('./packages/hub/dist/telemetry/pricing.js').then(async m=>{const t=new m.PricingTable(); await m.refreshPricing(t, '/tmp/deixis-pricing.json'); console.log('opus', t.priceFor('claude-opus-4-8'));})"
```
Expected: prints an opus price (from OpenRouter if online, else snapshot), no throw; `/tmp/deixis-pricing.json` written when online.

- [ ] **Step 4: Commit**

```bash
git add packages/hub/src/telemetry/pricing.ts
git commit -m "feat(hub): OpenRouter pricing refresh with disk-cache fallback"
```

---

## Milestone 2 — Transcript JSONL reader

### Task 4: `readTranscript`

**Files:**
- Create: `packages/hub/src/telemetry/transcript.ts`, `packages/hub/test/telemetry/fixtures/transcript.jsonl`
- Test: `packages/hub/test/telemetry/transcript.test.ts`

**Interfaces:**
- Consumes: `TokenUsage` from `@deixis/shared`.
- Produces: `function parseTranscript(lines: string[]): TranscriptSummary` and `async function readTranscript(path: string): Promise<TranscriptSummary>`, where `TranscriptSummary = { usage: TokenUsage; model?: string; lastMessage?: string; hasError: boolean }`.

- [ ] **Step 1: Create the fixture**

`packages/hub/test/telemetry/fixtures/transcript.jsonl` (note the duplicated assistant id `m1` — the streamed-row trap; the second copy has the larger `output_tokens` and must win, not sum twice):
```jsonl
{"type":"user","message":{"role":"user","content":"hi"}}
{"type":"assistant","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"thinking"}]}}
{"type":"assistant","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":40,"cache_creation_input_tokens":5,"cache_read_input_tokens":200},"content":[{"type":"text","text":"hello there"}],"stop_reason":"end_turn"}}
{"type":"assistant","message":{"id":"m2","model":"claude-opus-4-8","usage":{"input_tokens":50,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"final answer"}],"stop_reason":"end_turn"}}
```

- [ ] **Step 2: Write the failing test**

`packages/hub/test/telemetry/transcript.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript, readTranscript } from "../../src/telemetry/transcript.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "transcript.jsonl");

describe("parseTranscript", () => {
  it("dedups usage by message id keeping max output, sums across ids", () => {
    const lines = readFileSync(fixture, "utf8").trim().split("\n");
    const s = parseTranscript(lines);
    // m1 -> max output row (input100, output40, cc5, cr200); m2 -> (50,20,0,0)
    expect(s.usage).toEqual({ input: 150, output: 60, cacheCreate: 5, cacheRead: 200 });
    expect(s.model).toBe("claude-opus-4-8");
    expect(s.lastMessage).toBe("final answer");
    expect(s.hasError).toBe(false);
  });

  it("reads from a file path", async () => {
    const s = await readTranscript(fixture);
    expect(s.usage.output).toBe(60);
  });

  it("flags hasError on an error stop_reason", () => {
    const s = parseTranscript([
      '{"type":"assistant","message":{"id":"e1","model":"x","usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"oops"}],"stop_reason":"error"}}',
    ]);
    expect(s.hasError).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — cannot find `../../src/telemetry/transcript.js`.

- [ ] **Step 4: Implement**

`packages/hub/src/telemetry/transcript.ts`:
```ts
import { readFile, stat } from "node:fs/promises";
import type { TokenUsage } from "@deixis/shared";

export interface TranscriptSummary {
  usage: TokenUsage;
  model?: string;
  lastMessage?: string;
  hasError: boolean;
}

interface Row {
  type?: string;
  uuid?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
  };
}

function textOf(row: Row): string | undefined {
  const block = row.message?.content?.find((c) => c.type === "text" && c.text);
  return block?.text?.trim();
}

export function parseTranscript(lines: string[]): TranscriptSummary {
  const byId = new Map<string, TokenUsage>();
  let model: string | undefined;
  let lastMessage: string | undefined;
  let hasError = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    let row: Row;
    try {
      row = JSON.parse(line) as Row;
    } catch {
      continue;
    }
    if (row.type !== "assistant" || !row.message?.usage) continue;

    model = row.message.model ?? model;
    const text = textOf(row);
    if (text) lastMessage = text;
    if (row.message.stop_reason === "error") hasError = true;

    const u = row.message.usage;
    const cur: TokenUsage = {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheCreate: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    };
    const id = row.message.id ?? row.uuid ?? `${byId.size}`;
    const prev = byId.get(id);
    if (!prev || cur.output > prev.output) byId.set(id, cur);
  }

  const usage: TokenUsage = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  for (const v of byId.values()) {
    usage.input += v.input;
    usage.output += v.output;
    usage.cacheCreate += v.cacheCreate;
    usage.cacheRead += v.cacheRead;
  }
  return { usage, model, lastMessage, hasError };
}

// Cache by path -> {mtimeMs, summary} so repeated reads of an unchanged file are cheap.
const cache = new Map<string, { mtimeMs: number; summary: TranscriptSummary }>();

export async function readTranscript(path: string): Promise<TranscriptSummary> {
  const { mtimeMs } = await stat(path);
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.summary;
  const text = await readFile(path, "utf8");
  const summary = parseTranscript(text.split("\n"));
  cache.set(path, { mtimeMs, summary });
  return summary;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @deixis/hub test`
Expected: PASS (3 transcript tests).

- [ ] **Step 6: Commit**

```bash
git add packages/hub/src/telemetry/transcript.ts packages/hub/test/telemetry/transcript.test.ts packages/hub/test/telemetry/fixtures/transcript.jsonl
git commit -m "feat(hub): transcript reader with id-deduped usage and mtime cache"
```

---

## Milestone 3 — Status engine

### Task 5: `StatusEngine`

**Files:**
- Create: `packages/hub/src/telemetry/status.ts`
- Test: `packages/hub/test/telemetry/status.test.ts`

**Interfaces:**
- Consumes: `TelemetryStatus` from `@deixis/shared`.
- Produces: `class StatusEngine` with `applyEvent(sessionId: string, eventName: string, now: number): TelemetryStatus`, `tick(now: number): Map<string, TelemetryStatus>` (returns sessions whose status changed by age-out), and `classifyFallback(current: TelemetryStatus, signals: { pidAlive: boolean; hasError: boolean }): TelemetryStatus`. Constants `WORKING_IDLE_MS = 120_000`, `IDLE_FINISHED_MS = 3_600_000`.

- [ ] **Step 1: Write the failing test**

`packages/hub/test/telemetry/status.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { StatusEngine } from "../../src/telemetry/status.js";

describe("StatusEngine.applyEvent", () => {
  it("maps events to states", () => {
    const e = new StatusEngine();
    expect(e.applyEvent("s", "PreToolUse", 0)).toBe("working");
    expect(e.applyEvent("s", "UserPromptSubmit", 0)).toBe("working");
    expect(e.applyEvent("s", "Notification", 0)).toBe("waiting");
    expect(e.applyEvent("s", "Stop", 0)).toBe("idle");
    expect(e.applyEvent("s", "SessionStart", 0)).toBe("idle");
  });
});

describe("StatusEngine.tick (age-out)", () => {
  it("working -> idle after 120s, idle -> finished after 1h", () => {
    const e = new StatusEngine();
    e.applyEvent("s", "PreToolUse", 0);
    expect(e.tick(119_000).get("s")).toBeUndefined();        // not yet
    expect(e.tick(120_001).get("s")).toBe("idle");           // aged to idle
    expect(e.tick(120_001 + 3_600_001).get("s")).toBe("finished");
  });
});

describe("StatusEngine.classifyFallback", () => {
  it("errors and finishes override", () => {
    const e = new StatusEngine();
    expect(e.classifyFallback("working", { pidAlive: true, hasError: true })).toBe("errored");
    expect(e.classifyFallback("idle", { pidAlive: false, hasError: false })).toBe("finished");
    expect(e.classifyFallback("working", { pidAlive: true, hasError: false })).toBe("working");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — cannot find `../../src/telemetry/status.js`.

- [ ] **Step 3: Implement**

`packages/hub/src/telemetry/status.ts`:
```ts
import type { TelemetryStatus } from "@deixis/shared";

export const WORKING_IDLE_MS = 120_000;
export const IDLE_FINISHED_MS = 3_600_000;

interface Entry { status: TelemetryStatus; since: number }

export class StatusEngine {
  private entries = new Map<string, Entry>();

  applyEvent(sessionId: string, eventName: string, now: number): TelemetryStatus {
    const status = mapEvent(eventName);
    this.entries.set(sessionId, { status, since: now });
    return status;
  }

  tick(now: number): Map<string, TelemetryStatus> {
    const changed = new Map<string, TelemetryStatus>();
    for (const [id, e] of this.entries) {
      if (e.status === "working" && now - e.since >= WORKING_IDLE_MS) {
        e.status = "idle";
        e.since = now;
        changed.set(id, "idle");
      } else if (e.status === "idle" && now - e.since >= IDLE_FINISHED_MS) {
        e.status = "finished";
        e.since = now;
        changed.set(id, "finished");
      }
    }
    return changed;
  }

  classifyFallback(
    current: TelemetryStatus,
    signals: { pidAlive: boolean; hasError: boolean },
  ): TelemetryStatus {
    if (signals.hasError) return "errored";
    if (!signals.pidAlive) return "finished";
    return current;
  }
}

function mapEvent(eventName: string): TelemetryStatus {
  switch (eventName) {
    case "PreToolUse":
    case "PostToolUse":
    case "UserPromptSubmit":
      return "working";
    case "Notification":
      return "waiting";
    case "Stop":
    case "SessionStart":
      return "idle";
    default:
      return "idle";
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deixis/hub test`
Expected: PASS (status tests).

- [ ] **Step 5: Commit**

```bash
git add packages/hub/src/telemetry/status.ts packages/hub/test/telemetry/status.test.ts
git commit -m "feat(hub): status engine with event mapping, age-out, fallback"
```

---

## Milestone 4 — Hub wiring

### Task 6: Store telemetry fields + mutators

**Files:**
- Modify: `packages/hub/src/store.ts`
- Test: `packages/hub/test/store.test.ts` (append)

**Interfaces:**
- Consumes: `SessionTelemetry`, `TelemetryStatus`, `TokenUsage` from `@deixis/shared`; existing `SessionStore`.
- Produces: `register` now sets `hasCanvas: true`; new `ensureSession(sessionId, label?): SessionState` (creates a bare session if absent, default `hasCanvas:false`), `setTelemetry(sessionId, patch: Partial<SessionTelemetry>): SessionState` (sets `hasTelemetry:true`, merges patch into `telemetry`, stamps `updatedAt`).

- [ ] **Step 1: Append failing tests**

`packages/hub/test/store.test.ts` (add):
```ts
describe("SessionStore telemetry", () => {
  it("register marks hasCanvas", () => {
    const store = new SessionStore();
    expect(store.register("id", "a").hasCanvas).toBe(true);
  });

  it("ensureSession creates a telemetry-only session", () => {
    const store = new SessionStore();
    const s = store.ensureSession("id", "proj");
    expect(s.hasCanvas).toBe(false);
    expect(s.hasTelemetry).toBe(false);
  });

  it("setTelemetry merges a patch and flags hasTelemetry", () => {
    const store = new SessionStore();
    store.ensureSession("id", "proj");
    const s = store.setTelemetry("id", { status: "working" });
    expect(s.hasTelemetry).toBe(true);
    expect(s.telemetry?.status).toBe("working");
    const s2 = store.setTelemetry("id", { costUsd: 0.5 });
    expect(s2.telemetry?.status).toBe("working"); // preserved
    expect(s2.telemetry?.costUsd).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — `ensureSession`/`setTelemetry` not functions; `hasCanvas` undefined.

- [ ] **Step 3: Implement**

In `packages/hub/src/store.ts`, update the default state creation (both in `register` and a new `ensureSession`). Replace the `register` method and add the new methods:
```ts
  register(sessionId: string, label: string): SessionState {
    const unique = this.uniqueLabel(label || "session", sessionId);
    const state = this.ensureSession(sessionId, unique);
    state.label = unique;
    state.online = true;
    state.hasCanvas = true;
    this.emitSession(state);
    return state;
  }

  ensureSession(sessionId: string, label?: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        label: label ?? sessionId.slice(0, 8),
        markdown: "",
        steps: [],
        connectedAt: Date.now(),
        online: true,
        hasCanvas: false,
        hasTelemetry: false,
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  setTelemetry(sessionId: string, patch: Partial<SessionTelemetry>): SessionState {
    const state = this.ensureSession(sessionId);
    const base: SessionTelemetry = state.telemetry ?? {
      status: "idle",
      usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
      costUsd: null,
      updatedAt: Date.now(),
    };
    state.telemetry = { ...base, ...patch, updatedAt: Date.now() };
    state.hasTelemetry = true;
    this.emitSession(state);
    return state;
  }
```
Add `SessionTelemetry` to the type import from `@deixis/shared` at the top of the file.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deixis/hub test`
Expected: PASS (all store tests, including pre-existing ones — `register` still returns a valid state).

- [ ] **Step 5: Commit**

```bash
git add packages/hub/src/store.ts packages/hub/test/store.test.ts
git commit -m "feat(hub): store telemetry fields, ensureSession, setTelemetry"
```

---

### Task 7: Telemetry facade + event route

**Files:**
- Create: `packages/hub/src/telemetry/index.ts`
- Modify: `packages/hub/src/server.ts`
- Test: `packages/hub/test/server.test.ts` (append)

**Interfaces:**
- Consumes: `SessionStore`, `PricingTable`, `computeCost`, `readTranscript`, `StatusEngine`.
- Produces: `class Telemetry` with `constructor(store, table, engine)`, `async handleEvent(sessionId, body): Promise<void>` (updates status from the event, reads transcript when a `transcriptPath` is given to refresh usage/model/cost/lastMessage, tracks `currentTool`/`recentTools` from `toolName`), and `tick(now): void` (applies status age-outs to the store). New route `POST /telemetry/:id/event`.

- [ ] **Step 1: Implement the facade**

`packages/hub/src/telemetry/index.ts`:
```ts
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
```

- [ ] **Step 2: Append a failing route test**

`packages/hub/test/server.test.ts` (add — `createApp` will need to accept an optional telemetry handler):
```ts
import { Telemetry } from "../src/telemetry/index.js";
import { PricingTable } from "../src/telemetry/pricing.js";
import { StatusEngine } from "../src/telemetry/status.js";

describe("telemetry route", () => {
  it("accepts an event and sets session status", async () => {
    const store = new SessionStore();
    const tel = new Telemetry(store, new PricingTable(), new StatusEngine());
    const a = createApp(store, tel);
    await request(a)
      .post("/telemetry/cc-1/event")
      .send({ event: "PreToolUse", toolName: "Bash" })
      .expect(200);
    const s = store.getAll().find((x) => x.sessionId === "cc-1");
    expect(s?.telemetry?.status).toBe("working");
    expect(s?.telemetry?.currentTool).toBe("Bash");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — `createApp` takes one arg / no telemetry route.

- [ ] **Step 4: Wire the route**

In `packages/hub/src/server.ts`, change the signature to `export function createApp(store: SessionStore, telemetry?: Telemetry): Express` and add, after the existing routes:
```ts
  if (telemetry) {
    app.post("/telemetry/:id/event", (req, res) => {
      void telemetry.handleEvent(req.params.id, req.body ?? {});
      res.json({ ok: true });
    });
  }
```
Add `import { Telemetry } from "./telemetry/index.js";` at the top.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @deixis/hub test`
Expected: PASS (telemetry route test + all pre-existing).

- [ ] **Step 6: Commit**

```bash
git add packages/hub/src/telemetry/index.ts packages/hub/src/server.ts packages/hub/test/server.test.ts
git commit -m "feat(hub): telemetry facade and POST /telemetry/:id/event"
```

---

### Task 8: Bootstrap pricing refresh + status tick

**Files:**
- Modify: `packages/hub/src/index.ts`

**Interfaces:**
- Consumes: `PricingTable`, `refreshPricing`, `StatusEngine`, `Telemetry`, `createApp`.
- Produces: a hub that builds the telemetry stack, refreshes pricing on start + every 24h, ticks status every 10s, and passes `telemetry` into `createApp`.

- [ ] **Step 1: Wire bootstrap**

Edit `packages/hub/src/index.ts` to construct the stack and pass it in. Replace the store/app construction block with:
```ts
import { join } from "node:path";
import { PricingTable, refreshPricing } from "./telemetry/pricing.js";
import { StatusEngine } from "./telemetry/status.js";
import { Telemetry } from "./telemetry/index.js";

const store = new SessionStore();
const table = new PricingTable();
const engine = new StatusEngine();
const telemetry = new Telemetry(store, table, engine);
const app = createApp(store, telemetry);

const pricingCache = join(process.env.HOME ?? "", ".claude", "deixis", "pricing.json");
void refreshPricing(table, pricingCache);
setInterval(() => void refreshPricing(table, pricingCache), 24 * 60 * 60 * 1000).unref();
setInterval(() => telemetry.tick(Date.now()), 10_000).unref();
```
(Keep the existing static-serving and `app.listen` code below.)

- [ ] **Step 2: Build + smoke**

Run:
```bash
pnpm --filter @deixis/shared build && pnpm --filter @deixis/hub build
DEIXIS_PORT=3998 node packages/hub/dist/index.js & sleep 1
curl -s -XPOST localhost:3998/telemetry/cc-x/event -H 'content-type: application/json' -d '{"event":"PreToolUse","toolName":"Read"}'
curl -s --max-time 1 localhost:3998/events | head -1 | grep -o '"status":"working"'
kill %1
```
Expected: event returns `{"ok":true}`; the snapshot shows `"status":"working"` for `cc-x`.

- [ ] **Step 3: Commit**

```bash
git add packages/hub/src/index.ts
git commit -m "feat(hub): bootstrap pricing refresh and status tick"
```

---

## Milestone 5 — Hook package

### Task 9: `@deixis/hook` script

**Files:**
- Create: `packages/hook/package.json`, `packages/hook/tsconfig.json`, `packages/hook/src/index.ts`
- Test: `packages/hook/test/payload.test.ts`

**Interfaces:**
- Produces: `function buildEvent(stdin: string, argv: string[]): { sessionId: string; body: object } | null` (pure, testable) and an executable that POSTs it to the hub. Always exits 0.

- [ ] **Step 1: Create `packages/hook/package.json`**

```json
{
  "name": "@deixis/hook",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": { "deixis-hook": "./dist/index.js" },
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "devDependencies": { "@types/node": "^20.0.0" }
}
```

- [ ] **Step 2: Create `packages/hook/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the failing test**

`packages/hook/test/payload.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildEvent } from "../src/index.js";

describe("buildEvent", () => {
  it("extracts sessionId and normalizes the body", () => {
    const stdin = JSON.stringify({
      session_id: "cc-1",
      hook_event_name: "PreToolUse",
      cwd: "/x/y",
      transcript_path: "/t.jsonl",
      tool_name: "Bash",
    });
    const out = buildEvent(stdin, ["node", "hook"]);
    expect(out).toEqual({
      sessionId: "cc-1",
      body: { event: "PreToolUse", cwd: "/x/y", transcriptPath: "/t.jsonl", toolName: "Bash" },
    });
  });

  it("falls back to argv for the event name", () => {
    const out = buildEvent(JSON.stringify({ session_id: "cc-1" }), ["node", "hook", "Stop"]);
    expect(out?.body).toMatchObject({ event: "Stop" });
  });

  it("returns null without a session id", () => {
    expect(buildEvent("{}", ["node", "hook"])).toBeNull();
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @deixis/hook test`
Expected: FAIL — cannot find `../src/index.js`.

- [ ] **Step 5: Implement**

`packages/hook/src/index.ts`:
```ts
#!/usr/bin/env node
const HUB_URL = process.env.DEIXIS_HUB_URL ?? "http://localhost:3939";

interface HookPayload {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  transcript_path?: string;
  tool_name?: string;
}

export function buildEvent(
  stdin: string,
  argv: string[],
): { sessionId: string; body: Record<string, unknown> } | null {
  let p: HookPayload = {};
  try {
    p = JSON.parse(stdin) as HookPayload;
  } catch {
    /* empty / non-JSON */
  }
  const sessionId = p.session_id;
  if (!sessionId) return null;
  const event = p.hook_event_name ?? argv[2] ?? "unknown";
  const body: Record<string, unknown> = { event };
  if (p.cwd) body.cwd = p.cwd;
  if (p.transcript_path) body.transcriptPath = p.transcript_path;
  if (p.tool_name) body.toolName = p.tool_name;
  return { sessionId, body };
}

async function main(): Promise<void> {
  // Safety net: never let the hook hang Claude Code.
  const safety = setTimeout(() => process.exit(0), 1500);
  safety.unref();
  try {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const parsed = buildEvent(Buffer.concat(chunks).toString("utf8"), process.argv);
    if (parsed) {
      // The hook's parent is the Claude Code process — report it for the
      // liveness sweep that detects finished sessions (Task 14).
      parsed.body.pid = process.ppid;
      await fetch(`${HUB_URL}/telemetry/${parsed.sessionId}/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.body),
        signal: AbortSignal.timeout(1000),
      });
    }
  } catch {
    /* hub down or any error — ignore */
  }
  process.exit(0);
}

// Only run when executed, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith("index.js")) void main();
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm install && pnpm --filter @deixis/hook test`
Expected: PASS (3 payload tests).

- [ ] **Step 7: Manual integration smoke**

Run (hub from Task 8 on default 3939):
```bash
pnpm --filter @deixis/hook build
node packages/hub/dist/index.js & sleep 1
echo '{"session_id":"cc-hook","hook_event_name":"PreToolUse","cwd":"/tmp/x","tool_name":"Bash"}' | node packages/hook/dist/index.js
curl -s --max-time 1 localhost:3939/events | head -1 | grep -o '"sessionId":"cc-hook"'
kill %1
```
Expected: the snapshot contains `cc-hook` with working status.

- [ ] **Step 8: Commit**

```bash
git add packages/hook pnpm-lock.yaml
git commit -m "feat(hook): hook script posting Claude Code events to the hub"
```

---

## Milestone 6 — Shim identity

### Task 10: Shim adopts Claude Code's `session_id`

**Files:**
- Modify: `packages/shim/src/hub-client.ts`
- Test: `packages/shim/test/identity.test.ts`

**Interfaces:**
- Consumes: existing exports.
- Produces: `function resolveSessionId(projectsDir: string, cwd: string, fallback: () => string): string` (pure/testable — finds the newest `.jsonl` under the encoded project dir and reads its `sessionId`, else `fallback()`); `sessionId` export now uses it.

- [ ] **Step 1: Write the failing test**

`packages/shim/test/identity.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSessionId } from "../src/hub-client.js";

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe("resolveSessionId", () => {
  it("reads sessionId from the newest transcript under the encoded cwd", () => {
    dir = mkdtempSync(join(tmpdir(), "deixis-id-"));
    const projects = join(dir, "projects");
    const encoded = join(projects, "-tmp-proj");
    mkdirSync(encoded, { recursive: true });
    writeFileSync(join(encoded, "a.jsonl"), JSON.stringify({ sessionId: "real-cc-id" }) + "\n");
    expect(resolveSessionId(projects, "/tmp/proj", () => "fallback")).toBe("real-cc-id");
  });

  it("uses the fallback when no transcript exists", () => {
    dir = mkdtempSync(join(tmpdir(), "deixis-id-"));
    expect(resolveSessionId(join(dir, "projects"), "/tmp/none", () => "fallback")).toBe("fallback");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/shim test`
Expected: FAIL — `resolveSessionId` not exported.

- [ ] **Step 3: Implement**

Edit `packages/shim/src/hub-client.ts`. Replace the `sessionId` line and add the resolver:
```ts
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { readdirSync, statSync, readFileSync } from "node:fs";

export const HUB_URL = process.env.DEIXIS_HUB_URL ?? "http://localhost:3939";
export const label = basename(process.cwd()) || "session";

export function resolveSessionId(
  projectsDir: string,
  cwd: string,
  fallback: () => string,
): string {
  try {
    const encoded = cwd.replace(/\//g, "-");
    const dir = join(projectsDir, encoded);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const { f } of files) {
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (!line.trim()) continue;
        const id = (JSON.parse(line) as { sessionId?: string }).sessionId;
        if (id) return id;
      }
    }
  } catch {
    /* fall through */
  }
  return fallback();
}

const projectsDir = join(process.env.HOME ?? "", ".claude", "projects");
export const sessionId = resolveSessionId(projectsDir, process.cwd(), () => randomUUID());
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deixis/shim test`
Expected: PASS (identity tests + the existing hub-client tests still pass).

- [ ] **Step 5: Commit**

```bash
git add packages/shim/src/hub-client.ts packages/shim/test/identity.test.ts
git commit -m "feat(shim): adopt Claude Code session_id from the transcript"
```

---

## Milestone 7 — Dashboard UI

### Task 11: Display helpers

**Files:**
- Create: `packages/web/src/lib/cost.ts`

**Interfaces:**
- Produces: `formatUsd(n: number | null | undefined): string`, `formatTokens(n: number): string`, `statusColor(status: TelemetryStatus): string` (returns a Tailwind text/bg class built on the existing status palette).

- [ ] **Step 1: Implement**

`packages/web/src/lib/cost.ts`:
```ts
import type { TelemetryStatus } from "@deixis/shared";

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const COLOR: Record<TelemetryStatus, string> = {
  working: "bg-status-active",
  waiting: "bg-status-active",
  idle: "bg-status-blocked",
  errored: "bg-status-failed",
  finished: "bg-status-done",
};

export function statusColor(status: TelemetryStatus): string {
  return COLOR[status];
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @deixis/web exec tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/cost.ts
git commit -m "feat(web): cost/token/status display helpers"
```

---

### Task 12: StatusPill, Activity, AggregateBar, and SessionCard wiring

**Files:**
- Create: `packages/web/src/components/StatusPill.tsx`, `Activity.tsx`, `AggregateBar.tsx`
- Modify: `packages/web/src/components/SessionCard.tsx`, `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `SessionState`, `SessionTelemetry`, `TelemetryStatus`; helpers from `cost.ts`; `useSessions`.
- Produces: the rendered telemetry UI.

- [ ] **Step 1: Create `StatusPill.tsx`**

```tsx
import type { TelemetryStatus } from "@deixis/shared";
import { statusColor } from "../lib/cost.js";

export function StatusPill({ status }: { status: TelemetryStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.05em] text-[--color-muted-foreground]">
      <span className={`size-2 rounded-full ${statusColor(status)}`} />
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Create `Activity.tsx`**

```tsx
import type { SessionTelemetry } from "@deixis/shared";
import { formatTokens, formatUsd } from "../lib/cost.js";

export function Activity({ t }: { t: SessionTelemetry }) {
  const total = t.usage.input + t.usage.output + t.usage.cacheCreate + t.usage.cacheRead;
  return (
    <div className="flex flex-col gap-2 text-[12px] text-[--color-muted-foreground]">
      <div className="flex items-center justify-between">
        <span>{formatTokens(total)} tok</span>
        <span title="equivalent API cost">{formatUsd(t.costUsd)}</span>
      </div>
      {t.currentTool ? (
        <div className="truncate">
          <span className="font-mono text-[--color-foreground]">{t.currentTool}</span>
        </div>
      ) : null}
      {t.lastMessage ? <div className="line-clamp-2 italic">{t.lastMessage}</div> : null}
      {t.recentTools?.length ? (
        <div className="flex flex-wrap gap-1">
          {t.recentTools.map((tool, i) => (
            <span key={i} className="rounded bg-[--color-muted] px-1.5 py-0.5 font-mono text-[10px]">
              {tool}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Create `AggregateBar.tsx`**

```tsx
import type { SessionState } from "@deixis/shared";
import { formatTokens, formatUsd } from "../lib/cost.js";

export function AggregateBar({ sessions }: { sessions: SessionState[] }) {
  const active = sessions.filter((s) => s.telemetry?.status === "working").length;
  let tokens = 0;
  let cost = 0;
  for (const s of sessions) {
    const u = s.telemetry?.usage;
    if (u) tokens += u.input + u.output + u.cacheCreate + u.cacheRead;
    if (s.telemetry?.costUsd) cost += s.telemetry.costUsd;
  }
  return (
    <div className="flex items-center gap-6 border-b px-4 py-2 text-[12px] text-[--color-muted-foreground]">
      <span>{sessions.length} sessions</span>
      <span>{active} working</span>
      <span>{formatTokens(tokens)} tok</span>
      <span title="equivalent API cost">{formatUsd(cost)}</span>
    </div>
  );
}
```

- [ ] **Step 4: Extend `SessionCard.tsx`**

Replace the file with the canvas panes gated on `hasCanvas` and telemetry added:
```tsx
import type { SessionState } from "@deixis/shared";
import { renderMarkdown } from "../lib/markdown.js";
import { ProgressList } from "./ProgressList.js";
import { StatusPill } from "./StatusPill.js";
import { Activity } from "./Activity.js";

export function SessionCard({ session }: { session: SessionState }) {
  return (
    <article
      className={`flex flex-col gap-4 rounded-[var(--radius)] border bg-[--color-background] p-5 ${
        session.online ? "" : "opacity-50"
      }`}
    >
      <header className="flex items-center justify-between">
        <h2 className="text-[15px] font-medium">{session.label}</h2>
        {session.telemetry ? (
          <StatusPill status={session.telemetry.status} />
        ) : (
          <span
            className={`size-2 rounded-full ${
              session.online ? "bg-status-done" : "bg-status-blocked"
            }`}
          />
        )}
      </header>
      {session.telemetry ? <Activity t={session.telemetry} /> : null}
      {session.hasCanvas ? <ProgressList steps={session.steps} /> : null}
      {session.hasCanvas && session.markdown ? (
        <div
          className="prose-deixis text-[14px] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(session.markdown) }}
        />
      ) : null}
    </article>
  );
}
```

- [ ] **Step 5: Mount `AggregateBar` in `App.tsx`**

Replace `packages/web/src/App.tsx`:
```tsx
import { useSessions } from "./lib/useSessions.js";
import { Grid } from "./components/Grid.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { AggregateBar } from "./components/AggregateBar.js";

export default function App() {
  const sessions = useSessions();
  return (
    <main>
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-[13px] font-medium tracking-[0.05em] uppercase">Deixis</span>
        <ThemeToggle />
      </header>
      <AggregateBar sessions={sessions} />
      <Grid sessions={sessions} />
    </main>
  );
}
```

- [ ] **Step 6: Build + verify telemetry renders in the served dashboard**

Run:
```bash
pnpm --filter @deixis/web build && pnpm --filter @deixis/hub build
node packages/hub/dist/index.js & sleep 1
curl -s -XPOST localhost:3939/telemetry/cc-ui/event -H 'content-type: application/json' -d '{"event":"PreToolUse","toolName":"Bash","cwd":"/tmp/demo"}'
curl -s localhost:3939/ | grep -o '<div id="root"></div>'
curl -s --max-time 1 localhost:3939/events | head -1 | grep -o '"status":"working"'
kill %1
```
Expected: dashboard HTML served; snapshot has `"status":"working"`. Open http://localhost:3939 to eyeball the pill + token/$ line on the `cc-ui` card.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components packages/web/src/App.tsx
git commit -m "feat(web): status pill, activity, aggregate bar, telemetry card"
```

---

## Milestone 8 — Install hooks

### Task 13: Hook install/uninstall in settings.json

**Files:**
- Create: `packages/cli/src/hooks.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `installHooks(hookEntry: string): void` (merge deixis hook entries into `~/.claude/settings.json` for the telemetry events, tagged `_source:"deixis"`, deduped) and `removeHooks(): void` (strip only `_source:"deixis"` entries). Called from `init`/`uninstall`.

- [ ] **Step 1: Implement `packages/cli/src/hooks.ts`**

```ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SETTINGS = join(process.env.HOME ?? "", ".claude", "settings.json");
const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop"];
const SOURCE = "deixis";

type HookEntry = { matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }>; _source?: string };

function load(): Record<string, unknown> {
  if (!existsSync(SETTINGS)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function installHooks(hookEntry: string): void {
  const settings = load();
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  for (const event of EVENTS) {
    const list = (hooks[event] ?? []).filter((e) => e._source !== SOURCE); // dedup
    list.push({
      matcher: "",
      hooks: [{ type: "command", command: `node ${hookEntry} ${event}`, timeout: 5 }],
      _source: SOURCE,
    });
    hooks[event] = list;
  }
  settings.hooks = hooks;
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
}

export function removeHooks(): void {
  const settings = load();
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  for (const event of Object.keys(hooks)) {
    hooks[event] = (hooks[event] ?? []).filter((e) => e._source !== SOURCE);
    if (hooks[event].length === 0) delete hooks[event];
  }
  settings.hooks = hooks;
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
}
```

- [ ] **Step 2: Wire into the CLI**

In `packages/cli/src/index.ts`: add `import { installHooks, removeHooks } from "./hooks.js";` and compute `const hookEntry = join(repoRoot, "packages", "hook", "dist", "index.js");`. In `init()`, after `registerMcp(shimEntry)`, add `installHooks(hookEntry); console.log("Installed telemetry hooks…");`. In `uninstall()`, after `unregisterMcp()`, add `removeHooks();`.

- [ ] **Step 3: Build + isolated round-trip test (does NOT touch your real settings)**

Run (uses a temp HOME so your real `~/.claude/settings.json` is untouched):
```bash
pnpm --filter @deixis/hook build && pnpm --filter deixis build
TMPH=$(mktemp -d); mkdir -p "$TMPH/.claude"
HOME="$TMPH" node -e "import('./packages/cli/dist/hooks.js').then(m=>{m.installHooks('/abs/hook.js'); console.log('after install:', JSON.parse(require('fs').readFileSync('$TMPH/.claude/settings.json','utf8')).hooks.PreToolUse.length); m.removeHooks(); console.log('after remove keys:', Object.keys(JSON.parse(require('fs').readFileSync('$TMPH/.claude/settings.json','utf8')).hooks).length);})"
rm -rf "$TMPH"
```
Expected: "after install: 1" (PreToolUse has one deixis entry); "after remove keys: 0" (all deixis entries stripped). Re-running install must not duplicate (dedup).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/hooks.ts packages/cli/src/index.ts
git commit -m "feat(cli): install/remove telemetry hooks in settings.json"
```

---

### Task 14: Process-liveness fallback sweep

**Files:**
- Create: `packages/hub/src/telemetry/sweep.ts`
- Modify: `packages/hub/src/index.ts`
- Test: `packages/hub/test/telemetry/sweep.test.ts`

**Interfaces:**
- Consumes: `SessionStore`.
- Produces: `function pidAlive(pid: number): boolean` (liveness via `process.kill(pid, 0)` — no signal sent) and `function sweepFinished(store: SessionStore): string[]` (marks any non-finished session whose reported `pid` is dead as `finished`, returns their ids).

This is the heuristic fallback for **finished** detection (faster than the 1h idle timer); **errored** is already handled by the transcript `hasError` path in Task 7. `process.kill(pid, 0)` is simpler and more portable than `ps`/`lsof`.

- [ ] **Step 1: Write the failing test**

`packages/hub/test/telemetry/sweep.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SessionStore } from "../../src/store.js";
import { pidAlive, sweepFinished } from "../../src/telemetry/sweep.js";

describe("pidAlive", () => {
  it("is true for the current process and false for a bogus pid", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 30)).toBe(false);
  });
});

describe("sweepFinished", () => {
  it("marks sessions with dead pids as finished", () => {
    const store = new SessionStore();
    store.ensureSession("alive");
    store.setTelemetry("alive", { status: "working", pid: process.pid });
    store.ensureSession("dead");
    store.setTelemetry("dead", { status: "working", pid: 2 ** 30 });
    const finished = sweepFinished(store);
    expect(finished).toEqual(["dead"]);
    expect(store.getAll().find((s) => s.sessionId === "dead")?.telemetry?.status).toBe("finished");
    expect(store.getAll().find((s) => s.sessionId === "alive")?.telemetry?.status).toBe("working");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @deixis/hub test`
Expected: FAIL — cannot find `../../src/telemetry/sweep.js`.

- [ ] **Step 3: Implement `packages/hub/src/telemetry/sweep.ts`**

```ts
import type { SessionStore } from "../store.js";

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, sends nothing
    return true;
  } catch {
    return false;
  }
}

export function sweepFinished(store: SessionStore): string[] {
  const finished: string[] = [];
  for (const s of store.getAll()) {
    const t = s.telemetry;
    if (!t?.pid || t.status === "finished") continue;
    if (!pidAlive(t.pid)) {
      store.setTelemetry(s.sessionId, { status: "finished" });
      finished.push(s.sessionId);
    }
  }
  return finished;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @deixis/hub test`
Expected: PASS (sweep tests).

- [ ] **Step 5: Wire the sweep interval into bootstrap**

In `packages/hub/src/index.ts`, add the import `import { sweepFinished } from "./telemetry/sweep.js";` and, beside the other intervals:
```ts
setInterval(() => sweepFinished(store), 15_000).unref();
```

- [ ] **Step 6: Build to verify wiring**

Run: `pnpm --filter @deixis/hub build`
Expected: compiles cleanly.

- [ ] **Step 7: Commit**

```bash
git add packages/hub/src/telemetry/sweep.ts packages/hub/test/telemetry/sweep.test.ts packages/hub/src/index.ts
git commit -m "feat(hub): liveness sweep marking dead-pid sessions finished"
```

---

### Task 15: Full v2 verification

**Files:** none (verification only).

- [ ] **Step 1: Full build + all unit tests**

Run: `pnpm -r build && pnpm -r test`
Expected: all packages build; shared (no tests), hub (pricing+transcript+status+store+server), shim (hub-client+identity), hook (payload) all green.

- [ ] **Step 2: Reinstall and live-verify (mutates your real config — run intentionally)**

Run:
```bash
node packages/cli/dist/index.js init
```
Then open a NEW Claude Code session in any folder, give it a short multi-step task, and confirm at http://localhost:3939:
- the session appears as a card with a **status pill** that moves working↔idle,
- a **token count + $** that climbs,
- **current tool / last message** in the activity block,
- the **aggregate bar** totals update,
- if you also call the canvas tools, markdown/progress appear on the **same** card (unified identity).

- [ ] **Step 3: Confirm uninstall reverses hooks**

Run: `node packages/cli/dist/index.js uninstall` then `grep -c deixis ~/.claude/settings.json || echo "no deixis hooks"`.
Expected: no deixis hook entries remain.

- [ ] **Step 4: Commit any fixes surfaced during verification (if none, skip).**

---

## Self-Review (completed during authoring)

- **Spec coverage:** §2 data flow (Tasks 8,9 hook→hub→SSE) ✓; §3 identity unification (Task 10 shim reads session_id; Tasks 6,7 store keyed by id + hasCanvas/hasTelemetry) ✓; §4 cost engine (Tasks 2,3 OpenRouter + snapshot + cache multipliers + dedup) ✓; §5 status engine (Task 5 events+age-out+fallback; tick in Tasks 7,8) ✓; §6 types (Task 1) ✓; §7 UI (Tasks 11,12 pill/activity/aggregate, telemetry-only cards, canvas gated on hasCanvas) ✓; §8 install (Task 13 global hooks with _source marker + dedup; uninstall) ✓; §9 package shape (hook package Task 9, telemetry module Tasks 2–7) ✓; §11 testing (unit across engines + manual) ✓.
- **Heuristic fallback (spec §5) fully delivered:** `errored` via the transcript `hasError` path (Task 7); `finished` via both the idle age-out timer (Task 5) and the live process-liveness sweep using `process.kill(pid,0)` (Task 14, fed by the hook's reported parent pid). `process.kill(pid,0)` replaces the spec's `ps`/`lsof` — simpler and more portable, so the macOS-only caveat in spec §10 no longer applies to liveness. `recentTools` is populated from hook `toolName`; deeper JSONL tool history is intentionally out of scope.
- **Type consistency:** `TelemetryStatus`/`TokenUsage`/`SessionTelemetry` defined once (Task 1) and imported everywhere; `setTelemetry(patch)` signature consistent across Tasks 6,7,12; route path `/telemetry/:id/event` matches the hook POST (Tasks 7,9); status palette classes (`bg-status-*`) match the v1 globals.css utilities.
- **Non-goals respected:** no approval interception, no charts, no quota tracking, no remote exposure.

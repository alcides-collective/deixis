# deixis

**A visual surface for terminal Claude Code.** The agent draws its plan to a browser canvas, every session reports its own status and cost, and a menu-bar glyph tells you which one needs you.

> *deixis* — the class of pointing words: *this, here, look.*

Claude Code lives in a terminal — a linear text stream with no spatial view. Deixis gives it one: a persistent dashboard the agent **curates itself** (not a log scraper), plus passive per-session telemetry, plus a glance in your menu bar. macOS.

🔗 **[Live page →](https://alcides-collective.github.io/deixis/)**

```
menu bar:  ⚠ 1                 dashboard (localhost:3939)
──────────────────────         ┌──────────────────────────┐
✗ api      errored  2m  Bash   │ ● auth-refactor  working │
● deixis   working  9s  Edit   │   ✓ parse  ✓ load        │
○ claude   idle     20m        │   ⏳ write tests          │
──────────────────────         │   678k ctx · ◆ Progress… │
Open dashboard ↗               └──────────────────────────┘
```

## What it does

| Layer | What you get |
|---|---|
| **Canvas** | Four MCP tools let a session render Markdown, a live progress checklist, and a full document to a card that persists across turns — stop scrolling the transcript to find where it's at. The dashboard defaults to a single-column feed; a Pinterest masonry grid is opt-in via Settings. |
| **Review** | `render_file` opens a spec or plan the agent wants you to read in a full reading view — not a Markdown file you hunt down in an editor. It asks for the verdict in a plain message, so approval relays through Claude Code **Remote Control** and you can accept it from your phone. |
| **Telemetry** | A hook reports every session (working / waiting / errored / finished) with tokens and an *equivalent API cost*, read straight from the transcript. Unified onto one card per session. |
| **Menu bar** | A SwiftBar plugin: `◆` when all's calm, `⚠` when a session is waiting or errored. Click for the list — status, current tool, time-in-state, context size. |

## Quick start

```bash
# macOS · Node 20+ · pnpm
git clone https://github.com/alcides-collective/deixis
cd deixis && pnpm install && pnpm -r build

node packages/cli/dist/index.js init      # hub + MCP tools + telemetry hooks (launchd, :3939)
node packages/cli/dist/index.js menubar   # SwiftBar glyph (optional; needs SwiftBar)
```

Open **http://localhost:3939**, then start any Claude Code session — it appears automatically. Ask it to *"track this on the deixis canvas"* to populate progress and notes.

Undo with `node packages/cli/dist/index.js uninstall` (and `… menubar --uninstall`).

## How it works

```
Claude Code session
  ├─ MCP shim ──┐
  └─ hook ──────┼──→  hub :3939  ──SSE──→  dashboard (React)
                            └──────────────→  menu bar (SwiftBar)
```

A long-running hub holds session state in memory and pushes updates over SSE. The MCP shim and the hook both report under Claude Code's **real session id**, so the agent's canvas and its telemetry land on the same card.

## Architecture

pnpm monorepo, TypeScript throughout:

| Package | Role |
|---|---|
| `shared` | Protocol + domain types (the single source of truth) |
| `hub` | Express + SSE server, in-memory store, telemetry (pricing, transcript, status) |
| `shim` | Per-session stdio MCP server — the four canvas tools (`render_markdown`, `progress_set`, `progress_update`, `render_file`) |
| `hook` | Tiny hook script that posts Claude Code events to the hub |
| `web` | React 19 + Tailwind v4 dashboard (feed / masonry layouts, reading overlay, Settings, light/dark) |
| `menubar` | SwiftBar plugin (renderer + notifications) |
| `cli` | `deixis init / uninstall / status / menubar` |

## Develop

```bash
pnpm -r build      # build all packages
pnpm -r test       # unit tests (hub, shim, hook, menubar, shared)
pnpm --filter @deixis/web dev   # dashboard with hot reload (proxies to :3939)
```

## Notes & caveats

- **macOS only** — the hub auto-starts via launchd; the menu bar needs the free [SwiftBar](https://swiftbar.app).
- **Cost is a gauge, not a bill** — on a Max/Pro subscription the `$` figure is the *equivalent* pay-as-you-go API cost, priced from [OpenRouter](https://openrouter.ai). It's deliberately kept off the menu bar.
- **Fonts** — the dashboard uses Overused Grotesk (with PP Supply Mono for monospace), which are proprietary. The installer copies *your own licensed copies* locally; the fonts are never committed or shipped.
- **Local only** — no auth, no remote/cloud, no telemetry leaves your machine.

## License

No license chosen yet — all rights reserved by the author until one is added. Built with [Claude Code](https://claude.com/claude-code). Not affiliated with Anthropic.

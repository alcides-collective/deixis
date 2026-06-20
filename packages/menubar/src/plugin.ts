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

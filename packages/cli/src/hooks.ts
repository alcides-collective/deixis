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

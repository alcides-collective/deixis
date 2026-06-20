#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { convertFonts } from "./fonts.js";
import { installService, uninstallService } from "./launchd.js";
import { registerMcp, unregisterMcp } from "./mcp.js";
import { installHooks, removeHooks } from "./hooks.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", ".."); // packages/cli/dist -> repo root
const hubEntry = join(repoRoot, "packages", "hub", "dist", "index.js");
const shimEntry = join(repoRoot, "packages", "shim", "dist", "index.js");
const hookEntry = join(repoRoot, "packages", "hook", "dist", "index.js");
const fontsOut = join(repoRoot, "packages", "web", "public", "fonts");
const fontsSrc = join(process.env.HOME ?? "", "Downloads", "Helvetica Now");

async function init() {
  // Preflight: ensure the `claude` CLI is available before any mutation, so we
  // never leave a half-installed state (service installed, MCP not registered).
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
  } catch {
    console.error(
      "Error: the `claude` CLI was not found on PATH. Install Claude Code and ensure `claude` is runnable, then re-run `deixis init`.",
    );
    process.exit(1);
  }
  console.log("Building packages…");
  execFileSync("pnpm", ["-r", "build"], { cwd: repoRoot, stdio: "inherit" });
  console.log("Converting fonts…");
  await convertFonts(fontsSrc, fontsOut);
  console.log("Building dashboard with fonts…");
  execFileSync("pnpm", ["--filter", "@deixis/web", "build"], { cwd: repoRoot, stdio: "inherit" });
  console.log("Installing hub service…");
  await installService(hubEntry);
  console.log("Registering MCP shim with Claude Code…");
  registerMcp(shimEntry);
  installHooks(hookEntry);
  console.log("Installed telemetry hooks…");
  console.log("Done. Open http://localhost:3939");
}

async function uninstall() {
  await uninstallService();
  unregisterMcp();
  removeHooks();
  console.log("Removed service and MCP registration.");
}

function status() {
  try {
    execFileSync("launchctl", ["list", "news.pollar.deixis"], { stdio: "inherit" });
  } catch {
    console.log("Hub service not loaded.");
  }
}

const cmd = process.argv[2];
if (cmd === "init") await init();
else if (cmd === "uninstall") await uninstall();
else if (cmd === "status") status();
else {
  console.log("Usage: deixis <init|uninstall|status>");
  process.exit(1);
}

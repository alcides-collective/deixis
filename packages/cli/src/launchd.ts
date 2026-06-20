import { writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const LABEL = "news.pollar.deixis";

function plistPath(): string {
  return join(process.env.HOME ?? "", "Library", "LaunchAgents", `${LABEL}.plist`);
}

export async function installService(hubEntry: string): Promise<string> {
  const logDir = join(process.env.HOME ?? "", "Library", "Logs");
  await mkdir(logDir, { recursive: true });
  const node = process.execPath;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${node}</string><string>${hubEntry}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(logDir, "deixis.log")}</string>
  <key>StandardErrorPath</key><string>${join(logDir, "deixis.err.log")}</string>
</dict>
</plist>`;
  const path = plistPath();
  await writeFile(path, plist);
  try { execFileSync("launchctl", ["unload", path]); } catch { /* not loaded yet */ }
  execFileSync("launchctl", ["load", path]);
  return path;
}

export async function uninstallService(): Promise<void> {
  const path = plistPath();
  if (!existsSync(path)) return;
  try { execFileSync("launchctl", ["unload", path]); } catch { /* already unloaded */ }
  await rm(path);
}

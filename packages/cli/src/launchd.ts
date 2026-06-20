import { writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const LABEL = "news.pollar.deixis";

function plistPath(): string {
  return join(process.env.HOME ?? "", "Library", "LaunchAgents", `${LABEL}.plist`);
}

// Per-user launchd domain for a LaunchAgent. getuid is always present on macOS
// (the only platform we install on); the assertion satisfies strict TS.
function guiDomain(): string {
  return `gui/${process.getuid!()}`;
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
  const domain = guiDomain();
  // Modern launchctl (bootstrap/bootout supersede the deprecated load/unload).
  // Boot out any prior instance so bootstrap doesn't fail on an already-loaded
  // label; "not loaded" is the expected case on a clean install, so ignore its
  // output (this is the noisy line the deprecated `unload` used to print).
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${LABEL}`], { stdio: "ignore" });
  } catch {
    /* service wasn't loaded — fine */
  }
  // Let a genuine bootstrap failure surface (default stderr is inherited).
  execFileSync("launchctl", ["bootstrap", domain, path]);
  return path;
}

export async function uninstallService(): Promise<void> {
  const path = plistPath();
  if (!existsSync(path)) return;
  try {
    execFileSync("launchctl", ["bootout", `${guiDomain()}/${LABEL}`], { stdio: "ignore" });
  } catch {
    /* already unloaded */
  }
  await rm(path);
}

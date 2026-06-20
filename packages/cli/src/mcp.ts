import { execFileSync } from "node:child_process";

const NAME = "deixis";

export function registerMcp(shimEntry: string): void {
  // Registers the shim for all projects at user scope.
  execFileSync(
    "claude",
    ["mcp", "add", "--scope", "user", NAME, "--", process.execPath, shimEntry],
    { stdio: "inherit" },
  );
}

export function unregisterMcp(): void {
  try {
    execFileSync("claude", ["mcp", "remove", "--scope", "user", NAME], { stdio: "inherit" });
  } catch { /* not registered */ }
}

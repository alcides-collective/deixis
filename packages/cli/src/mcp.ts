import { execFileSync } from "node:child_process";

const NAME = "deixis";

export function registerMcp(shimEntry: string): void {
  // Registers the shim for all projects at user scope.
  try {
    execFileSync(
      "claude",
      ["mcp", "add", "--scope", "user", NAME, "--", process.execPath, shimEntry],
      { stdio: "inherit" },
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error("claude CLI not found");
    }
    throw err;
  }
}

export function unregisterMcp(): void {
  try {
    execFileSync("claude", ["mcp", "remove", "--scope", "user", NAME], { stdio: "inherit" });
  } catch { /* not registered */ }
}

import { mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Brand fonts are proprietary and never committed. The installer copies the
// user's own licensed copies from the local pollar checkout into the web app's
// served fonts directory. Both files are already woff2, so no conversion needed.
const FONTS = [
  "OverusedGrotesk-VF.woff2",
  "PPSupplyMono-Regular.woff2",
];

export async function installFonts(srcDir: string, outDir: string): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];

  for (const name of FONTS) {
    const srcPath = join(srcDir, name);
    if (!existsSync(srcPath)) {
      throw new Error(`Missing font: ${srcPath}`);
    }
    const outPath = join(outDir, name);
    await copyFile(srcPath, outPath);
    written.push(outPath);
  }

  return written;
}

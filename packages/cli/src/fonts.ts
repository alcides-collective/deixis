import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as wawoff2 from "wawoff2";

const DISPLAY = [
  { src: "HelveticaNowDisplay.otf", out: "HelveticaNowDisplay-400.woff2" },
  { src: "HelveticaNowDisplayMedium.otf", out: "HelveticaNowDisplay-500.woff2" },
];

export async function convertFonts(srcDir: string, outDir: string): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];

  for (const { src, out } of DISPLAY) {
    const srcPath = join(srcDir, src);
    if (!existsSync(srcPath)) {
      throw new Error(`Missing font: ${srcPath}`);
    }
    const otf = await readFile(srcPath);
    const woff2 = await wawoff2.compress(otf);
    const outPath = join(outDir, out);
    await writeFile(outPath, woff2);
    written.push(outPath);
  }

  // PPSupplyMono is already woff2 in the pollar repo; copy it if present.
  const monoSrc = join(
    process.env.HOME ?? "",
    "pollar/apps/frontend/src/app/fonts/PPSupplyMono-Regular.woff2",
  );
  if (existsSync(monoSrc)) {
    const monoOut = join(outDir, "PPSupplyMono-Regular.woff2");
    await copyFile(monoSrc, monoOut);
    written.push(monoOut);
  }

  return written;
}

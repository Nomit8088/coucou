// Wrap the existing PNG artwork in an ICNS container, without regenerating or
// restyling Windows icons. Modern macOS supports PNG-backed ICNS representations.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function generateMacIcon() {
  const icons = join(dirname(fileURLToPath(import.meta.url)), "../src-tauri/icons");
  const kinds = new Map([[32, "icp5"], [128, "ic07"], [256, "ic08"], [512, "ic09"], [1024, "ic10"]]);
  const seen = new Set();
  const chunks = [];
  for (const file of ["32x32.png", "128x128.png", "128x128@2x.png", "icon.png"]) {
    const png = readFileSync(join(icons, file));
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`Invalid PNG: ${file}`);
    const size = png.readUInt32BE(16);
    const kind = kinds.get(size);
    if (!kind || seen.has(size) || png.readUInt32BE(20) !== size) continue;
    seen.add(size);
    const header = Buffer.alloc(8);
    header.write(kind);
    header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  if (!seen.has(256)) throw new Error("Mac icon requires the existing 256px PNG");
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(8 + chunks.reduce((n, chunk) => n + chunk.length, 0), 4);
  writeFileSync(join(icons, "icon.icns"), Buffer.concat([header, ...chunks]));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) generateMacIcon();

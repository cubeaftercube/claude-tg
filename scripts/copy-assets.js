/**
 * Copies HTML, CSS, and other static assets from src/ to dist/.
 * TypeScript compiles .ts → .js but doesn't touch non-TS files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const copies = [
  ["src/gui/renderer/index.html", "dist/gui/renderer/index.html"],
  ["src/gui/renderer/styles.css", "dist/gui/renderer/styles.css"],
  ["assets/icon.ico", "dist/assets/icon.ico"],
];

for (const [src, dest] of copies) {
  const srcPath = path.join(root, src);
  const destPath = path.join(root, dest);
  if (fs.existsSync(srcPath)) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    console.log(`  ${src} → ${dest}`);
  } else {
    console.warn(`  WARN: ${src} not found, skipping`);
  }
}

console.log("Assets copied.");

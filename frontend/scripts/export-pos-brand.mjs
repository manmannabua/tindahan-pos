// Export the generated master artwork. Run with pnpm gen:icons.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Reuse the image processor shipped with Next.
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next"))("sharp");
const root = fileURLToPath(new URL("../", import.meta.url));
const symbol = path.join(root, "../assets/pos-brand/pos-symbol-master.png");
const logo = path.join(root, "../assets/pos-brand/pos-logo-master.png");
const output = (name) => path.join(root, name);
await mkdir(output("public/brand"), { recursive: true });
await mkdir(output("public/icons"), { recursive: true });

for (const size of [16, 32, 48, 192, 512]) {
  await sharp(symbol).resize(size, size).png().toFile(output(`public/icons/pos-${size}.png`));
}
await sharp(symbol).resize(180, 180).png().toFile(output("app/apple-icon.png"));
await sharp(symbol).resize(32, 32).png().toFile(output("app/icon.png"));
await sharp(symbol).resize(128, 128).png().toFile(output("public/brand/pos-symbol.png"));
// Additional inset keeps the entire mark inside the maskable icon's safe circle.
const background = { r: 15, g: 82, b: 87, alpha: 1 };
await sharp(symbol).resize(410, 410)
  .extend({ top: 51, bottom: 51, left: 51, right: 51, background })
  .png().toFile(output("public/icons/pos-maskable-512.png"));
// Trim transparent margins while preserving the original alpha channel.
await sharp(logo).trim().resize({ width: 640 }).png()
  .toFile(output("public/brand/pos-logo.png"));

// ICO directory with three PNG payloads (16/32/48px).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) =>
  sharp(symbol).resize(size, size).ensureAlpha().png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
await writeFile(output("app/favicon.ico"), Buffer.concat([header, ...images]));
console.log("Exported POS logo, app icons, Apple icon, and 16/32/48px favicon.");

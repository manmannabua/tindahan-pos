// Generates placeholder PWA icons (solid teal tile with a white receipt shape) without any
// image tooling: PNG is written by hand with node:zlib. Replace with real artwork later.
// Usage: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const TEAL = [15, 82, 87];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, padding) {
  const rows = [];
  // Receipt rectangle, relative to the (optionally padded) safe area.
  const inset = padding * size;
  const inner = size - 2 * inset;
  const rx0 = inset + inner * 0.3;
  const rx1 = inset + inner * 0.7;
  const ry0 = inset + inner * 0.2;
  const ry1 = inset + inner * 0.8;
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter: none
    for (let x = 0; x < size; x++) {
      const inReceipt = x >= rx0 && x < rx1 && y >= ry0 && y < ry1;
      const lineBand = inReceipt && x > rx0 + inner * 0.06 && x < rx1 - inner * 0.06 && Math.floor((y - ry0) / (inner * 0.08)) % 2 === 1;
      row.push(...(inReceipt && !lineBand ? WHITE : TEAL));
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, 0));
writeFileSync("public/icons/icon-512.png", png(512, 0));
writeFileSync("public/icons/icon-maskable-512.png", png(512, 0.1));
writeFileSync("app/apple-icon.png", png(180, 0));
console.log("icons written");

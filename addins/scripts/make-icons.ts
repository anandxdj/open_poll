/**
 * Draws the add-in icons (W4-D): an ember square with three white poll bars.
 * Placeholders until brand artwork exists; regenerate with
 *   bun addins/scripts/make-icons.ts
 * Writes `addins/teams/icons/{color,outline}.png` (Teams: 192×192 colour,
 * 32×32 white-on-transparent outline) and `frontend/public/addins/icons/
 * icon-{16,32,64,80}.png` (Office task pane icons, served by the app).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

type Rgba = [number, number, number, number];

const EMBER: Rgba = [0xf9, 0x73, 0x16, 0xff];
const WHITE: Rgba = [0xff, 0xff, 0xff, 0xff];
const CLEAR: Rgba = [0, 0, 0, 0];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An RGBA PNG of `size`×`size` from a pixel function. */
export function png(size: number, pixel: (x: number, y: number) => Rgba): Uint8Array {
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Three bars of a poll chart (heights 45%, 75%, 60%), in unit coordinates. */
function onBar(u: number, v: number): boolean {
  const bars = [
    { x: 0.2, h: 0.45 },
    { x: 0.42, h: 0.75 },
    { x: 0.64, h: 0.6 },
  ];
  const bottom = 0.82;
  return bars.some((bar) => u >= bar.x && u < bar.x + 0.16 && v <= bottom && v >= bottom - bar.h);
}

const colorIcon = (size: number) => png(size, (x, y) => (onBar((x + 0.5) / size, (y + 0.5) / size) ? WHITE : EMBER));
const outlineIcon = (size: number) => png(size, (x, y) => (onBar((x + 0.5) / size, (y + 0.5) / size) ? WHITE : CLEAR));

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "../..");
  const teams = path.join(root, "addins/teams/icons");
  const office = path.join(root, "frontend/public/addins/icons");
  mkdirSync(teams, { recursive: true });
  mkdirSync(office, { recursive: true });
  writeFileSync(path.join(teams, "color.png"), colorIcon(192));
  writeFileSync(path.join(teams, "outline.png"), outlineIcon(32));
  for (const size of [16, 32, 64, 80]) writeFileSync(path.join(office, `icon-${size}.png`), colorIcon(size));
  console.log(`[make-icons] wrote ${teams}/{color,outline}.png and ${office}/icon-{16,32,64,80}.png`);
}

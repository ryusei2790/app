/**
 * @file scripts/generate-icons.mjs
 * @description PWA のアイコン（public/icons/*.png）を SVG から作り直すスクリプト。
 * 実行: node scripts/generate-icons.mjs（sharp を使う。next の依存として入っている）
 * - icon-192.png / icon-512.png … 通常のアイコン（角丸の青地にカレンダーと ¥）
 * - icon-maskable-512.png       … Android の丸・角丸に切り抜かれても欠けないよう、絵を内側 80% に収めたもの
 * - apple-touch-icon.png        … iPhone のホーム画面用（180px、角丸は iOS が付けるので四角）
 */

import sharp from "sharp";
import { mkdirSync } from "node:fs";

const BLUE = "#2563eb";

/** scale: 絵の大きさ（1 = 余白なし、0.8 = maskable の安全領域） / rounded: 地の角丸 */
function svg(size, { scale = 1, rounded = true } = {}) {
  const r = rounded ? size * 0.2 : 0;
  const inner = size * scale;
  const o = (size - inner) / 2;
  const u = inner / 100; // 絵の中の 1 単位
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${BLUE}"/>
  <g transform="translate(${o},${o})">
    <rect x="${18 * u}" y="${22 * u}" width="${64 * u}" height="${60 * u}" rx="${8 * u}" fill="#fff"/>
    <rect x="${18 * u}" y="${22 * u}" width="${64 * u}" height="${16 * u}" rx="${8 * u}" fill="#bfdbfe"/>
    <rect x="${18 * u}" y="${30 * u}" width="${64 * u}" height="${8 * u}" fill="#bfdbfe"/>
    <rect x="${32 * u}" y="${14 * u}" width="${6 * u}" height="${16 * u}" rx="${3 * u}" fill="#fff"/>
    <rect x="${62 * u}" y="${14 * u}" width="${6 * u}" height="${16 * u}" rx="${3 * u}" fill="#fff"/>
    <text x="${50 * u}" y="${74 * u}" font-family="Helvetica, Arial, sans-serif" font-size="${34 * u}" font-weight="700"
      text-anchor="middle" fill="${BLUE}">¥</text>
  </g>
</svg>`;
}

mkdirSync("public/icons", { recursive: true });
const out = [
  ["public/icons/icon-192.png", 192, {}],
  ["public/icons/icon-512.png", 512, {}],
  ["public/icons/icon-maskable-512.png", 512, { scale: 0.8, rounded: false }],
  ["public/icons/apple-touch-icon.png", 180, { rounded: false }],
];
for (const [file, size, opts] of out) {
  await sharp(Buffer.from(svg(size, opts))).png().toFile(file);
  console.log("wrote", file);
}

/**
 * @file app/manifest.ts
 * @description PWA の manifest（/manifest.webmanifest として配信。テスト一覧 W1）。
 * ホーム画面に置けて、全画面（standalone）で開けるようにする。
 * 家計簿のデータは端末にキャッシュしない方針なので、オフライン機能は持たない（public/sw.js）。
 * アイコンは scripts/generate-icons.mjs で作る。
 */

import type { MetadataRoute } from "next";

export const THEME_COLOR = "#2563eb";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "カレンダー家計簿",
    short_name: "家計簿",
    description: "レシートを撮るだけ・定期支出は自動。カレンダーで見る家計簿",
    lang: "ja",
    start_url: "/calendar",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f9fafb",
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

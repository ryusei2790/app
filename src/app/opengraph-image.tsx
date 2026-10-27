/**
 * @file app/opengraph-image.tsx
 * @description 着地ページの OGP 画像（1200×630、mywork#878）。SNS で URL を貼ったときに出る。
 * 日本語フォントを読み込まずに済むよう、文字は英数字と記号だけにしている。
 */

import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "カレンダー家計簿";

export default function OgImage() {
  const cells = Array.from({ length: 28 }, (_, i) => i);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#eff6ff", padding: 64, alignItems: "center", gap: 56 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 34, color: "#1d4ed8", fontWeight: 700 }}>kakebo</div>
          <div style={{ fontSize: 76, color: "#111827", fontWeight: 800, lineHeight: 1.1, marginTop: 16 }}>Calendar Budget</div>
          <div style={{ fontSize: 34, color: "#4b5563", marginTop: 24 }}>Card CSV in. Monthly spend on a calendar.</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", width: 420, gap: 10, background: "#fff", padding: 24, borderRadius: 24 }}>
          {cells.map((i) => (
            <div key={i} style={{ width: 44, height: 44, borderRadius: 8, background: [3, 9, 17, 24].includes(i) ? "#fecaca" : "#f3f4f6" }} />
          ))}
        </div>
      </div>
    ),
    size
  );
}

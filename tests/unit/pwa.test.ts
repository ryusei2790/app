/**
 * @file tests/unit/pwa.test.ts
 * @description テスト一覧 F（PWA）のうち、サーバーを起動しなくても確かめられる部分。
 * - W1 manifest の中身（名前・アイコン・start_url・display=standalone）と、アイコンの実物の大きさ
 * - W2 Service Worker が家計簿のデータを端末に残さない作り（Cache API を使わない）であること
 * 実際にブラウザでインストール可能か・オフライン表示は E2E（tests/e2e/pwa.spec.ts）で見る。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const PUBLIC = path.resolve(__dirname, "../../public");

describe("W1 manifest", () => {
  const m = manifest();

  it("名前・start_url・standalone・色", () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect((m.short_name ?? "").length).toBeLessThanOrEqual(12); // ホーム画面のアイコン名が切れない長さ
    expect(m.start_url).toBe("/calendar");
    expect(m.display).toBe("standalone");
    expect(m.lang).toBe("ja");
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("192px と 512px の PNG アイコンがあり、maskable もある（Android のインストール条件）", async () => {
    const icons = m.icons ?? [];
    for (const size of [192, 512]) {
      const icon = icons.find((i) => i.sizes === `${size}x${size}` && i.type === "image/png" && i.purpose !== "maskable");
      expect(icon, `${size}px`).toBeTruthy();
      const meta = await sharp(readFileSync(path.join(PUBLIC, icon!.src))).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["png", size, size]);
    }
    const maskable = icons.find((i) => i.purpose === "maskable");
    expect(maskable).toBeTruthy();
    const meta = await sharp(readFileSync(path.join(PUBLIC, maskable!.src))).metadata();
    expect(meta.width).toBeGreaterThanOrEqual(512);
  });

  it("iPhone のホーム画面用アイコン（180px）がある", async () => {
    const meta = await sharp(readFileSync(path.join(PUBLIC, "icons/apple-touch-icon.png"))).metadata();
    expect([meta.width, meta.height]).toEqual([180, 180]);
  });
});

describe("W2 Service Worker は何もキャッシュしない", () => {
  const sw = readFileSync(path.join(PUBLIC, "sw.js"), "utf8");

  it("Cache API・IndexedDB を使わない（家計簿のデータを端末に残さない）", () => {
    expect(sw).not.toMatch(/caches\.|cache\.put|addAll|indexedDB/);
  });

  it("画面の移動（navigate）だけを受け持ち、オフラインなら「接続が必要」を返す", () => {
    expect(sw).toMatch(/request\.mode === "navigate"/);
    expect(sw).toMatch(/接続が必要/);
  });

  it("API（/api/）の書き込みを溜めて後で送る仕組みを持たない", () => {
    expect(sw).not.toMatch(/sync|backgroundFetch|\/api\//);
  });
});

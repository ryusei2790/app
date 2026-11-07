/**
 * @file tests/unit/nav.test.ts
 * @description ホームへの動線（mywork#1238）の単体テスト。DB 不要。
 *   N1 ホームの行き先はログイン後の既定の戻り先（/start）と同じで、画面が実在する
 *   N2 スマホの下のタブは ホーム・手入力・レシート・決算・チャット の5つで、どれも画面が実在する
 *   N3 ホームのタブはホームとその下だけを「いまの画面」とみなす（/start 以外で光らない）
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_ITEM, HOME_PATH, isActivePath, tabItems } from "@/lib/nav";
import { DEFAULT_NEXT } from "@/lib/safe-next";
import { buildMenu } from "@/lib/menu/layout";

function pageExists(href: string): boolean {
  const app = path.resolve(__dirname, "../../src/app");
  return ["(dashboard)", "."].some((g) => existsSync(path.join(app, g, href, "page.tsx")));
}

describe("N1 ホーム", () => {
  it("ホームはログイン後の既定の戻り先と同じ /start で、画面がある", () => {
    expect(HOME_PATH).toBe("/start");
    expect(HOME_PATH).toBe(DEFAULT_NEXT);
    expect(HOME_ITEM.href).toBe(HOME_PATH);
    expect(pageExists(HOME_PATH)).toBe(true);
  });
});

describe("N2 下のタブ", () => {
  const { fixed } = buildMenu([], { isOwner: false });
  it("ホーム＋標準3つ＋チャットの5つ", () => {
    expect(tabItems(fixed).map((t) => t.id)).toEqual(["start", "manual", "receipt", "closing", "chat"]);
  });
  it("375px に収まるよう「今月の決算」は「決算」と短くする", () => {
    expect(tabItems(fixed).find((t) => t.id === "closing")?.label).toBe("決算");
    for (const t of tabItems(fixed)) expect([...t.label].length).toBeLessThanOrEqual(5);
  });
  it("どのタブも行き先の画面がある", () => {
    for (const t of tabItems(fixed)) expect(pageExists(t.href), t.href).toBe(true);
  });
});

describe("N3 いまの画面", () => {
  it("ホームのタブは /start だけで光る", () => {
    expect(isActivePath("/start", HOME_PATH)).toBe(true);
    expect(isActivePath("/closing", HOME_PATH)).toBe(false);
    expect(isActivePath("/startup", HOME_PATH)).toBe(false);
  });
});

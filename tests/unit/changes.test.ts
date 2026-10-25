/**
 * @file tests/unit/changes.test.ts
 * @description 更新履歴（mywork#764 ⑥）。C1 新しい順で日付の形が正しい・C2 ページが実在しメニューから開ける・C3 データの持ち方がある
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHANGES, CHANGES_PATH, PRIVACY_NOTE } from "@/lib/changes/history";
import { CATALOG } from "@/lib/menu/catalog";

describe("更新履歴", () => {
  it("C1 日付は YYYY-MM-DD で新しい順", () => {
    for (const c of CHANGES) {
      expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.items.length).toBeGreaterThan(0);
    }
    const dates = CHANGES.map((c) => c.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("C2 ページが実在し、機能カタログにある", () => {
    expect(existsSync(path.resolve(__dirname, "../../src/app", `.${CHANGES_PATH}`, "page.tsx"))).toBe(true);
    expect(CATALOG.find((f) => f.href === CHANGES_PATH)).toBeTruthy();
  });

  it("C3 データの持ち方に保存先と消し方がある", () => {
    const t = PRIVACY_NOTE.join("");
    expect(t).toContain("Supabase");
    expect(t).toContain("全削除");
  });
});

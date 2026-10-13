/**
 * @file tests/unit/import-plan.test.ts
 * @description テスト一覧 I の取り込み計画（DB に触らない純粋関数 lib/import/plan.ts）。
 * - I4 同じ CSV をもう一度 → 全部「取り込み済み」
 * - I5 同じ内容の行2つ → 2件とも新規。もう一度 → 2件とも取り込み済み
 * - I6 期間が重なる2つの書き出し → 重なりは取り込み済み、新しい行だけ新規
 * - I7 今日より後の行は「予定」（取引にしない）
 * - I8 定期で自動作成された取引と同じ行は「定期で作成済み」
 * DB を通した確認は tests/api/import-api.test.ts。
 */

import { describe, expect, it } from "vitest";
import { parseKakebo } from "@/lib/csv/kakebo";
import { withImportKeys } from "@/lib/csv/import-key";
import { buildImportPlan, type PlanInput } from "@/lib/import/plan";

const HEADER = "金額,日付,メモ,カテゴリー名";
const rowsOf = (...lines: string[]) => withImportKeys(parseKakebo([HEADER, ...lines].join("\n")).rows);
const TODAY = "2026-10-13";

function plan(rows: ReturnType<typeof rowsOf>, over: Partial<PlanInput> = {}) {
  return buildImportPlan({ rows, today: TODAY, existingKeys: new Set(), autoTransactions: [], scheduled: [], ...over });
}

describe("I4・I5 何回入れても増えない／同じ内容の2行は2件", () => {
  const rows = rowsOf("-500,2026/09/03,パン,食費", "-500,2026/09/03,パン,食費", "-300,2026/09/01,,日用品");

  it("1回目は3件とも新規（同じ内容の2行も潰さない）", () => {
    const p = plan(rows);
    expect(p.fresh).toHaveLength(3);
    expect(p.already).toHaveLength(0);
  });

  it("2回目（1回目の目印が DB にある）は3件とも取り込み済み", () => {
    const p = plan(rows, { existingKeys: new Set(rows.map((r) => r.importKey)) });
    expect(p.fresh).toHaveLength(0);
    expect(p.already).toHaveLength(3);
  });
});

describe("I6 期間が重なる2つの書き出し", () => {
  it("古い方を入れた後に新しい方を入れると、重なりはとばし新しい行だけ入る", () => {
    const old = rowsOf("-500,2026/09/03,パン,食費", "-300,2026/09/01,,日用品");
    const neu = rowsOf("-700,2026/09/10,,食費", "-500,2026/09/03,パン,食費", "-500,2026/09/03,パン,食費", "-300,2026/09/01,,日用品");
    const p = plan(neu, { existingKeys: new Set(old.map((r) => r.importKey)) });
    // 9/10 の行と、9/03 パンの「2個目」だけが新規
    expect(p.fresh.map((r) => `${r.date} ${r.amount}`).sort()).toEqual(["2026-09-03 500", "2026-09-10 700"]);
    expect(p.already).toHaveLength(2); // パンの1個目と日用品
  });
});

describe("I7 今日より後の行は予定", () => {
  const rows = rowsOf("-59590,2026/10/27,家賃,家賃", "30000,2026/10/31,,給料", "-100,2026/10/13,,食費");

  it("今日（JST）の行は取引、明日以降は予定。予定は初期値で選ばれ、支払日は日付の日", () => {
    const p = plan(rows);
    expect(p.fresh.map((r) => r.date)).toEqual(["2026-10-13"]);
    expect(p.future.map((f) => [f.date, f.billingDay, f.alreadyScheduled])).toEqual([
      ["2026-10-27", 27, false],
      ["2026-10-31", 31, false],
    ]);
  });

  it("同じ内容の定期（毎月・同じ日・金額・カテゴリー）が登録済みなら「登録済み」", () => {
    const p = plan(rows, {
      scheduled: [{ amount: 59590, type: "expense", categoryName: "家賃", billingDay: 27 }],
    });
    expect(p.future.find((f) => f.categoryName === "家賃")?.alreadyScheduled).toBe(true);
    expect(p.future.find((f) => f.categoryName === "給料")?.alreadyScheduled).toBe(false);
  });

  it("同じファイルに同じ定期の予定が2か月分あっても、定期は1つ分だけ選ぶ", () => {
    const p = plan(rowsOf("-59590,2026/10/27,家賃,家賃", "-59590,2026/11/27,家賃,家賃"));
    expect(p.future.map((f) => f.alreadyScheduled)).toEqual([false, true]);
  });
});

describe("I8 定期で自動作成された取引と同じ行はとばす", () => {
  it("同じ日・金額・支出/収入・カテゴリーの自動取引があれば「定期で作成済み」", () => {
    const rows = rowsOf("-59590,2026/09/27,家賃,家賃", "-59590,2026/08/27,家賃,家賃");
    const p = plan(rows, {
      autoTransactions: [{ date: "2026-09-27", amount: 59590, type: "expense", categoryName: "家賃" }],
    });
    expect(p.recurringDone.map((r) => r.date)).toEqual(["2026-09-27"]);
    expect(p.fresh.map((r) => r.date)).toEqual(["2026-08-27"]);
  });

  it("自動取引1件がとばすのは1行だけ（同じ日に同じ行が2つなら1つは新規）", () => {
    const rows = rowsOf("-1000,2026/09/27,,家賃", "-1000,2026/09/27,,家賃");
    const p = plan(rows, {
      autoTransactions: [{ date: "2026-09-27", amount: 1000, type: "expense", categoryName: "家賃" }],
    });
    expect(p.recurringDone).toHaveLength(1);
    expect(p.fresh).toHaveLength(1);
  });

  it("取り込み済みの行は自動取引と照合しない（自動取引を別の行に使える）", () => {
    const rows = rowsOf("-1000,2026/09/27,,家賃");
    const p = plan(rows, {
      existingKeys: new Set([rows[0].importKey]),
      autoTransactions: [{ date: "2026-09-27", amount: 1000, type: "expense", categoryName: "家賃" }],
    });
    expect(p.already).toHaveLength(1);
    expect(p.recurringDone).toHaveLength(0);
  });
});

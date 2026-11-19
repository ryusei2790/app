/**
 * @file tests/unit/closing-goals.test.ts
 * @description さかのぼって決算・決算から目標（mywork#1238 第2弾）。DB・AI 不要。
 *   G1 決算できる月は今月〜12か月前（未来は不可）。目標はそれに来月を足した範囲
 *   G2 月の呼び方（今月・先月・来月・YYYY年M月）
 *   G3 目標の候補はコードで計算（1,000円単位・同じ額はまとめる・支出0なら無し）と、目標額の入力チェック
 *   G4 AI に目標と「目標 − 支出」を渡し、見出しは次の月の呼び方（先月を決算すれば「今月の目標」）
 *   G5 チャットの機能説明に、さかのぼり方と目標の決め方が入っている（本人のスクショで「わかりません」と答えた件）
 */

import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/aggregate/monthly";
import { buildFacts, closingSystemPrompt, runClosingBot } from "@/lib/closing/bot";
import {
  CLOSING_BACK_MONTHS,
  goalProgress,
  goalSuggestions,
  isClosableMonth,
  isExpenseGoal,
  isGoalMonth,
  monthRelLabel,
  selectableMonths,
} from "@/lib/closing/goals";
import { describeCatalog } from "@/lib/menu/layout";
import { HELP_SECTIONS } from "@/lib/help/sections";
import type { CreateMessage } from "@/lib/menu/chat";

const today = "2026-11-07";

describe("G1 選べる月", () => {
  it("今月から12か月前まで、新しい順（年をまたぐ）", () => {
    const m = selectableMonths(today);
    expect(m).toHaveLength(CLOSING_BACK_MONTHS);
    expect(m[0]).toBe("2026-11");
    expect(m[1]).toBe("2026-10");
    expect(m[11]).toBe("2025-12");
  });
  it("先月・半年前は決算できる。13か月前と来月はできない", () => {
    expect(isClosableMonth("2026-10", today)).toBe(true);
    expect(isClosableMonth("2026-05", today)).toBe(true);
    expect(isClosableMonth("2025-11", today)).toBe(false);
    expect(isClosableMonth("2026-12", today)).toBe(false);
  });
  it("目標は来月まで付けられる（今月を決算して来月の目標）。再来月は不可", () => {
    expect(isGoalMonth("2026-12", today)).toBe(true);
    expect(isGoalMonth("2026-11", today)).toBe(true);
    expect(isGoalMonth("2027-01", today)).toBe(false);
  });
});

describe("G2 月の呼び方", () => {
  it("今月・先月・来月・それ以外", () => {
    expect(monthRelLabel("2026-11", today)).toBe("今月");
    expect(monthRelLabel("2026-10", today)).toBe("先月");
    expect(monthRelLabel("2026-12", today)).toBe("来月");
    expect(monthRelLabel("2026-08", today)).toBe("2026年8月");
  });
  it("1月の先月は前の年の12月", () => {
    expect(monthRelLabel("2026-12", "2027-01-03")).toBe("先月");
  });
});

describe("G3 目標の候補と入力", () => {
  it("同じくらい・5%減・10%減を1,000円単位で", () => {
    expect(goalSuggestions(123_456)).toEqual([
      { label: "同じくらい", amount: 123_000 },
      { label: "5%減らす", amount: 117_000 },
      { label: "10%減らす", amount: 111_000 },
    ]);
  });
  it("丸めて同じ額になった候補は1つ・支出0なら無し", () => {
    expect(goalSuggestions(1_000).map((s) => s.amount)).toEqual([1_000]);
    expect(goalSuggestions(0)).toEqual([]);
  });
  it("目標額は 1〜99,999,999 の整数か null", () => {
    expect(isExpenseGoal(null)).toBe(true);
    expect(isExpenseGoal(120000)).toBe(true);
    expect(isExpenseGoal(0)).toBe(false);
    expect(isExpenseGoal(1.5)).toBe(false);
    expect(isExpenseGoal(100_000_000)).toBe(false);
    expect(isExpenseGoal("120000")).toBe(false);
  });
  it("進み具合: 残りとオーバー", () => {
    expect(goalProgress(100_000, 80_000)).toEqual({ goal: 100_000, spent: 80_000, left: 20_000, over: false });
    expect(goalProgress(100_000, 120_000)?.over).toBe(true);
    expect(goalProgress(null, 1)).toBeNull();
  });
});

describe("G4 AI に渡す目標と見出し", () => {
  const cur = summarize({
    month: "2026-10",
    today,
    txs: [{ id: "a", date: "2026-10-03", amount: 90_000, type: "expense", kind: "normal", categoryId: "food", categoryName: "食費", categoryType: "expense", note: "", source: "manual" }],
  });
  it("目標と 目標−支出 をコードで計算して渡す", () => {
    const f = buildFacts(cur, null, false, { goal: 100_000, nextLabel: "今月" });
    expect(f.goal).toBe(100_000);
    expect(f.goalLeft).toBe(10_000);
    expect(f.nextLabel).toBe("今月");
    const none = buildFacts(cur, null, false);
    expect(none.goal).toBeNull();
    expect(none.goalLeft).toBeNull();
    expect(none.nextLabel).toBe("来月");
  });
  it("先月を決算すると見出しは「今月の目標」", async () => {
    expect(closingSystemPrompt("今月")).toContain("## 今月の目標");
    expect(closingSystemPrompt()).toContain("## 来月の目標");
    let system = "";
    const create: CreateMessage = async (p) => {
      system = String(p.system);
      return { content: [{ type: "text", text: "## この月のまとめ\n- ok" }], usage: { input_tokens: 1, output_tokens: 1 } } as never;
    };
    await runClosingBot({ facts: buildFacts(cur, null, false, { nextLabel: "今月" }), create });
    expect(system).toContain("## 今月の目標");
  });
});

describe("G5 チャットと使い方が答えられる", () => {
  it("機能の一覧（チャットの AI が読む）に、さかのぼり方と目標の決め方がある", () => {
    const text = describeCatalog([], { isOwner: false });
    const closing = text.split("\n").find((l) => l.includes("id=closing"))!;
    expect(closing).toContain("さかのぼって決算");
    expect(closing).toContain("決算する月");
    expect(closing).toContain("目標");
  });
  it("使い方に決算の節がある", () => {
    const s = HELP_SECTIONS.find((h) => h.id === "closing")!;
    expect(s.href).toBe("/closing");
    expect(s.steps.join("")).toContain("決算する月");
  });
});

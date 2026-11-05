/**
 * @file tests/unit/closing-bot.test.ts
 * @description 決算日の提案ボット（mywork#1150 第2弾）。日付の計算・AI に渡す事実（明細やメモを渡さない）・
 * AI の返事の後始末（HTML タグ・囲みを外す）を確かめる。AI はモック。
 */

import { describe, expect, it } from "vitest";
import { summarize, type AggTx } from "@/lib/aggregate/monthly";
import {
  buildFacts,
  closingDateOf,
  isAfterClosing,
  isClosingDay,
  nextMonth,
  prevMonth,
  runClosingBot,
  sanitizeMarkdown,
} from "@/lib/closing/bot";
import type { CreateMessage } from "@/lib/menu/chat";

function tx(p: Partial<AggTx> & { date: string; amount: number }): AggTx {
  return {
    id: Math.random().toString(36),
    type: "expense",
    kind: "normal",
    categoryId: "food",
    categoryName: "食費",
    categoryType: "expense",
    note: "秘密のメモ・スーパー山田",
    source: "manual",
    ...p,
  };
}

describe("日付", () => {
  it("決算日の値は 1〜28 か null", () => {
    expect(isClosingDay(null)).toBe(true);
    expect(isClosingDay(1)).toBe(true);
    expect(isClosingDay(28)).toBe(true);
    expect(isClosingDay(29)).toBe(false);
    expect(isClosingDay(0)).toBe(false);
    expect(isClosingDay(2.5)).toBe(false);
    expect(isClosingDay("10")).toBe(false);
  });
  it("前の月・次の月は年をまたぐ", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(prevMonth("2026-11")).toBe("2026-10");
  });
  it("月末は月ごと（うるう年も）", () => {
    expect(closingDateOf("2026-11", null)).toBe("2026-11-30");
    expect(closingDateOf("2028-02", null)).toBe("2028-02-29");
    expect(closingDateOf("2026-11", 25)).toBe("2026-11-25");
  });
  it("決算日以降か", () => {
    expect(isAfterClosing("2026-11-29", "2026-11", null)).toBe(false);
    expect(isAfterClosing("2026-11-30", "2026-11", null)).toBe(true);
    expect(isAfterClosing("2026-11-25", "2026-11", 25)).toBe(true);
    expect(isAfterClosing("2026-12-01", "2026-11", null)).toBe(true);
  });
});

describe("AI に渡す事実", () => {
  const cur = summarize({
    month: "2026-11",
    today: "2026-11-30",
    txs: [tx({ date: "2026-11-03", amount: 3000 }), tx({ date: "2026-11-10", amount: 1000, categoryId: "daily", categoryName: "日用品" }), tx({ date: "2026-11-25", amount: 200000, type: "income", categoryId: "salary", categoryName: "給与", categoryType: "income" })],
  });
  const prev = summarize({ month: "2026-10", today: "2026-11-30", txs: [tx({ date: "2026-10-05", amount: 5000 })] });

  it("前月比はここで計算し、明細・メモは入らない", () => {
    const f = buildFacts(cur, prev, false);
    expect(f.expense).toBe(4000);
    expect(f.income).toBe(200000);
    expect(f.prevExpense).toBe(5000);
    const food = f.categories.find((c) => c.name === "食費")!;
    expect(food.prevAmount).toBe(5000);
    expect(food.diff).toBe(-2000);
    expect(f.categories.find((c) => c.name === "日用品")!.prevAmount).toBe(0);
    const json = JSON.stringify(f);
    expect(json).not.toContain("秘密のメモ");
    expect(json).not.toContain("スーパー山田");
    expect(json).not.toContain("2026-11-03");
  });

  it("前月に記録が無ければ比べない（null）", () => {
    const empty = summarize({ month: "2026-10", today: "2026-11-30", txs: [] });
    const f = buildFacts(cur, empty, true);
    expect(f.prevExpense).toBeNull();
    expect(f.categories.every((c) => c.prevAmount === null && c.diff === null)).toBe(true);
    expect(f.inProgress).toBe(true);
  });

  it("AI には Sonnet 5.5 で事実の JSON を渡し、返事を Markdown にする", async () => {
    let sent: Parameters<CreateMessage>[0] | null = null;
    const create: CreateMessage = async (params) => {
      sent = params;
      return {
        content: [{ type: "text", text: "```markdown\n## 今月のまとめ\n- よくできました<script>alert(1)</script>\n```" }],
        usage: { input_tokens: 500, output_tokens: 300 },
      } as never;
    };
    const r = await runClosingBot({ facts: buildFacts(cur, prev, false), create });
    expect(sent!.model).toBe("claude-sonnet-5-5");
    expect(JSON.stringify(sent!.messages)).not.toContain("秘密のメモ");
    expect(r.markdown).toBe("## 今月のまとめ\n- よくできましたalert(1)");
    expect(r.inputTokens).toBe(500);
  });

  it("空の返事は失敗にする", async () => {
    const create: CreateMessage = async () => ({ content: [], usage: { input_tokens: 1, output_tokens: 0 } }) as never;
    await expect(runClosingBot({ facts: buildFacts(cur, prev, false), create })).rejects.toThrow();
  });
});

describe("sanitizeMarkdown", () => {
  it("HTML タグを外し、長さを上限に収める", () => {
    expect(sanitizeMarkdown('<img src=x onerror="a()">本文')).toBe("本文");
    expect(sanitizeMarkdown("a".repeat(30000)).length).toBe(20000);
  });
});

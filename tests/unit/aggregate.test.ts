/**
 * @file tests/unit/aggregate.test.ts
 * @description テスト一覧 D（集計の定義と kind、mywork#425 第1弾）のうち DB を使わない部分。
 * 設計書 4-1 の定義をそのまま検査する:
 * - D1 kind の既定は normal（入力の検査）
 * - D2 支出＝購入−返金。返金は返金の日付の月・同じカテゴリーから引く。返金が購入より多いカテゴリーは負で出る
 * - D3 振替・借入・返済は支出にも収入にも入らない
 * - D4 今月は今日まで。今日より後の行は「予定」で合計に入らない。月末・月初の境界
 * - D5 過去の月は月末まで。先の月は全部「予定」
 * - D6 返金が購入の 10% 以上または 5件以上の月だけ「返金が多い月」
 * - D7 予算の費目: 返金は同じ費目から引く。振替・借入は費目に入らない。未割り当ての返金は合計からだけ引く
 * - D8 固定／変動: 返金は元と同じ側から引く。固定＋変動＝支出
 * - D10 画面の文言は definitions.ts に1か所（他のファイルに同じ文言を直書きしない）
 * - D11 要確認: 返金候補・未割り当て・予定・重複候補を列挙し、直すと消える
 * - 回帰用の正規化（canonical）は並び順に左右されず、1円違えばハッシュが変わる
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATA_FLOW,
  DEFINITIONS,
  DEFINITIONS_VERSION,
  FOOTNOTES,
  KNOWN_LIMITS,
  REFUND_HEAVY,
  TRANSACTION_KINDS,
} from "@/lib/aggregate/definitions";
import { periodOf, summarize, toBudgetTxs, type AggTx } from "@/lib/aggregate/monthly";
import { review } from "@/lib/aggregate/review";
import { canonicalize, sha256Hex } from "@/lib/aggregate/canonical";
import { parseKind } from "@/lib/validation/transaction";
import { DEFAULT_FRAMES, DEFAULT_RULES } from "@/lib/budget/defaults";
import type { BudgetRule } from "@/lib/budget/classify";
import type { BudgetFrame } from "@/lib/budget/summary";
import type { FixedCondition } from "@/lib/fixed/classify";

// ─── テスト用の取引・費目・定期の条件 ───────────────────────────
let seq = 0;
const tx = (over: Partial<AggTx> = {}): AggTx => ({
  id: `t${++seq}`,
  date: "2026-09-10",
  amount: 1000,
  type: "expense",
  kind: "normal",
  categoryId: "C:食費",
  categoryName: "食費",
  categoryType: "expense",
  note: null,
  source: "csv",
  ...over,
});

const frames: BudgetFrame[] = DEFAULT_FRAMES.map((f, i) => ({ id: `F:${f.name}`, ...f, sortOrder: i }));
const rules: BudgetRule[] = DEFAULT_RULES.map((r, i) => ({
  id: `R${i}`,
  categoryId: "categoryName" in r ? `C:${r.categoryName}` : null,
  memoKeyword: "memoKeyword" in r ? r.memoKeyword : null,
  frameId: r.frame === null ? null : `F:${r.frame}`,
  priority: i,
}));

const rent: FixedCondition = { id: "fc-rent", type: "expense", categoryId: "C:家賃", amount: 59590, matchNote: null, matchAnyAmount: false };
const gym: FixedCondition = { id: "fc-gym", type: "expense", categoryId: "C:趣味", amount: 8000, matchNote: "ジム", matchAnyAmount: false };

/** 9月（過去の月）をまとめる。today は 10/14 */
const sept = (txs: AggTx[], extra: Partial<Parameters<typeof summarize>[0]> = {}) =>
  summarize({ txs, month: "2026-09", today: "2026-10-14", ...extra });

describe("D1 kind の既定は normal", () => {
  it("未指定は normal、4種以外は受け付けない", () => {
    expect(parseKind(undefined)).toEqual({ ok: true, value: "normal" });
    for (const k of TRANSACTION_KINDS) expect(parseKind(k)).toEqual({ ok: true, value: k });
    expect(parseKind("gift").ok).toBe(false);
    expect(parseKind(1).ok).toBe(false);
  });
});

describe("D2 支出＝購入−返金", () => {
  it("返金は同じカテゴリーから引き、支出の合計も減る", () => {
    const s = sept([
      tx({ amount: 1200 }),
      tx({ amount: 800 }),
      tx({ amount: 300, type: "income", kind: "refund" }), // 食費の返金
    ]);
    expect(s.expense).toMatchObject({ purchases: 2000, refunds: 300, total: 1700, refundCount: 1 });
    expect(s.byCategory).toEqual([
      expect.objectContaining({ categoryId: "C:食費", purchases: 2000, refunds: 300, amount: 1700, count: 2 }),
    ]);
    expect(s.balance).toBe(-1700);
  });

  it("返金が購入より多いカテゴリーは負で出す（隠さない）", () => {
    const s = sept([
      tx({ amount: 500, categoryId: "C:衣服", categoryName: "衣服" }),
      tx({ amount: 800, type: "income", kind: "refund", categoryId: "C:衣服", categoryName: "衣服" }),
      tx({ amount: 1000 }),
    ]);
    const clothes = s.byCategory.find((c) => c.categoryId === "C:衣服");
    expect(clothes?.amount).toBe(-300);
    expect(s.expense.total).toBe(700);
    // 内訳の合計はいつも支出の合計と一致
    expect(s.byCategory.reduce((a, c) => a + c.amount, 0)).toBe(s.expense.total);
  });

  it("返金は返金の日付の月から引く（元の購入が前の月でも）", () => {
    const octoberRefund = tx({ date: "2026-10-03", amount: 300, type: "income", kind: "refund" });
    expect(sept([tx({ amount: 1000 }), octoberRefund]).expense.total).toBe(1000);
    const oct = summarize({ txs: [tx({ amount: 1000 }), octoberRefund], month: "2026-10", today: "2026-10-14" });
    expect(oct.expense).toMatchObject({ purchases: 0, refunds: 300, total: -300 });
  });

  it("返金は収入に入らない", () => {
    const s = sept([tx({ amount: 130000, type: "income", kind: "normal", categoryId: "C:その他", categoryType: "income" }), tx({ amount: 300, type: "income", kind: "refund" })]);
    expect(s.income.total).toBe(130000);
  });
});

describe("D3 振替・借入・返済は支出にも収入にも入らない", () => {
  it("お金の流れの枠にだけ出る", () => {
    const s = sept([
      tx({ amount: 1000 }),
      tx({ amount: 5000, kind: "transfer" }), // Suica チャージ（出）
      tx({ amount: 5000, kind: "transfer", type: "income", categoryId: null, categoryName: null, categoryType: null }), // 入
      tx({ amount: 20000, kind: "loan", type: "income", categoryId: null, categoryType: null }), // 借入
      tx({ amount: 3000, kind: "loan" }), // 返済
    ]);
    expect(s.expense.total).toBe(1000);
    expect(s.income.total).toBe(0);
    expect(s.transfers).toEqual({ out: 5000, in: 5000, count: 2 });
    expect(s.loans).toEqual({ repaid: 3000, borrowed: 20000, count: 2 });
    expect(s.byCategory.map((c) => c.categoryId)).toEqual(["C:食費"]);
    expect(s.fixed.fixedExpense + s.fixed.variableExpense).toBe(1000);
  });
});

describe("D4 今月は今日まで。今日より後は「予定」", () => {
  const txs = [
    tx({ date: "2026-10-01", amount: 10 }),
    tx({ date: "2026-10-14", amount: 100 }),
    tx({ date: "2026-10-15", amount: 1000 }),
    tx({ date: "2026-10-31", amount: 10000 }),
    tx({ date: "2026-10-27", amount: 130000, type: "income", categoryId: "C:その他", categoryType: "income" }),
  ];

  it("今日（10/14）までを合計し、それより後は予定に分ける", () => {
    const s = summarize({ txs, month: "2026-10", today: "2026-10-14" });
    expect(s.period).toEqual({ start: "2026-10-01", end: "2026-10-14", status: "current" });
    expect(s.expense.total).toBe(110);
    expect(s.income.total).toBe(0);
    expect(s.scheduled).toMatchObject({ expense: 11000, income: 130000, count: 3 });
    expect(s.scheduled.items.map((i) => i.date)).toEqual(["2026-10-15", "2026-10-27", "2026-10-31"]);
    expect(s.balance).toBe(-110);
  });

  it("月末の当日は月の全部が入り、予定は無い", () => {
    const s = summarize({ txs, month: "2026-10", today: "2026-10-31" });
    expect(s.period.end).toBe("2026-10-31");
    expect(s.expense.total).toBe(11110);
    expect(s.scheduled.count).toBe(0);
  });

  it("月初（10/1）は 10/1 の分だけが入る", () => {
    const s = summarize({ txs, month: "2026-10", today: "2026-10-01" });
    expect(s.expense.total).toBe(10);
    expect(s.scheduled.count).toBe(4);
  });

  it("periodOf は過去・今月・先の月を区別する", () => {
    expect(periodOf("2026-09", "2026-10-14")).toEqual({ start: "2026-09-01", end: "2026-09-30", status: "past" });
    expect(periodOf("2026-10", "2026-10-14")).toEqual({ start: "2026-10-01", end: "2026-10-14", status: "current" });
    expect(periodOf("2026-11", "2026-10-14")).toEqual({ start: "2026-11-01", end: "2026-11-30", status: "future" });
    // 2月（うるう年ではない 2027）
    expect(periodOf("2027-02", "2027-03-01").end).toBe("2027-02-28");
  });
});

describe("D5 過去の月は月末まで。先の月は全部「予定」", () => {
  it("過去の月は今日に関係なく月末まで入る", () => {
    const s = summarize({ txs: [tx({ date: "2026-09-30", amount: 500 })], month: "2026-09", today: "2026-10-14" });
    expect(s.period.status).toBe("past");
    expect(s.expense.total).toBe(500);
    expect(s.scheduled.count).toBe(0);
  });

  it("先の月は合計 0 で、行は全部予定", () => {
    const s = summarize({ txs: [tx({ date: "2026-11-01", amount: 500 })], month: "2026-11", today: "2026-10-14" });
    expect(s.period.status).toBe("future");
    expect(s.expense.total).toBe(0);
    expect(s.scheduled).toMatchObject({ expense: 500, count: 1 });
  });

  it("他の月の行は数えない", () => {
    const s = sept([tx({ date: "2026-08-31", amount: 1 }), tx({ date: "2026-10-01", amount: 2 }), tx({ amount: 4 })]);
    expect(s.expense.total).toBe(4);
    expect(s.scheduled.count).toBe(0);
  });
});

describe("D6 返金が多い月", () => {
  it("返金が購入の 10% 以上なら「返金が多い」", () => {
    expect(REFUND_HEAVY).toEqual({ ratio: 0.1, count: 5 });
    const under = sept([tx({ amount: 10000 }), tx({ amount: 999, type: "income", kind: "refund" })]);
    expect(under.expense.refundHeavy).toBe(false);
    const over = sept([tx({ amount: 10000 }), tx({ amount: 1000, type: "income", kind: "refund" })]);
    expect(over.expense.refundHeavy).toBe(true);
  });

  it("件数が 5件以上でも「返金が多い」（金額が小さくても）", () => {
    const refunds = Array.from({ length: 5 }, () => tx({ amount: 1, type: "income", kind: "refund" }));
    expect(sept([tx({ amount: 100000 }), ...refunds]).expense.refundHeavy).toBe(true);
    expect(sept([tx({ amount: 100000 }), ...refunds.slice(0, 4)]).expense.refundHeavy).toBe(false);
  });

  it("返金が 0 件なら多くない", () => {
    expect(sept([tx()]).expense.refundHeavy).toBe(false);
    expect(sept([]).expense.refundHeavy).toBe(false);
  });
});

describe("D7 予算の費目との整合", () => {
  it("返金は同じ費目から引き、振替・借入は費目に入らない", () => {
    const s = sept(
      [
        tx({ amount: 1200 }), // 食費 → 費目「食費」
        tx({ amount: 300, type: "income", kind: "refund" }), // 食費の返金
        tx({ amount: 5000, kind: "transfer" }),
        tx({ amount: 20000, kind: "loan", type: "income" }),
      ],
      { budget: { frames, rules } }
    );
    const food = s.frames!.frames.find((f) => f.name === "食費")!;
    expect(food.spent).toBe(900);
    expect(s.frames!.total.spent).toBe(900);
    expect(s.frames!.outside).toBe(0);
    expect(s.frames!.unassigned.amount).toBe(0);
    expect(s.frames!.income).toBe(0);
  });

  it("未割り当て（カテゴリー無し）の返金は支出の合計からだけ引く", () => {
    const s = sept(
      [tx({ amount: 1200 }), tx({ amount: 200, type: "income", kind: "refund", categoryId: null, categoryName: null, categoryType: null })],
      { budget: { frames, rules } }
    );
    expect(s.expense.total).toBe(1000);
    expect(s.frames!.frames.find((f) => f.name === "食費")!.spent).toBe(1200);
    expect(s.frames!.total.spent).toBe(1200);
    // 未割り当ての欄に「−200（1件）」として見える
    expect(s.frames!.unassigned).toMatchObject({ count: 1, amount: -200 });
  });

  it("toBudgetTxs: 返金は負の支出、振替・借入は落とす", () => {
    const out = toBudgetTxs([
      tx({ amount: 1200 }),
      tx({ amount: 300, type: "income", kind: "refund" }),
      tx({ amount: 5000, kind: "transfer" }),
      tx({ amount: 20000, kind: "loan", type: "income" }),
      tx({ amount: 130000, type: "income", categoryId: "C:その他", categoryType: "income" }),
    ]);
    expect(out.map((t) => [t.type, t.amount])).toEqual([
      ["expense", 1200],
      ["expense", -300],
      ["income", 130000],
    ]);
  });

  it("予算を渡さなければ frames は null", () => {
    expect(sept([tx()]).frames).toBeNull();
  });
});

describe("D8 固定／変動", () => {
  it("返金は元と同じ側から引く。固定＋変動＝支出", () => {
    const s = sept(
      [
        tx({ date: "2026-09-27", amount: 59590, categoryId: "C:家賃", categoryName: "家賃" }), // 固定
        tx({ date: "2026-09-14", amount: 8000, categoryId: "C:趣味", categoryName: "趣味", note: "ジム" }), // 固定
        tx({ amount: 1200 }), // 変動
        // ジムの返金（同じカテゴリー・メモ・金額）→ 固定から引く
        tx({ date: "2026-09-20", amount: 8000, type: "income", kind: "refund", categoryId: "C:趣味", categoryName: "趣味", note: "ジム 返金" }),
        // 食費の返金 → 変動から引く
        tx({ amount: 200, type: "income", kind: "refund" }),
      ],
      { fixedConditions: [rent, gym] }
    );
    expect(s.fixed.fixedExpense).toBe(59590);
    expect(s.fixed.variableExpense).toBe(1000);
    expect(s.fixed.fixedExpense + s.fixed.variableExpense).toBe(s.expense.total);
  });

  it("収入の固定／変動は定期の条件で決まる", () => {
    const salary: FixedCondition = { id: "fc-s", type: "income", categoryId: "C:給料", amount: 30000, matchNote: null, matchAnyAmount: false };
    const s = sept(
      [
        tx({ amount: 30000, type: "income", categoryId: "C:給料", categoryName: "給料", categoryType: "income" }),
        tx({ amount: 5000, type: "income", categoryId: "C:その他", categoryName: "その他", categoryType: "income", note: "お祝い" }),
      ],
      { fixedConditions: [salary] }
    );
    expect(s.fixed).toMatchObject({ fixedIncome: 30000, variableIncome: 5000 });
    expect(s.fixed.fixedIncome + s.fixed.variableIncome).toBe(s.income.total);
  });
});

describe("D10 文言は definitions.ts に1か所", () => {
  it("定義は10項目で、用語が重ならず、文言と式がある", () => {
    expect(DEFINITIONS).toHaveLength(10);
    expect(new Set(DEFINITIONS.map((d) => d.term)).size).toBe(10);
    for (const d of DEFINITIONS) {
      expect(d.text.length).toBeGreaterThan(5);
      expect(d.formula.length).toBeGreaterThan(0);
    }
    expect(DEFINITIONS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(KNOWN_LIMITS.length).toBeGreaterThanOrEqual(4);
    expect(DATA_FLOW.length).toBeGreaterThanOrEqual(5);
  });

  it("脚注の文言を他のファイルに直書きしていない", () => {
    const srcDir = path.resolve(__dirname, "../../src");
    const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("generated") && !f.endsWith("aggregate/definitions.ts"))
      .map((f) => path.join(srcDir, f));
    const texts = (Object.values(FOOTNOTES) as unknown[]).filter((v): v is string => typeof v === "string");
    expect(texts.length).toBeGreaterThan(0);
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      for (const t of texts) expect(body, `${file} に「${t}」が直書きされています`).not.toContain(t);
    }
  });
});

describe("D11 要確認", () => {
  const month = { month: "2026-10", today: "2026-10-14" };

  it("返金候補: 収入なのに支出のカテゴリー／メモに返金・キャンセル・払い戻し・返品", () => {
    const byCategory = tx({ date: "2026-10-03", amount: 300, type: "income", kind: "normal", categoryType: "expense" });
    const byNote = tx({ date: "2026-10-04", amount: 500, type: "income", kind: "normal", categoryId: "C:その他収入", categoryName: "その他収入", categoryType: "income", note: "Amazon 返品" });
    const salary = tx({ date: "2026-10-05", amount: 30000, type: "income", categoryId: "C:給料", categoryType: "income" });
    const r = review([byCategory, byNote, salary], month);
    expect(r.refundCandidates.map((i) => i.id)).toEqual([byCategory.id, byNote.id]);
    expect(r.refundCandidates[0].reason).toContain("支出のカテゴリー");
    expect(r.refundCandidates[1].reason).toContain("返品");
  });

  it("種類を「返金」に直すと返金候補から消える", () => {
    const t = tx({ date: "2026-10-03", amount: 300, type: "income", kind: "normal", categoryType: "expense" });
    expect(review([t], month).refundCandidates).toHaveLength(1);
    expect(review([{ ...t, kind: "refund" }], month).refundCandidates).toHaveLength(0);
  });

  it("未割り当て: カテゴリーの無い購入", () => {
    const t = tx({ date: "2026-10-03", categoryId: null, categoryName: null, categoryType: null });
    const r = review([t, tx({ date: "2026-10-04" })], month);
    expect(r.unassigned.map((i) => i.id)).toEqual([t.id]);
    expect(review([{ ...t, categoryId: "C:食費" }], month).unassigned).toHaveLength(0);
  });

  it("予定: 今日より後の行", () => {
    const r = review([tx({ date: "2026-10-14" }), tx({ date: "2026-10-15" }), tx({ date: "2026-11-01" })], month);
    expect(r.scheduled.map((i) => i.date)).toEqual(["2026-10-15"]);
  });

  it("重複候補: 同じ日・同じ金額・同じカテゴリー・同じ向き（定期の自動取引は除く）", () => {
    const a = tx({ date: "2026-10-03", amount: 400 });
    const b = tx({ date: "2026-10-03", amount: 400 });
    const c = tx({ date: "2026-10-03", amount: 400, categoryId: "C:外食費", categoryName: "外食費" });
    const auto1 = tx({ date: "2026-10-05", amount: 990, source: "auto" });
    const auto2 = tx({ date: "2026-10-05", amount: 990, source: "auto" });
    const r = review([a, b, c, auto1, auto2], month);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("件数が summarize の review に入る", () => {
    const s = summarize({
      txs: [tx({ date: "2026-10-03", type: "income", kind: "normal", categoryType: "expense" }), tx({ date: "2026-10-20" })],
      ...month,
    });
    expect(s.review).toEqual({ refundCandidates: 1, unassigned: 0, scheduled: 1, duplicates: 0 });
  });
});

describe("回帰用の正規化（canonical）", () => {
  const a = [tx({ amount: 1200 }), tx({ amount: 300, type: "income", kind: "refund" }), tx({ date: "2026-08-01", amount: 5 })];
  it("取引の並び順・id が違っても同じハッシュ", () => {
    const s1 = ["2026-08", "2026-09"].map((m) => summarize({ txs: a, month: m, today: "2026-10-14" }));
    const shuffled = [a[2], a[0], a[1]].map((t) => ({ ...t, id: `x-${t.id}` }));
    const s2 = ["2026-09", "2026-08"].map((m) => summarize({ txs: shuffled, month: m, today: "2026-10-14" }));
    expect(sha256Hex(canonicalize(s1))).toBe(sha256Hex(canonicalize(s2)));
  });

  it("1円違えばハッシュが変わる", () => {
    const s1 = summarize({ txs: a, month: "2026-09", today: "2026-10-14" });
    const s2 = summarize({ txs: [{ ...a[0], amount: 1201 }, a[1], a[2]], month: "2026-09", today: "2026-10-14" });
    expect(sha256Hex(canonicalize([s1]))).not.toBe(sha256Hex(canonicalize([s2])));
    expect(sha256Hex("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});

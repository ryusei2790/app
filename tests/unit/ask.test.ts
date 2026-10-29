/**
 * @file tests/unit/ask.test.ts
 * @description 第3弾「質問 → ルールで読む → コードで集計」（mywork#500、設計書 4-8・追記 2026-10-29）の単体テスト。
 * Q1 期間・Q2 対象・Q3 集計・Q4 読めない質問・Q5 画面と同じ数字・Q6 ラベル・Q8 続けての質問。
 * 今日は 2026-10-14 に固定する。外部 AI は使わない（読み取りも答えもコードだけ）。
 */

import { describe, expect, it } from "vitest";
import { readQuestion, type Reading } from "@/lib/ask/reader";
import { answerReading } from "@/lib/ask/answer";
import { summarize, type AggTx } from "@/lib/aggregate/monthly";

const today = "2026-10-14";
const categories = [
  { id: "food", name: "食費", type: "expense" as const },
  { id: "eat", name: "外食", type: "expense" as const },
  { id: "tr", name: "交通費", type: "expense" as const },
  { id: "sub", name: "サブスク", type: "expense" as const },
  { id: "subx", name: "サブスク（仕事）", type: "expense" as const },
  { id: "sal", name: "給与", type: "income" as const },
];
const vocab = { today, categories };

function read(q: string, prev?: Reading) {
  const r = readQuestion(q, vocab, prev);
  if (!r.ok) throw new Error(`読めない: ${q} (${r.reason})`);
  return r.reading;
}

describe("Q1 期間", () => {
  it.each([
    ["今月の支出は？", "2026-10", "2026-10", "今月"],
    ["先月いくら使った？", "2026-09", "2026-09", "先月"],
    ["先々月の支出", "2026-08", "2026-08", "先々月"],
    ["8月の食費", "2026-08", "2026-08", "2026年8月"],
    ["１１月の食費", "2025-11", "2025-11", "2025年11月"], // 未来の月名は去年（今月より後の月は実績が無いため）
    ["2025年12月の支出", "2025-12", "2025-12", "2025年12月"],
    ["今年の支出", "2026-01", "2026-10", "今年"],
    ["去年の支出", "2025-01", "2025-12", "去年"],
    ["直近3か月の食費", "2026-08", "2026-10", "直近3か月"],
    ["8月から9月の外食", "2026-08", "2026-09", "2026年8月〜2026年9月"],
  ])("%s → %s〜%s", (q, from, to, label) => {
    const r = read(q);
    expect(r.period).toEqual({ from, to, label });
  });

  it("期間が書いてなければ今月", () => {
    expect(read("食費は？").period.from).toBe("2026-10");
  });

  it("13か月を超える期間は読まない（集計が重くなるのを止める）", () => {
    const r = readQuestion("2020年1月から2026年1月の支出", vocab);
    expect(r.ok).toBe(false);
  });
});

describe("Q2 対象", () => {
  it("カテゴリー名（完全一致）", () => {
    expect(read("今月の外食は？").target).toEqual({ type: "category", id: "eat", name: "外食" });
  });
  it("ゆれ: 「交通」でも交通費、「外食費」でも外食", () => {
    expect(read("交通はいくら").target.id).toBe("tr");
    expect(read("外食費はいくら").target.id).toBe("eat");
  });
  it("長い名前を優先（サブスク（仕事）を含む文ではそちら）", () => {
    expect(read("サブスク（仕事）の合計").target.id).toBe("subx");
  });
  it("どちらとも取れる語は推測せず候補を返す", () => {
    const r = readQuestion("サブの合計", { today, categories: categories.filter((c) => c.id !== "food") });
    // 「サブ」は名前より短く、部分一致で2つ当たる → 候補
    expect(r).toMatchObject({ ok: false, reason: "ambiguous" });
    if (!r.ok && r.reason === "ambiguous") expect(r.candidates).toEqual(expect.arrayContaining(["サブスク", "サブスク（仕事）"]));
  });
  it("固定費・変動費・収入・全体", () => {
    expect(read("今月の固定費").target.type).toBe("fixed");
    expect(read("変動費はいくら").target.type).toBe("variable");
    const inc = read("先月の収入は？");
    expect(inc.flow).toBe("income");
    expect(inc.target.type).toBe("all");
    expect(read("今月いくら使った？").target).toEqual({ type: "all", name: "支出全体" });
  });
  it("収入のカテゴリー名でも収入になる", () => {
    const r = read("給与はいくら");
    expect(r.flow).toBe("income");
    expect(r.target).toEqual({ type: "category", id: "sal", name: "給与" });
  });
});

describe("Q3 集計", () => {
  it.each([
    ["今月の食費はいくら", "sum"],
    ["外食は何回？", "count"],
    ["外食の件数", "count"],
    ["1日あたりの食費", "per_day"],
    ["一日平均いくら使ってる？", "per_day"],
  ])("%s → %s", (q, measure) => {
    expect(read(q).measure).toBe(measure);
  });
  it("内訳・月別・比較", () => {
    expect(read("今月の支出の内訳").groupBy).toBe("category");
    expect(read("直近3か月の食費を月別で").groupBy).toBe("month");
    expect(read("先月と比べて今月の食費は").compare).toBe(true);
  });
});

describe("Q4 読めない質問", () => {
  it.each(["こんにちは", "株を買うべき？", ""])("「%s」は unsupported で例文を返す", (q) => {
    const r = readQuestion(q, vocab);
    expect(r).toMatchObject({ ok: false, reason: "unsupported" });
    if (!r.ok && r.reason === "unsupported") expect(r.examples.length).toBeGreaterThan(0);
  });
  it("長すぎる質問（200字超）は読まない", () => {
    expect(readQuestion("食費".repeat(150), vocab).ok).toBe(false);
  });
});

describe("Q8 続けての質問", () => {
  it("「内訳は？」は直前の期間を引き継いでカテゴリー別", () => {
    const prev = read("先月の支出は？");
    const r = read("内訳は？", prev);
    expect(r.period).toEqual(prev.period);
    expect(r.groupBy).toBe("category");
  });
  it("「先月と比べて」は直前の対象を引き継ぐ", () => {
    const prev = read("今月の外食は？");
    const r = read("先月と比べて", prev);
    expect(r.target.id).toBe("eat");
    expect(r.compare).toBe(true);
  });
  it("「月別で」は直前の期間・対象のまま月別", () => {
    const prev = read("直近3か月の食費");
    const r = read("月別で", prev);
    expect(r.target.id).toBe("food");
    expect(r.groupBy).toBe("month");
  });
  it("直前が無ければ「内訳は？」は今月", () => {
    expect(read("内訳は？").period.from).toBe("2026-10");
  });
});

// ─── 答え（集計はコード。画面と同じ summarize） ────────────────────────────

let n = 0;
const tx = (date: string, amount: number, categoryId: string | null, extra: Partial<AggTx> = {}): AggTx => ({
  id: `t${++n}`,
  date,
  amount,
  type: "expense",
  kind: "normal",
  categoryId,
  categoryName: null,
  note: null,
  source: "manual",
  ...extra,
});
const txs: AggTx[] = [
  tx("2026-09-03", 1000, "food"),
  tx("2026-09-20", 3000, "eat"),
  tx("2026-10-01", 2000, "food"),
  tx("2026-10-05", 500, "food"),
  tx("2026-10-06", 300, "food", { kind: "refund" }),
  tx("2026-10-07", 4000, "eat"),
  tx("2026-10-08", 9999, "eat", { kind: "transfer" }),
  tx("2026-10-20", 7777, "food"), // 予定（今日より後）
  tx("2026-10-10", 200000, "sal", { type: "income" }),
];
const data = { txs, today, fixedConditions: [], categories: categories.map((c) => ({ id: c.id, name: c.name, color: null })) };

describe("Q5・Q6 答え", () => {
  it("今月の支出は画面（summarize）と同じ数字・ラベル付き", () => {
    const a = answerReading(read("今月の支出は？"), data);
    const s = summarize({ txs, month: "2026-10", today, categories: data.categories });
    expect(a.value).toBe(s.expense.total);
    expect(a.value).toBe(2000 + 500 - 300 + 4000);
    expect(a.label).toMatch(/^計算（\d+件）$/);
    expect(a.text).toContain("6,200円");
  });
  it("カテゴリー: 返金を引き、振替・予定は入れない", () => {
    const a = answerReading(read("今月の食費は？"), data);
    expect(a.value).toBe(2000 + 500 - 300);
  });
  it("件数", () => {
    const a = answerReading(read("今月の外食は何回？"), data);
    expect(a.value).toBe(1);
    expect(a.text).toContain("1件");
  });
  it("1日あたり（今月は今日まで＝14日で割る）", () => {
    const a = answerReading(read("今月の1日あたりの支出"), data);
    expect(a.value).toBe(Math.round(6200 / 14));
  });
  it("内訳（カテゴリー別、大きい順）", () => {
    const a = answerReading(read("今月の支出の内訳"), data);
    expect(a.breakdown?.map((b) => b.name)).toEqual(["外食", "食費"]);
  });
  it("月別", () => {
    const a = answerReading(read("8月から10月の食費を月別で"), data);
    expect(a.breakdown?.map((b) => [b.name, b.value])).toEqual([
      ["2026年8月", 0],
      ["2026年9月", 1000],
      ["2026年10月", 2200],
    ]);
  });
  it("比較（前の同じ長さの期間）", () => {
    const a = answerReading(read("今月の外食を先月と比べて"), data);
    expect(a.compare).toEqual({ label: "2026年9月", value: 3000, diff: 1000 });
  });
  it("収入", () => {
    expect(answerReading(read("今月の収入"), data).value).toBe(200000);
  });
  it("定型文に判断の言葉（べき・おすすめ）を入れない", () => {
    const a = answerReading(read("今月の支出の内訳"), data);
    expect(a.text).not.toMatch(/べき|おすすめ|した方がいい/);
  });
});

describe("MCP と月の数え方が同じ", () => {
  it("addMonths は lib/mcp/tools.ts と同じ結果", async () => {
    const { addMonths: mcp } = await import("@/lib/mcp/tools");
    const { addMonths: ask } = await import("@/lib/ask/reader");
    for (const [m, k] of [["2026-01", -1], ["2026-12", 1], ["2026-10", -13], ["2025-05", 20]] as const) expect(ask(m, k)).toBe(mcp(m, k));
  });
});

describe("使用感の直し（スマホで通し操作 2026-10-29）", () => {
  it("1つのカテゴリーの「内訳」は月別で返す", () => {
    const a = answerReading(read("内訳は？", read("直近3か月の食費")), data);
    expect(a.reading.groupBy).toBe("month");
    expect(a.breakdown).toHaveLength(3);
  });
});

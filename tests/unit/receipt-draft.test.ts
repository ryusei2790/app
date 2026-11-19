/**
 * @file tests/unit/receipt-draft.test.ts
 * @description テスト一覧 D（レシート読み取り）のうち、DB も AI も使わない部分の単体テスト。
 * - P1 正常な AI 応答 → 取引の下書き
 * - P2 JSON 不正・欠損・合計0・日付が極端 → 自動では確定させず「確認が必要」
 * - P3 明細の合計と合計金額が合わない → 警告
 * - P4 大きすぎる・画像以外・壊れた画像は拒否／送信前の縮小サイズ
 * - P7 外貨・日本語以外は「対象外」
 * - P11 明細の金額ずれ対策（外税の按分・数量×単価の照合）と、カテゴリごとの仕分け（mywork#229）
 * - mywork#1508 割引・数量・同名の別行・「内」印の品が混じる外税のレシートを、税率ごとの対象額で照合する
 */

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import normal from "../fixtures/receipts/normal.json";
import exclusiveTax from "../fixtures/receipts/exclusive-tax.json";
import mixed from "../fixtures/receipts/discount-inner-mixed.json";
import { allocateTax, judgeByRate, judgeInnerMixed, judgeTax, normalizeTaxItems, toDraft } from "@/lib/receipt/schema";
import { RECEIPT_PROMPT } from "@/lib/receipt/prompt";
import { splitByCategory } from "@/lib/receipt/split";
import { matchCategoryId } from "@/lib/receipt/categories";
import { MAX_RECEIPT_BYTES, validateReceiptImage } from "@/lib/receipt/image";
import { computeTargetSize } from "@/lib/image/compress";

const TODAY = "2026-10-08";
const draftOf = (o: unknown) => toDraft(JSON.stringify(o), TODAY);
const codes = (d: ReturnType<typeof toDraft>) => d.warnings.map((w) => w.code);

describe("P1 正常な応答から下書きを作る", () => {
  it("店名・日付・合計・明細がそのまま入り、確認不要（ok）", () => {
    const d = draftOf(normal);
    expect(d).toMatchObject({
      status: "ok",
      merchant: "ファミリーマート 青山店",
      date: "2026-10-07",
      total: 598,
      warnings: [],
    });
    expect(d.items).toHaveLength(3);
    expect(d.items[0]).toEqual({
      name: "おにぎり 鮭", quantity: 1, unitPrice: null, amount: 160, printedAmount: 160, taxRate: 8, category: "食費", unitMismatch: false,
    });
  });

  it("前後に説明文や ```json が付いていても中の JSON を読む", () => {
    const d = toDraft("はい。\n```json\n" + JSON.stringify(normal) + "\n```", TODAY);
    expect(d.status).toBe("ok");
    expect(d.total).toBe(598);
  });
});

describe("P2 怪しい応答は確定させず確認へ（needs_review）", () => {
  it("JSON として読めない", () => {
    const d = toDraft("申し訳ありません、読めませんでした", TODAY);
    expect(d.status).toBe("needs_review");
    expect(codes(d)).toContain("ai_invalid");
    expect(d.total).toBeNull();
  });

  it("型が違う（total が文字列）", () => {
    const d = draftOf({ ...normal, total: "598円" });
    expect(d.status).toBe("needs_review");
    expect(codes(d)).toContain("ai_invalid");
  });

  it.each([
    ["店名が無い", { merchant: null }, "missing_merchant"],
    ["日付が無い", { purchased_at: null }, "missing_date"],
    ["合計が無い", { total: null }, "missing_total"],
    ["合計が0", { total: 0, items: [] }, "total_not_positive"],
    ["合計が小数", { total: 598.5 }, "total_not_positive"],
    ["日付が2年前", { purchased_at: "2024-09-01" }, "date_out_of_range"],
    ["日付が来月", { purchased_at: "2026-11-20" }, "date_out_of_range"],
    ["日付が実在しない", { purchased_at: "2026-02-30" }, "date_out_of_range"],
  ])("%s", (_label, patch, code) => {
    const d = draftOf({ ...normal, ...patch });
    expect(d.status).toBe("needs_review");
    expect(codes(d)).toContain(code);
  });

  it("警告には画面にそのまま出せる日本語のメッセージが付く", () => {
    const d = draftOf({ ...normal, total: null });
    expect(d.warnings[0].message).toMatch(/合計/);
  });
});

describe("P3 明細の和と合計が合わない", () => {
  it("警告 items_total_mismatch を付け、確認へ", () => {
    const d = draftOf({ ...normal, total: 700 });
    expect(d.status).toBe("needs_review");
    expect(codes(d)).toContain("items_total_mismatch");
    expect(d.warnings.find((w) => w.code === "items_total_mismatch")!.message).toMatch(/598.*700|700.*598/);
  });

  it("明細が無いときは照合しない", () => {
    expect(draftOf({ ...normal, items: [] }).status).toBe("ok");
  });
});

describe("P7 外貨・日本語以外は対象外", () => {
  it.each([
    ["USD", { currency: "USD" }, "foreign_currency"],
    ["英語のレシート", { language: "en" }, "non_japanese"],
    ["レシートではない画像", { is_receipt: false }, "not_receipt"],
  ])("%s は unsupported", (_label, patch, code) => {
    const d = draftOf({ ...normal, ...patch });
    expect(d.status).toBe("unsupported");
    expect(codes(d)).toContain(code);
  });
});

describe("P4 画像の検査（サーバー側）", () => {
  const img = (format: "jpeg" | "png" | "webp") =>
    sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } })[format]().toBuffer();

  it.each(["jpeg", "png", "webp"] as const)("%s は受け付ける", async (f) => {
    const r = validateReceiptImage(new Uint8Array(await img(f)));
    expect(r).toEqual({ ok: true, mediaType: `image/${f}` });
  });

  it("2MB を超えると too_large（413）", () => {
    const big = new Uint8Array(MAX_RECEIPT_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(validateReceiptImage(big)).toMatchObject({ ok: false, code: "too_large", status: 413 });
  });

  it.each([
    ["空", new Uint8Array()],
    ["PDF", new TextEncoder().encode("%PDF-1.7 ...")],
    ["テキスト", new TextEncoder().encode("hello")],
  ])("%s は not_image（415）", (_label, bytes) => {
    expect(validateReceiptImage(bytes)).toMatchObject({ ok: false, code: "not_image", status: 415 });
  });

  it.each(["jpeg", "png", "webp"] as const)("途中で切れた %s は corrupt（422）", async (f) => {
    const buf = await img(f);
    const cut = new Uint8Array(buf.subarray(0, buf.length - 6));
    expect(validateReceiptImage(cut)).toMatchObject({ ok: false, code: "corrupt", status: 422 });
  });
});

describe("P4 送信前の縮小サイズ（ブラウザ側）", () => {
  it("長辺 1568px に収め、縦横比を保つ", () => {
    expect(computeTargetSize(4032, 3024)).toEqual({ width: 1568, height: 1176 });
    expect(computeTargetSize(3024, 4032)).toEqual({ width: 1176, height: 1568 });
  });

  it("小さい画像は拡大しない", () => {
    expect(computeTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("P11 明細の金額ずれ対策（mywork#229）", () => {
  it("外税: 税を税率ごとに按分して税込にし、明細の和 = 合計で ok", () => {
    const d = draftOf(exclusiveTax);
    expect(d.status).toBe("ok");
    expect(d.taxAllocated).toBe(true);
    expect(d.items.reduce((s, i) => s + i.amount, 0)).toBe(1327);
    // 印字の金額は残す。数量×単価の行は単価ではなく行の金額
    expect(d.items[1]).toMatchObject({ quantity: 2, unitPrice: 158, printedAmount: 316, unitMismatch: false });
    // 10% の行は 378 + 38
    expect(d.items[4].amount).toBe(416);
  });

  it("按分の端数は税率ごとに最後の行で調整し、税額と1円単位で一致する", () => {
    const out = allocateTax(
      [{ amount: 100, taxRate: 8 }, { amount: 100, taxRate: 8 }, { amount: 100, taxRate: 8 }],
      [{ rate: 8, amount: 24 }]
    );
    expect(out.reduce((s, v) => s + v, 0)).toBe(324);
    expect(out).toEqual([108, 108, 108]);
    expect(allocateTax([{ amount: 1, taxRate: 8 }, { amount: 2, taxRate: 8 }], [{ rate: 8, amount: 1 }])).toEqual([1, 3]);
  });

  it("税率が読めない行は、税の行が1つならその税率とみなす", () => {
    expect(allocateTax([{ amount: 100, taxRate: null }], [{ rate: 10, amount: 10 }])).toEqual([110]);
  });

  it("内税（tax_mode=inclusive）は按分しない", () => {
    const d = draftOf({ ...exclusiveTax, tax_mode: "inclusive", total: 1222 });
    expect(d.taxAllocated).toBe(false);
    expect(d.items[4].amount).toBe(378);
    expect(d.status).toBe("ok");
  });

  it("数量×単価が金額と合わない行に印を付けて確認へ", () => {
    const items = exclusiveTax.items.map((i, k) => (k === 1 ? { ...i, amount: 158 } : i));
    const d = draftOf({ ...exclusiveTax, items, total: null });
    expect(d.items[1].unitMismatch).toBe(true);
    expect(codes(d)).toContain("item_unit_mismatch");
    expect(d.warnings.find((w) => w.code === "item_unit_mismatch")!.message).toMatch(/ヨーグルト/);
  });

  it("税・単価・カテゴリの欄が無い応答（古い形）も読み、内税・未分類として扱う", () => {
    const d = draftOf({
      ...normal,
      tax_mode: undefined,
      tax_lines: undefined,
      items: normal.items.map(({ name, quantity, amount }) => ({ name, quantity, amount })),
    });
    expect(d.status).toBe("ok");
    expect(d.items[0]).toMatchObject({ category: null, taxRate: null, unitPrice: null, amount: 160 });
  });
});

describe("P11 カテゴリごとの仕分け（mywork#229）", () => {
  it("カテゴリごとに足し、大きい順。値引きは同じカテゴリから引かれる", () => {
    expect(splitByCategory([
      { amount: 500, categoryId: "food" }, { amount: -50, categoryId: "food" }, { amount: 300, categoryId: "daily" },
    ], 750)).toEqual([{ categoryId: "food", amount: 450 }, { categoryId: "daily", amount: 300 }]);
  });

  it("明細の和と合計の差は、いちばん大きいカテゴリで吸収する（取引の和 = 合計）", () => {
    const parts = splitByCategory([{ amount: 500, categoryId: "food" }, { amount: 300, categoryId: "daily" }], 810);
    expect(parts).toEqual([{ categoryId: "food", amount: 510 }, { categoryId: "daily", amount: 300 }]);
  });

  it("0円以下になったカテゴリは先頭にまとめる", () => {
    const parts = splitByCategory([{ amount: 500, categoryId: "food" }, { amount: -20, categoryId: "daily" }], 480);
    expect(parts).toEqual([{ categoryId: "food", amount: 480 }]);
  });

  it("カテゴリが1つなら合計で1件", () => {
    expect(splitByCategory([{ amount: 100, categoryId: "food" }], 120)).toEqual([{ categoryId: "food", amount: 120 }]);
  });

  it("AI のカテゴリを利用者のカテゴリに名前で当てはめる（外食費は既定の「外食」にも当たる）", () => {
    const cats = [{ id: "1", name: "食費" }, { id: "2", name: "外食" }, { id: "3", name: "日用品" }];
    expect(matchCategoryId("外食費", cats)).toBe("2");
    expect(matchCategoryId("日用品", cats)).toBe("3");
    expect(matchCategoryId("その他", cats)).toBeNull();
    expect(matchCategoryId(null, cats)).toBeNull();
  });
});

describe("app#42 小計・消費税・合計の整合で内税／外税を決める", () => {
  // 作った数字だけ（実在のレシートではない）。8% 2行＋10% 1行の内税レシート: 小計 652 = 合計 652、内消費税 8% 32・10% 20
  const inclusive = {
    ...normal,
    subtotal: 652,
    total: 652,
    tax_mode: "inclusive",
    tax_lines: [{ rate: 8, amount: 32 }, { rate: 10, amount: 20 }],
    items: [
      { name: "弁当", quantity: null, unit_price: null, amount: 324, tax_rate: 8, category: "食費" },
      { name: "ティッシュ", quantity: null, unit_price: null, amount: 220, tax_rate: 10, category: "日用品" },
      { name: "パン", quantity: null, unit_price: null, amount: 108, tax_rate: 8, category: "食費" },
    ],
  };

  it("judgeTax: 小計 = 合計は内税、小計＋税 = 合計は外税、どちらも違えば不整合、欠けていれば照合しない", () => {
    expect(judgeTax(652, 52, 652)).toBe("inclusive");
    expect(judgeTax(1222, 105, 1327)).toBe("exclusive");
    expect(judgeTax(1222, 105, 1400)).toBe("mismatch");
    expect(judgeTax(1222, 0, 1327)).toBe("mismatch");
    expect(judgeTax(null, 105, 1327)).toBe("unchecked");
    expect(judgeTax(1222, 105, null)).toBe("unchecked");
  });

  it("パターン1（内税）: 小計と合計が一致 → 合計をそのまま登録。内消費税の行があっても足さない", () => {
    const d = draftOf(inclusive);
    expect(d).toMatchObject({ status: "ok", total: 652, subtotal: 652, taxTotal: 52, taxCheck: "inclusive", taxAllocated: false });
    expect(d.items.map((i) => i.amount)).toEqual([324, 220, 108]);
  });

  it("パターン1: AI が「分からない」と答えても金額で内税と決まる", () => {
    const d = draftOf({ ...inclusive, tax_mode: "unknown" });
    expect(d).toMatchObject({ status: "ok", total: 652, taxCheck: "inclusive", taxAllocated: false });
  });

  it("パターン2（外税）: 小計 ≠ 合計で、小計＋消費税 = 合計 → 税込の合計を登録し、取引の和も合計", () => {
    const d = draftOf(exclusiveTax);
    expect(d).toMatchObject({ status: "ok", total: 1327, subtotal: 1222, taxTotal: 105, taxCheck: "exclusive", taxAllocated: true });
    const parts = splitByCategory(d.items.map((i) => ({ amount: i.amount, categoryId: i.category })), d.total!);
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBe(1327);
  });

  it("パターン2: AI が内税・分からないと取り違えても、金額で外税と決まり税込で登録する", () => {
    for (const tax_mode of ["inclusive", "unknown"]) {
      const d = draftOf({ ...exclusiveTax, tax_mode });
      expect(d).toMatchObject({ status: "ok", total: 1327, taxCheck: "exclusive", taxAllocated: true });
      expect(d.items.reduce((s, i) => s + i.amount, 0)).toBe(1327);
    }
  });

  it("パターン2: 小計のあとに値引きがあり印字の小計では合わないときは、値引き後の明細の和で照合する", () => {
    // 印字の小計 1,272（値引き -50 の前）。明細の和 1,222 ＋ 税 105 = 1,327
    const d = draftOf({ ...exclusiveTax, subtotal: 1272 });
    expect(d).toMatchObject({ status: "ok", total: 1327, subtotal: 1222, taxCheck: "exclusive" });
  });

  it("どちらでも合わない: 既存の不整合の扱い（警告を出して確認へ。合計は読めた値のまま）", () => {
    const d = draftOf({ ...exclusiveTax, total: 1400 });
    expect(d).toMatchObject({ status: "needs_review", total: 1400, taxCheck: "mismatch" });
    expect(codes(d)).toEqual(expect.arrayContaining(["subtotal_total_mismatch", "items_total_mismatch"]));
    expect(d.warnings.find((w) => w.code === "subtotal_total_mismatch")!.message).toMatch(/1,222.*105.*1,400/);
  });

  it("1円のずれも合わない扱い（完全一致だけ外税とみなす）", () => {
    const d = draftOf({ ...exclusiveTax, total: 1328 });
    expect(d).toMatchObject({ status: "needs_review", taxCheck: "mismatch" });
  });

  it("外税の税の行があるのに 合計 = 小計（合計の欄に小計を読んだおそれ）→ 確認へ", () => {
    const d = draftOf({ ...exclusiveTax, total: 1222 });
    expect(d.status).toBe("needs_review");
    expect(codes(d)).toContain("total_looks_like_subtotal");
    expect(d.warnings.find((w) => w.code === "total_looks_like_subtotal")!.message).toMatch(/1,327/);
  });

  it("小計の欄が無い応答（古い形）は、印字された明細の和を小計とみなす", () => {
    const { subtotal: _omit, ...old } = exclusiveTax;
    void _omit;
    const d = draftOf(old);
    expect(d).toMatchObject({ status: "ok", subtotal: 1222, taxCheck: "exclusive" });
  });

  it("明細も小計も無ければ照合しない（合計だけで登録できる）", () => {
    const d = draftOf({ ...normal, subtotal: null, items: [] });
    expect(d).toMatchObject({ status: "ok", total: 598, subtotal: null, taxCheck: "unchecked" });
  });
});

describe("mywork#1508 割引・数量・同名の行・「内」印の品が混じる外税のレシート", () => {
  // discount-inner-mixed.json: 本人のレシートの金額だけ（店名・品名は架空）。
  // 8%: 396 ＋ 198 − 40 ＋ 498 ＝ 1,052（税抜）→ 対象額 1,136（税 84）
  // 10%: 528（税抜）＋ 5（「内」印・税込）＝ 533 → 対象額 585（足された税 52。印字の税 53 は「内」の品の分を含む）
  const draftOf = (o: unknown) => toDraft(JSON.stringify(o), "2026-11-19"); // レシートの日付を今日とする
  const sum = (d: ReturnType<typeof toDraft>) => d.items.reduce((s, i) => s + i.amount, 0);
  const noBase = { ...mixed, tax_lines: mixed.tax_lines.map((t) => ({ ...t, base: null })) };
  const dropped = { ...mixed, items: mixed.items.filter((_, k) => k !== 1) }; // 2つ目の同名の行が落ちた読み（アプリで起きたこと）

  it("このレシート: 警告なし。税率ごとの対象額の和 ＝ 合計 で外税と決まり、合計 1,721 を登録", () => {
    const d = draftOf(mixed);
    expect(d).toMatchObject({
      status: "ok", total: 1721, subtotal: 1585, taxTotal: 137, taxCheck: "exclusive", taxBasis: "by_rate", taxAllocated: true, warnings: [],
    });
    expect(d.rateTotals).toEqual([{ rate: 10, amount: 585 }, { rate: 8, amount: 1136 }]);
    expect(sum(d)).toBe(1721);
  });

  it("同じ品名の2行（@198×2=396 と 198）を両方残す。数量×単価の照合も通る", () => {
    const d = draftOf(mixed);
    expect(d.items).toHaveLength(6);
    expect(d.items.filter((i) => i.name === "野菜ジュース 200ml").map((i) => i.printedAmount)).toEqual([396, 198]);
    expect(d.items[0]).toMatchObject({ quantity: 2, unitPrice: 198, unitMismatch: false });
  });

  it("税は「内」の品に足さず、税率ごとの税抜の品だけに按分する（8% は対象額 1,136、10% は 585）", () => {
    const d = draftOf(mixed);
    const at = (rate: number) => d.items.filter((i) => i.taxRate === rate).reduce((s, i) => s + i.amount, 0);
    expect(at(8)).toBe(1136);
    expect(at(10)).toBe(585);
    expect(d.items[3]).toMatchObject({ name: "レジ袋 L", amount: 5, printedAmount: 5 });
    expect(d.items[4].amount).toBe(580); // 528 ＋ 52
    const parts = splitByCategory(d.items.map((i) => ({ amount: i.amount, categoryId: i.category })), d.total!);
    expect(parts).toEqual([
      { categoryId: "食費", amount: 1136 },
      { categoryId: "日用品", amount: 580 },
      { categoryId: "その他", amount: 5 },
    ]);
  });

  it("AI が内税・分からないと答えても（「含む消費税等」の表示）、金額で外税と決まる", () => {
    for (const tax_mode of ["inclusive", "unknown"]) {
      expect(draftOf({ ...mixed, tax_mode })).toMatchObject({ status: "ok", taxCheck: "exclusive", total: 1721 });
    }
  });

  it("割引の行に軽減税率の印が無く AI が 10% と読んでも、値引きされた商品（すぐ上の行）の税率で照合する", () => {
    const items = mixed.items.map((i, k) => (k === 2 ? { ...i, tax_rate: 10 } : i));
    const d = draftOf({ ...mixed, items });
    expect(d).toMatchObject({ status: "ok", taxBasis: "by_rate" });
    expect(sum(d)).toBe(1721);
  });

  it("対象額の印字が無くても、印字の税と足された税の差が「内」の品の税で説明できれば警告なし", () => {
    const d = draftOf(noBase);
    expect(d).toMatchObject({ status: "ok", total: 1721, subtotal: 1585, taxCheck: "exclusive", taxBasis: "inner_mixed", warnings: [] });
    expect(sum(d)).toBe(1721);
    expect(d.items[3].amount).toBe(5);
  });

  it("本当に合わない: 同名の2行目が落ちた読み（明細 1,387）は、対象額があっても警告を残す", () => {
    for (const o of [dropped, { ...dropped, tax_lines: noBase.tax_lines }]) {
      const d = draftOf(o);
      expect(d.status).toBe("needs_review");
      expect(d.taxCheck).toBe("mismatch");
      expect(codes(d)).toEqual(expect.arrayContaining(["subtotal_total_mismatch", "items_total_mismatch"]));
    }
  });

  it("本当に合わない: 合計・割引・商品の金額の読み違いは警告を残す", () => {
    const wrongTotal = { ...mixed, total: 1712 };
    const wrongDiscount = { ...mixed, items: mixed.items.map((i, k) => (k === 2 ? { ...i, amount: -20 } : i)) };
    const wrongItem = { ...mixed, items: mixed.items.map((i, k) => (k === 5 ? { ...i, amount: 489 } : i)) };
    for (const o of [wrongTotal, wrongDiscount, wrongItem]) {
      const d = draftOf(o);
      expect(d.status).toBe("needs_review");
      expect(d.taxCheck).toBe("mismatch");
    }
  });

  it("対象額だけを読み違えても、合計・明細・消費税が「内」の品の税で説明できれば登録額は正しいので警告しない", () => {
    const d = draftOf({ ...mixed, tax_lines: [mixed.tax_lines[0], { ...mixed.tax_lines[1], base: 1163 }] });
    expect(d).toMatchObject({ status: "ok", total: 1721, taxBasis: "inner_mixed" });
    expect(sum(d)).toBe(1721);
  });

  it("「内」印の品が無い外税のレシートは、今までどおり 小計＋消費税＝合計 のぴったりだけを認める（1円ずれは確認へ）", () => {
    const items = mixed.items.map((i) => ({ ...i, tax_included: false }));
    expect(draftOf({ ...noBase, items }).status).toBe("needs_review");
  });
});

describe("mywork#1508 割引（%・円）・数量・外税・内税の型", () => {
  const item = (name: string, amount: number, tax_rate: number | null, extra: Record<string, unknown> = {}) => ({
    name, quantity: null, unit_price: null, amount, tax_rate, tax_included: false, category: "食費", ...extra,
  });
  const base = { ...normal, merchant: "テスト商店", purchased_at: "2026-10-07" };

  it("内税＋%引き＋円引き＋数量: 明細の和 ＝ 小計 ＝ 合計 で警告なし", () => {
    const d = draftOf({
      ...base, subtotal: 700, total: 700, tax_mode: "inclusive", tax_lines: [{ rate: 8, amount: 51, base: 700 }],
      items: [
        item("お茶", 300, 8, { quantity: 2, unit_price: 150 }),
        item("パン", 250, 8),
        item("割引 20%", -50, null),
        item("弁当", 230, 8),
        item("値引", -30, null),
      ],
    });
    expect(d).toMatchObject({ status: "ok", taxCheck: "inclusive", warnings: [] });
    expect(d.items.reduce((s, i) => s + i.amount, 0)).toBe(700);
  });

  it("外税＋%引き: 小計＋消費税＝合計（税率ごとの対象額は税抜で印字）。割引の税率は上の商品から引き継ぐ", () => {
    // 8%: 500 − 100 ＝ 400、税 32 / 10%: 300、税 30 → 合計 762
    const o = {
      ...base, subtotal: 700, total: 762, tax_mode: "exclusive",
      tax_lines: [{ rate: 8, amount: 32, base: 400 }, { rate: 10, amount: 30, base: 300 }],
      items: [item("肉", 500, 8), item("割引 20%", -100, 10), item("洗剤", 300, 10, { category: "日用品" })],
    };
    const d = draftOf(o);
    expect(d).toMatchObject({ status: "ok", taxCheck: "exclusive", taxBasis: "subtotal", warnings: [] });
    expect(d.items.map((i) => i.amount)).toEqual([540, -108, 330]);
  });

  it("外税＋「内」の品＋税抜で印字された対象額: 対象額＋消費税の和 ＝ 合計 で照合する", () => {
    // 8%: 1,000（税 80）/ 10%: 300（税抜）＋ 110（内・税込）→ 対象額 400、税 40（うち 10 は内の品）。合計 1,520
    const d = draftOf({
      ...base, subtotal: 1410, total: 1520, tax_mode: "exclusive",
      tax_lines: [{ rate: 8, amount: 80, base: 1000 }, { rate: 10, amount: 40, base: 400 }],
      items: [item("米", 1000, 8), item("電池", 300, 10, { category: "日用品" }), item("袋", 110, 10, { tax_included: true, category: "その他" })],
    });
    expect(d).toMatchObject({ status: "ok", taxCheck: "exclusive", taxBasis: "by_rate" });
    expect(d.items.map((i) => i.amount)).toEqual([1080, 330, 110]);
  });

  it("judgeByRate: 税率ごとの差が端数1円を超える・明細の税率が欠ける・対象額が欠けると照合しない", () => {
    const items = normalizeTaxItems(mixed.items, mixed.tax_lines);
    expect(judgeByRate(items, mixed.tax_lines, 1721)).not.toBeNull();
    // 8% の対象額を 2円ずらし、合計も合わせる（和は合うが税率ごとの税が説明できない）
    const shifted = [{ ...mixed.tax_lines[0], base: 583 }, { ...mixed.tax_lines[1], base: 1138 }];
    expect(judgeByRate(items, shifted, 1721)).toBeNull();
    expect(judgeByRate(items.map((i, k) => (k === 0 ? { ...i, taxRate: null } : i)), mixed.tax_lines, 1721)).toBeNull();
    expect(judgeByRate(items, [{ ...mixed.tax_lines[0], base: null }, mixed.tax_lines[1]], 1721)).toBeNull();
  });

  it("judgeInnerMixed: 「内」の品が無い・印字の税が足された税より少ない・差が「内」の品の税より大きいと照合しない", () => {
    const items = normalizeTaxItems(mixed.items, mixed.tax_lines);
    expect(judgeInnerMixed(items, 137, 1721)).not.toBeNull();
    expect(judgeInnerMixed(items.map((i) => ({ ...i, taxIncluded: false })), 137, 1721)).toBeNull();
    expect(judgeInnerMixed(items, 135, 1721)).toBeNull();
    expect(judgeInnerMixed(items, 139, 1721)).toBeNull();
  });

  it("読み取りの指示に、同名の行を省かない・＠単価 数量・割引の金額・対象額（base）・「内」印（tax_included）の読み方がある", () => {
    expect(RECEIPT_PROMPT).toMatch(/同じ品名が続けて出てきても、まとめたり、重複とみなして省いたりしない/);
    expect(RECEIPT_PROMPT).toMatch(/＠198 2 396/); // 半角の @ は P9（送る中身にメールを入れない）の検査に掛かるので全角
    expect(RECEIPT_PROMPT).toMatch(/-¥40 なら -40/);
    expect(RECEIPT_PROMPT).toMatch(/"base"/);
    expect(RECEIPT_PROMPT).toMatch(/"tax_included"/);
  });
});

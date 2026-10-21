/**
 * @file tests/unit/receipt-draft.test.ts
 * @description テスト一覧 D（レシート読み取り）のうち、DB も AI も使わない部分の単体テスト。
 * - P1 正常な AI 応答 → 取引の下書き
 * - P2 JSON 不正・欠損・合計0・日付が極端 → 自動では確定させず「確認が必要」
 * - P3 明細の合計と合計金額が合わない → 警告
 * - P4 大きすぎる・画像以外・壊れた画像は拒否／送信前の縮小サイズ
 * - P7 外貨・日本語以外は「対象外」
 * - P11 明細の金額ずれ対策（外税の按分・数量×単価の照合）と、カテゴリごとの仕分け（mywork#229）
 */

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import normal from "../fixtures/receipts/normal.json";
import exclusiveTax from "../fixtures/receipts/exclusive-tax.json";
import { allocateTax, toDraft } from "@/lib/receipt/schema";
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

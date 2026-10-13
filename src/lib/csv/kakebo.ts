/**
 * @file lib/csv/kakebo.ts
 * @description 買い切りの家計簿アプリが書き出す CSV（列: 金額,日付,メモ,カテゴリー名）を読む（テスト一覧 I1〜I3）。
 *
 * - 金額: 支出は負・収入は正の整数円。ここで「絶対値の金額＋支出/収入」に分ける
 * - 日付: YYYY/MM/DD（YYYY-MM-DD も可）。実在する日付だけ
 * - 読めない行は捨てずに「行番号と理由」を返す（本人がプレビューで確かめられるように）。
 *   理由には金額・メモの中身を入れない（画面やログに出しても家計の中身が漏れないように: S11）
 *
 * エポス・セゾン（lib/csv/epos.ts 等）と違い、支出と収入が混ざり、カテゴリーも持っている。
 * そのため CsvPreviewRow ではなく、この形式専用の KakeboRow を返す。
 */

import * as Papa from "papaparse";
import { parseDateOnly } from "@/lib/validation/transaction";

/** この形式のヘッダー（並びも含めて一致したときだけ家計簿アプリ形式とみなす） */
export const KAKEBO_HEADER = ["金額", "日付", "メモ", "カテゴリー名"] as const;

export type CsvFormat = "kakebo";

export interface KakeboRow {
  /** CSV の行番号（ヘッダーが1行目） */
  line: number;
  /** YYYY-MM-DD */
  date: string;
  /** 絶対値の整数円（1円以上） */
  amount: number;
  type: "income" | "expense";
  /** 空なら "" */
  note: string;
  /** 空なら "" */
  categoryName: string;
}

export interface InvalidRow {
  line: number;
  reason: string;
}

/** 1行目を見て形式を判定する。今は家計簿アプリ形式だけ（違えば null＝既存のカード形式を選んでもらう） */
export function detectFormat(text: string): CsvFormat | null {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const cols = firstLine.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const matches = cols.length === KAKEBO_HEADER.length && KAKEBO_HEADER.every((h, i) => cols[i] === h);
  return matches ? "kakebo" : null;
}

const AMOUNT_RE = /^[+-]?\d+$/;
const MAX_YEN = 9_999_999_999;

/**
 * CSV テキスト → 正しい行と読めない行。
 * 行番号を正しく出すため header: false で読み、空行も残したまま自分で数える。
 */
export function parseKakebo(text: string): { rows: KakeboRow[]; invalid: InvalidRow[] } {
  const { data } = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
  const rows: KakeboRow[] = [];
  const invalid: InvalidRow[] = [];

  // 1行目はヘッダーなので 2行目（index 1）から
  for (let i = 1; i < data.length; i++) {
    const cells = data[i];
    const line = i + 1;
    // 空行（最後の改行など）は数えない
    if (cells.length === 1 && cells[0].trim() === "") continue;
    if (cells.length < 2) {
      invalid.push({ line, reason: "列が足りません" });
      continue;
    }

    const [amountRaw = "", dateRaw = "", noteRaw = "", categoryRaw = ""] = cells;

    // 1. 金額: 整数円だけ（小数・文字・0円は読めない行）。桁区切りのカンマは取る
    const amountText = amountRaw.replace(/,/g, "").trim();
    if (!AMOUNT_RE.test(amountText)) {
      invalid.push({ line, reason: "金額が整数の円ではありません" });
      continue;
    }
    const signed = Number(amountText);
    if (signed === 0) {
      invalid.push({ line, reason: "金額が 0 円です" });
      continue;
    }
    if (Math.abs(signed) > MAX_YEN) {
      invalid.push({ line, reason: "金額が大きすぎます" });
      continue;
    }

    // 2. 日付: YYYY/MM/DD → YYYY-MM-DD にして、実在する日付か確かめる（2/30 などは不可）
    const date = dateRaw.trim().replace(/\//g, "-");
    if (!parseDateOnly(date).ok) {
      invalid.push({ line, reason: "日付が YYYY/MM/DD の実在する日ではありません" });
      continue;
    }

    rows.push({
      line,
      date,
      amount: Math.abs(signed),
      type: signed < 0 ? "expense" : "income",
      note: noteRaw.trim(),
      categoryName: categoryRaw.trim(),
    });
  }

  return { rows, invalid };
}

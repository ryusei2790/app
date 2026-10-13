/**
 * @file lib/csv/import-key.ts
 * @description CSV の1行ごとに「行の目印」（import_key）を付ける（テスト一覧 I4〜I6・S10）。
 *
 * 同じ CSV を何回入れても、期間の重なる別の書き出しを入れても取引が増えないよう、
 * 「この行はもう取り込んだか」を行の中身から判定する（ファイル名や取り込んだ月では見ない）。
 *
 * 目印 = "v1:" + SHA-256( 日付 | 符号付き金額 | メモ | カテゴリー名 | 同じ内容の何個目か )
 *   - 「何個目か」を入れるのは、同じ日に同じ買い物を2回した行（実データに4組ある）を潰さないため。
 *     ファイルの中で同じ内容の行に 1, 2, … と番号を振る。並び順に左右されない（同じ内容なので区別が要らない）
 *   - ハッシュにするのは、DB の一意索引を短い固定長にするため（金額やメモの中身を目印として別に持たない）
 *   - "v1:" は作り方の版。後で列の選び方を変えても、古い目印と混ざらないようにする
 */

import { createHash } from "node:crypto";
import type { KakeboRow } from "./kakebo";

export type KeyedRow = KakeboRow & { importKey: string };

/** 行の中身（何個目かを除く）。符号付き金額にして支出と収入を区別する */
function contentOf(r: KakeboRow): string {
  const signed = r.type === "expense" ? -r.amount : r.amount;
  // 区切りに改行を使う（メモに "|" が入っても列がずれないように。改行は CSV の1セルに入りにくい）
  return [r.date, String(signed), r.note, r.categoryName].join("\n");
}

/** 行の配列に目印を付けて返す（元の配列は変えない） */
export function withImportKeys(rows: KakeboRow[]): KeyedRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const content = contentOf(r);
    const nth = (seen.get(content) ?? 0) + 1;
    seen.set(content, nth);
    const hash = createHash("sha256").update(`${content}\n#${nth}`).digest("hex");
    return { ...r, importKey: `v1:${hash}` };
  });
}

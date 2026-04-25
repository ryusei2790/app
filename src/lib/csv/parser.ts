/**
 * @file lib/csv/parser.ts
 * @description カード種別を判定して専用パーサーへ委譲するストラテジーパターン実装。
 * 新しいカード会社を追加する場合は、このファイルに case を追加するだけでよい。
 */

import * as Papa from "papaparse";
import { parseEpos } from "./epos";
import { parseSaison } from "./saison";
import type { CsvPreviewRow } from "@/types/api";

/** 対応カード種別 */
export type CardType = "epos" | "saison";

/**
 * CSV テキストを解析して収支プレビューデータに変換する。
 * @param csvText - CSVファイルのテキスト内容
 * @param cardType - カード会社識別子
 * @returns 変換済み収支データの配列
 */
export function parseCsv(csvText: string, cardType: CardType): CsvPreviewRow[] {
  // papaparse で CSV を連想配列に変換
  // Papa.parse を同期モードで呼び出す（文字列渡しはデフォルトで同期）
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,       // 1行目をヘッダーとして使う
    skipEmptyLines: true,
  });

  const { data, errors } = result;

  if (errors.length > 0) {
    // 致命的エラーのみ throw（部分的なエラーは無視して続行）
    const fatal = errors.filter((e) => e.type === "Delimiter");
    if (fatal.length > 0) {
      throw new Error(`CSV 解析エラー: ${fatal[0].message}`);
    }
  }

  // カード種別に応じたパーサーに委譲（ストラテジーパターン）
  switch (cardType) {
    case "epos":
      return parseEpos(data);
    case "saison":
      return parseSaison(data);
    default:
      throw new Error(`未対応のカード種別: ${cardType}`);
  }
}

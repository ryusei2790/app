/**
 * @file tests/unit/regression-real-data.test.ts
 * @description テスト一覧 V2（mywork#425 第1弾）: 本物の帳簿（CSV）で月ごとの集計が前回と1円単位で一致するか。
 *
 * - 本物の CSV はリポジトリの外にある。環境変数 KAKEBO_REGRESSION_CSV にそのパスを入れたときだけ動く（無ければ skip。fail にしない）
 * - 期待値は git に入れない。git にあるのは scripts/regression/expected.json（正規化した集計の SHA-256・月数・行数・基準日・作った日）だけ
 * - 正規化した集計の本体はローカルの .regression/expected.json（.gitignore）に置き、不一致のときに「どの月・どの項目が違うか」を出す
 *   （金額は端末に出るが、Issue・PR には貼らない）
 * - 期待値を作り直す: KAKEBO_REGRESSION_WRITE=1 を付けて実行（定義を変えたとき。経理部 budget.md と突き合わせてから）
 * - 「今月は今日まで」の基準日（today）は expected.json に保存し、次回も同じ日で計算する（日が変わってもハッシュが変わらないように）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseKakebo } from "@/lib/csv/kakebo";
import { summarize, type AggTx } from "@/lib/aggregate/monthly";
import { canonicalize, sha256Hex } from "@/lib/aggregate/canonical";
import { DEFINITIONS_VERSION } from "@/lib/aggregate/definitions";
import { DEFAULT_FRAMES, DEFAULT_RULES } from "@/lib/budget/defaults";
import type { BudgetRule } from "@/lib/budget/classify";
import type { BudgetFrame } from "@/lib/budget/summary";
import { todayJst } from "@/lib/date/jst";

const csvPath = process.env.KAKEBO_REGRESSION_CSV;
const write = process.env.KAKEBO_REGRESSION_WRITE === "1";
const root = path.resolve(__dirname, "../..");
const expectedPath = path.join(root, "scripts/regression/expected.json");
const localDir = path.join(root, ".regression");
const localPath = path.join(localDir, "expected.json");

interface Expected {
  definitions_version: string;
  today: string;
  months: number;
  rows: number;
  sha256: string;
  generated_at: string;
}

/** 費目は初期の8費目と対応表（id は名前から作る。DB の id に依らない） */
const frames: BudgetFrame[] = DEFAULT_FRAMES.map((f, i) => ({ id: `F:${f.name}`, ...f, sortOrder: i }));
const rules: BudgetRule[] = DEFAULT_RULES.map((r, i) => ({
  id: `R${i}`,
  categoryId: "categoryName" in r ? `C:${r.categoryName}` : null,
  memoKeyword: "memoKeyword" in r ? r.memoKeyword : null,
  frameId: r.frame === null ? null : `F:${r.frame}`,
  priority: i,
}));

describe.skipIf(!csvPath)("V2 実データの回帰（KAKEBO_REGRESSION_CSV があるときだけ）", () => {
  it("全月の集計を正規化したハッシュが scripts/regression/expected.json と一致する", () => {
    const text = readFileSync(csvPath!, "utf8").replace(/^﻿/, "");
    const { rows, invalid } = parseKakebo(text);
    expect(invalid, "読めない行がある").toEqual([]);

    // CSV の行 → 集計の入力。カテゴリーは名前で区別し、種類は全部 normal（CSV に種類の列は無い）
    const txs: AggTx[] = rows.map((r, i) => ({
      id: `csv-${i}`,
      date: r.date,
      amount: r.amount,
      type: r.type,
      kind: "normal",
      categoryId: r.categoryName === "" ? null : `C:${r.categoryName}`,
      categoryName: r.categoryName === "" ? null : r.categoryName,
      categoryType: r.type,
      note: r.note === "" ? null : r.note,
      source: "csv",
    }));
    const months = [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort();

    const previous: Expected | null = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, "utf8")) : null;
    const today = write || !previous ? todayJst() : previous.today;

    const summaries = months.map((m) => summarize({ txs, month: m, today, budget: { frames, rules } }));
    const canon = canonicalize(summaries);
    const hash = sha256Hex(canon);

    if (write || !previous) {
      const next: Expected = {
        definitions_version: DEFINITIONS_VERSION,
        today,
        months: months.length,
        rows: rows.length,
        sha256: hash,
        generated_at: new Date().toISOString(),
      };
      mkdirSync(path.dirname(expectedPath), { recursive: true });
      writeFileSync(expectedPath, JSON.stringify(next, null, 2) + "\n");
      mkdirSync(localDir, { recursive: true });
      writeFileSync(localPath, canon + "\n");
      // 書いた直後は一致する（内容は端末にも出さない）
      expect(hash).toBe(next.sha256);
      return;
    }

    expect(months.length).toBe(previous.months);
    expect(rows.length).toBe(previous.rows);
    if (hash !== previous.sha256 && existsSync(localPath)) {
      // どこが違うかだけを出す（月と項目名。金額はローカルの端末にだけ出る）
      const before = JSON.parse(readFileSync(localPath, "utf8")) as Record<string, Record<string, unknown>>;
      const after = JSON.parse(canon) as Record<string, Record<string, unknown>>;
      const diffs: string[] = [];
      for (const m of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const b = JSON.stringify(before[m] ?? null);
        const a = JSON.stringify(after[m] ?? null);
        if (b !== a) diffs.push(`${m}: 前 ${b}\n${m}: 今 ${a}`);
      }
      console.error(`回帰テスト不一致（${diffs.length} か月）。定義を変えたなら KAKEBO_REGRESSION_WRITE=1 で期待値を作り直す\n${diffs.join("\n")}`);
    }
    expect(hash).toBe(previous.sha256);
    expect(previous.definitions_version).toBe(DEFINITIONS_VERSION);
  });
});

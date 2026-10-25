/**
 * @file hooks/useDashboardSummary.ts
 * @description 月の集計（統一 API GET /api/v1/summary?month=YYYY-MM）を取るカスタムフック。
 * ダッシュボードと収支一覧の合計行が同じものを使う（数字の定義が1か所になる: mywork#425 第1弾 D9）。
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import type { SummaryResponse } from "@/types/api";
import { apiErrorMessage, errorMessage } from "@/lib/errors/api-error";

export function useMonthlySummary(month: string) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 読み直しの合図（取引を足した・消したら +1）
  const [reload, setReload] = useState(0);

  useEffect(() => {
    // 月を素早く切り替えたとき、古い月の結果で上書きしない
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/summary?month=${month}`);
        if (!res.ok) throw new Error(await apiErrorMessage(res, "集計の取得に失敗しました"));
        const json = await res.json();
        if (!cancelled) {
          setSummary(json.data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, "集計の取得に失敗しました"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, reload]);

  const refetch = useCallback(() => setReload((n) => n + 1), []);
  return { summary, loading, error, refetch };
}

/** 古い呼び方（年・月の数字）。中身は同じ */
export function useDashboardSummary(year: number, month: number) {
  return useMonthlySummary(`${year}-${String(month).padStart(2, "0")}`);
}

/** 画面側の「今月」（端末の時刻。表示の初期値にだけ使う。集計の基準日はサーバーの JST） */
export function currentMonthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" を n か月ずらす */
export function shiftMonthKey(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

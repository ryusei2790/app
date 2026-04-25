/**
 * @file hooks/useDashboardSummary.ts
 * @description 月次ダッシュボードサマリーを取得するカスタムフック。
 * GET /api/v1/dashboard/summary から合計収支・カテゴリ別内訳を取得する。
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import type { DashboardSummary } from "@/types/api";

export function useDashboardSummary(year: number, month: number) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/dashboard/summary?year=${year}&month=${month}`
      );
      if (!res.ok) throw new Error("サマリーの取得に失敗しました");
      const json = await res.json();
      setSummary(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return { summary, loading, error, refetch: fetchSummary };
}

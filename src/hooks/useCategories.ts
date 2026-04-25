/**
 * @file hooks/useCategories.ts
 * @description カテゴリ一覧を取得するカスタムフック。
 */

"use client";

import { useState, useEffect } from "react";
import type { Category } from "@/types/database";

export function useCategories(type?: "income" | "expense") {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const params = type ? `?type=${type}` : "";
        const res = await fetch(`/api/v1/categories${params}`);
        if (!res.ok) throw new Error("カテゴリの取得に失敗しました");
        const json = await res.json();
        setCategories(json.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "不明なエラー");
      } finally {
        setLoading(false);
      }
    })();
  }, [type]);

  return { categories, loading, error };
}

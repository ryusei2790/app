/**
 * @file hooks/useAccounts.ts
 * @description 口座一覧を取得するカスタムフック。
 */

"use client";

import { useState, useEffect } from "react";
import type { Account } from "@/types/database";
import { apiErrorMessage, errorMessage } from "@/lib/errors/api-error";

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/accounts");
        if (!res.ok) throw new Error(await apiErrorMessage(res, "口座の取得に失敗しました"));
        const json = await res.json();
        setAccounts(json.data);
      } catch (e) {
        setError(errorMessage(e, "不明なエラー"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { accounts, loading, error };
}

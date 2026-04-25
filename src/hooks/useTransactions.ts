/**
 * @file hooks/useTransactions.ts
 * @description 収支データの取得・作成・更新・削除を行うカスタムフック。
 * /api/v1/transactions エンドポイントと通信し、状態管理を担う。
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import type { TransactionWithRelations } from "@/types/database";
import type { CreateTransactionRequest } from "@/types/api";

interface UseTransactionsOptions {
  year: number;
  month: number;
  accountId?: string;
  categoryId?: string;
}

interface UseTransactionsReturn {
  transactions: TransactionWithRelations[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createTransaction: (data: CreateTransactionRequest) => Promise<boolean>;
  deleteTransaction: (id: string) => Promise<boolean>;
}

export function useTransactions({
  year,
  month,
  accountId,
  categoryId,
}: UseTransactionsOptions): UseTransactionsReturn {
  const [transactions, setTransactions] = useState<TransactionWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
        ...(accountId ? { account_id: accountId } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
      });

      const res = await fetch(`/api/v1/transactions?${params}`);
      if (!res.ok) throw new Error("収支の取得に失敗しました");

      const json = await res.json();
      setTransactions(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
    } finally {
      setLoading(false);
    }
  }, [year, month, accountId, categoryId]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  /** 収支を新規作成する */
  const createTransaction = async (
    data: CreateTransactionRequest
  ): Promise<boolean> => {
    try {
      const res = await fetch("/api/v1/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? "作成に失敗しました");
      }
      await fetchTransactions(); // 一覧を再取得
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
      return false;
    }
  };

  /** 収支を削除する */
  const deleteTransaction = async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/transactions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("削除に失敗しました");
      await fetchTransactions();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "不明なエラー");
      return false;
    }
  };

  return {
    transactions,
    loading,
    error,
    refetch: fetchTransactions,
    createTransaction,
    deleteTransaction,
  };
}

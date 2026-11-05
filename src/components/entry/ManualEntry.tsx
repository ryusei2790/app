/**
 * @file components/entry/ManualEntry.tsx
 * @description 手入力の画面（mywork#1150 標準機能①）。保存したら「続けて入力」か「収支一覧で見る」を出す。
 * 保存は既存の POST /api/v1/transactions（useTransactions.createTransaction）を使う。
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { useTransactions } from "@/hooks/useTransactions";
import { todayJst } from "@/lib/date/jst";

export function ManualEntry() {
  const router = useRouter();
  const today = todayJst();
  const [y, m] = today.split("-").map(Number);
  const { createTransaction } = useTransactions({ year: y, month: m });
  const [saved, setSaved] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <h2 className="text-xl font-bold text-gray-900">✍️ 手入力</h2>
      {saved ? (
        <div className="space-y-3 rounded-xl bg-green-50 p-4 text-sm text-green-800" role="status">
          <p>保存しました。</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSaved(false);
                setFormKey((k) => k + 1);
              }}
              className="flex-1 rounded-lg border border-green-300 py-2"
            >
              続けて入力
            </button>
            <Link href="/transactions" className="flex-1 rounded-lg bg-green-600 py-2 text-center font-medium text-white">
              収支一覧で見る
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <TransactionForm
            key={formKey}
            defaultDate={today}
            onSubmit={async (data) => {
              const ok = await createTransaction(data);
              if (ok) setSaved(true);
              return ok;
            }}
            onCancel={() => router.push("/start")}
          />
        </div>
      )}
    </div>
  );
}

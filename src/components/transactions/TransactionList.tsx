/**
 * @file components/transactions/TransactionList.tsx
 * @description 収支一覧コンポーネント（Client Component）。
 * 月の収支を一覧表示する。種別でフィルタリングでき、新規追加は Dialog 内の TransactionForm で行う。
 * mywork#425 第1弾:
 *   - 合計行は GET /api/v1/summary の数字（ダッシュボードと同じ定義）。その場の足し算はしない（D9）
 *   - 種類のバッジ（返金／振替／借入・返済）。今日より後の行は「予定」の区切りで分け、合計に入っていないことを示す
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import { useTransactions } from "@/hooks/useTransactions";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { currentMonthKey, shiftMonthKey, useMonthlySummary } from "@/hooks/useDashboardSummary";
import { DEFINITIONS_PATH, FOOTNOTES, kindLabel, type TransactionKind } from "@/lib/aggregate/definitions";
import { TransactionForm } from "./TransactionForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** 金額フォーマット */
function formatAmount(amount: number): string {
  return `¥${Math.floor(Math.abs(amount)).toLocaleString("ja-JP")}`;
}

/** ソースバッジ */
function SourceBadge({ source }: { source: string }) {
  const config: Record<string, { label: string; class: string }> = {
    manual: { label: "手動", class: "bg-gray-100 text-gray-600" },
    csv: { label: "CSV", class: "bg-blue-100 text-blue-600" },
    auto: { label: "定期", class: "bg-purple-100 text-purple-600" },
    receipt: { label: "レシート", class: "bg-amber-100 text-amber-700" },
  };
  const c = config[source] ?? config.manual;
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${c.class}`}>{c.label}</span>;
}

/** 種類のバッジ（通常は出さない） */
export function KindBadge({ kind, type }: { kind: TransactionKind; type: "income" | "expense" }) {
  if (kind === "normal") return null;
  const cls = kind === "refund" ? "bg-teal-100 text-teal-700" : kind === "transfer" ? "bg-slate-200 text-slate-700" : "bg-orange-100 text-orange-700";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{kindLabel(kind, type)}</span>;
}

export function TransactionList() {
  const today = new Date();
  const [month, setMonth] = useState(currentMonthKey(today));
  const [year, monthNumber] = month.split("-").map(Number);
  const [filterType, setFilterType] = useState<"" | "income" | "expense">("");
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { transactions, loading, error, createTransaction, deleteTransaction } = useTransactions({
    year,
    month: monthNumber,
    ...(filterType ? { type: filterType } : {}),
  } as Parameters<typeof useTransactions>[0]);
  const { summary, refetch: refetchSummary } = useMonthlySummary(month);

  const { accounts } = useAccounts();
  const { categories } = useCategories();

  function changeMonth(delta: number) {
    setMonth(shiftMonthKey(month, delta));
  }

  // カテゴリ・口座の名前をIDから引けるマップ
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  void categoryMap;
  void accountMap;

  // 今日より後（予定）と今日まで（実績）の境目。一覧は日付の新しい順なので、予定が先に来る
  const periodEnd = summary?.period.end ?? null;
  const isScheduled = (date: string) => periodEnd !== null && summary?.period.status !== "past" && date > periodEnd;
  const scheduledCount = transactions.filter((t) => isScheduled(t.transaction_date)).length;

  return (
    <div className="p-4 space-y-4 sm:p-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={() => changeMonth(-1)} className="shrink-0 whitespace-nowrap rounded-lg border border-gray-200 px-2 py-1.5 text-sm hover:bg-gray-50 sm:px-3">
            ← 前月
          </button>
          <h2 className="whitespace-nowrap text-base font-bold text-gray-900 sm:text-xl">
            {year}年{monthNumber}月の収支一覧
          </h2>
          <button onClick={() => changeMonth(1)} className="shrink-0 whitespace-nowrap rounded-lg border border-gray-200 px-2 py-1.5 text-sm hover:bg-gray-50 sm:px-3">
            翌月 →
          </button>
        </div>

        {/* フィルター */}
        <div className="flex items-center gap-2">
          {(["", "expense", "income"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filterType === t ? "bg-blue-600 text-white" : "border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t === "" ? "すべて" : t === "expense" ? "支出" : "収入"}
            </button>
          ))}
        </div>

        {/* 追加ボタン */}
        <button
          onClick={() => setShowAddDialog(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + 収支を追加
        </button>
      </div>

      {/* 月の合計（ダッシュボードと同じ定義・同じ API） */}
      <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm" data-testid="list-summary">
        {summary ? (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span className="text-green-600 font-medium">収入 +{formatAmount(summary.income.total)}</span>
              <span className="text-red-500 font-medium">支出 -{formatAmount(summary.expense.total)}</span>
              <span className={`font-medium ${summary.balance >= 0 ? "text-blue-600" : "text-orange-500"}`}>
                残り {summary.balance >= 0 ? "+" : "-"}
                {formatAmount(summary.balance)}
              </span>
              <span className="ml-auto text-gray-500">{transactions.length} 件</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {FOOTNOTES.listTotal}
              {summary.period.status === "current" && `（1日〜${Number(summary.period.end.slice(8, 10))}日）`}
              {scheduledCount > 0 && `。予定 ${scheduledCount}件は合計に入れていません`}
              {summary.transfers.count + summary.loans.count > 0 && `。振替・借入・返済 ${summary.transfers.count + summary.loans.count}件は支出・収入に入れていません`}
              {" "}
              <Link href={DEFINITIONS_PATH} className="text-blue-600 hover:underline">
                定義
              </Link>
            </p>
          </>
        ) : (
          <span className="text-gray-400">合計を読み込み中…</span>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* 収支テーブル */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">この期間の収支はありません</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-2 py-3 text-left font-medium text-gray-500 sm:px-4">日付</th>
                <th className="w-full px-2 py-3 text-left font-medium text-gray-500 sm:w-auto sm:px-4">内容</th>
                <th className="hidden px-4 py-3 text-left font-medium text-gray-500 md:table-cell">カテゴリ</th>
                <th className="hidden px-4 py-3 text-left font-medium text-gray-500 md:table-cell">口座</th>
                <th className="hidden px-3 py-3 text-left font-medium text-gray-500 sm:table-cell sm:px-4">種別</th>
                <th className="px-2 py-3 text-right font-medium text-gray-500 sm:px-4">金額</th>
                <th className="px-1 py-3 sm:px-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((tx, i) => {
                const scheduled = isScheduled(tx.transaction_date);
                const prevScheduled = i > 0 ? isScheduled(transactions[i - 1].transaction_date) : null;
                const showDivider = i === 0 ? scheduled : prevScheduled !== scheduled;
                return [
                  showDivider ? (
                    <tr key={`${tx.id}-divider`} className="bg-gray-50">
                      <td colSpan={7} className="px-3 py-1.5 text-xs text-gray-500 sm:px-4" data-testid={scheduled ? "scheduled-divider" : "period-divider"}>
                        {scheduled ? "予定（今日より後）— 合計には入れていません" : "今日まで（合計に入っている分）"}
                      </td>
                    </tr>
                  ) : null,
                  <tr key={tx.id} className={`transition-colors hover:bg-gray-50 ${scheduled ? "text-gray-400" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-3 align-top text-gray-500 sm:px-4 sm:align-middle">
                      {new Date(tx.transaction_date).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                    </td>
                    <td className="px-2 py-3 sm:px-4">
                      <div className="flex items-center gap-2">
                        {tx.category?.color && (
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tx.category.color }} />
                        )}
                        <span className={scheduled ? "text-gray-500" : "text-gray-900"}>{tx.note ?? tx.category?.name ?? "未分類"}</span>
                      </div>
                      {/* スマホ幅: カテゴリ・口座・バッジは内容の下に（列を減らして文字が縦に割れないように） */}
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-400 md:hidden">
                        <span>{tx.category?.name ?? "未分類"} · {tx.account?.name ?? "-"}</span>
                        <span className="flex gap-1 sm:hidden">
                          <SourceBadge source={tx.source} />
                          <KindBadge kind={tx.kind ?? "normal"} type={tx.type} />
                        </span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-gray-500 md:table-cell">{tx.category?.name ?? "未分類"}</td>
                    <td className="hidden px-4 py-3 text-gray-500 md:table-cell">{tx.account?.name ?? "-"}</td>
                    <td className="hidden px-3 py-3 sm:table-cell sm:px-4">
                      <div className="flex flex-wrap gap-1">
                        <SourceBadge source={tx.source} />
                        <KindBadge kind={tx.kind ?? "normal"} type={tx.type} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-right align-top tabular-nums sm:px-4 sm:align-middle">
                      <span className={`font-medium ${tx.type === "expense" ? "text-red-500" : tx.kind === "refund" ? "text-teal-700" : "text-green-600"}`}>
                        {tx.type === "expense" ? "-" : "+"}
                        {formatAmount(Number(tx.amount))}
                      </span>
                    </td>
                    <td className="px-1 py-3 text-right align-top sm:px-2 sm:align-middle">
                      <button
                        onClick={async () => {
                          await deleteTransaction(tx.id);
                          refetchSummary();
                        }}
                        className="text-gray-300 hover:text-red-500 transition-colors text-base leading-none"
                        title="削除"
                      >
                        ×
                      </button>
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 収支追加ダイアログ */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>収支を追加</DialogTitle>
          </DialogHeader>
          <TransactionForm
            defaultDate={`${month}-${String(today.getDate()).padStart(2, "0")}`}
            onSubmit={async (data) => {
              const ok = await createTransaction(data);
              if (ok) {
                setShowAddDialog(false);
                refetchSummary();
              }
              return ok;
            }}
            onCancel={() => setShowAddDialog(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

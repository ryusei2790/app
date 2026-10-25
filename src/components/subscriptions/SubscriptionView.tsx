/**
 * @file components/subscriptions/SubscriptionView.tsx
 * @description サブスク一覧（mywork#742 ②、設計書 §3-1）。Client Component。
 * 定期（GET /api/v1/fixed-costs）のうち「サブスク」の印が付いたものだけを、次回更新日が近い順に出す。
 * - 上に月あたり・年あたりの合計と件数（止めているものは入れない。相場が取れないドル建ては外して注記）
 * - 7日以内に更新のものは色付き（設計 Q4 A）
 * - 管理ページ・解約/変更の URL は押すと新しいタブで開く（タップしやすいよう 44px の高さ）
 * - 「編集」は定期の画面の編集フォームを開く（/fixed-costs?edit=<id>。フォームを二重に作らない）
 * 並び・合計の計算は lib/subscriptions/list.ts（純粋関数・単体テスト済み）。ここでは足し算しない。
 */

"use client";

import Link from "next/link";
import { HelpLink } from "@/components/help/HelpLink";
import { useEffect, useState } from "react";
import { buildSubscriptionList, type SubscriptionRow, type SubscriptionSource } from "@/lib/subscriptions/list";
import { apiErrorMessage, errorMessage } from "@/lib/errors/api-error";
import { ErrorNotice } from "@/components/ui/error-notice";

interface Item extends SubscriptionSource {
  manage_url: string | null;
  cancel_url: string | null;
  payment_card: string | null;
  memo: string | null;
  end_date: string | null;
}

type Row = SubscriptionRow<Item>;

const CYCLE_UNIT: Record<Item["cycle"], string> = { weekly: "週", biweekly: "2週", monthly: "月", yearly: "年" };

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

/** "2026-10-25" → "10/25"。年が違えば "2027/1/15" */
function shortDate(d: string, today: string): string {
  const md = `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return d.slice(0, 4) === today.slice(0, 4) ? md : `${d.slice(0, 4)}/${md}`;
}

function todayLocal(): string {
  // ブラウザは日本で使う前提なので端末の日付でよい（定期の画面と同じ）
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function priceOf(r: Row): string {
  const unit = CYCLE_UNIT[r.cycle];
  if (r.currency === "USD") return `$${r.amount}/${unit}` + (r.amount_yen !== null ? `（約${yen(r.amount_yen)}）` : "");
  return `${yen(r.amount)}/${unit}`;
}

/** URL のボタン。未設定なら押せない表示にする */
function LinkButton({ href, label, name }: { href: string | null; label: string; name: string }) {
  if (!href) {
    return <span className="inline-flex min-h-11 items-center px-1 text-xs text-gray-400">{label}未設定</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${name}の${label}を開く`}
      className="inline-flex min-h-11 items-center rounded-lg border border-blue-200 bg-white px-3 text-sm font-medium text-blue-700 hover:bg-blue-50"
    >
      {label} ↗
    </a>
  );
}

function Card({ r, today }: { r: Row; today: string }) {
  const stopped = r.renewal === null;
  return (
    <li
      data-testid="subscription-item"
      className={`rounded-xl border p-4 ${
        stopped ? "border-gray-100 bg-gray-50 opacity-60" : r.soon ? "border-orange-300 bg-orange-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-base font-semibold text-gray-900">{r.name}</p>
        <p className="shrink-0 text-sm font-medium text-gray-900">{priceOf(r)}</p>
      </div>
      <p className={`mt-1 text-sm ${r.soon ? "font-semibold text-orange-700" : "text-gray-600"}`} data-testid="renewal">
        {stopped
          ? r.is_active ? "終了" : "停止中"
          : `次回 ${shortDate(r.renewal!, today)}（${r.days_left === 0 ? "今日" : `あと${r.days_left}日`}）${r.manual ? "・手入力" : ""}`}
      </p>
      <p className="mt-0.5 text-xs text-gray-500">{r.payment_card ?? "カード未設定"}</p>
      {r.memo && <p className="mt-0.5 text-xs text-gray-500 break-words">{r.memo}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <LinkButton href={r.manage_url} label="管理ページ" name={r.name} />
        <LinkButton href={r.cancel_url} label="解約・変更" name={r.name} />
        <Link
          href={`/fixed-costs?edit=${r.id}`}
          className="ml-auto inline-flex min-h-11 items-center px-2 text-sm text-blue-600 hover:underline"
          aria-label={`${r.name}を編集`}
        >
          編集
        </Link>
      </div>
    </li>
  );
}

export function SubscriptionView() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [usdJpy, setUsdJpy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const today = todayLocal();

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/fixed-costs")
      .then(async (res) => {
        if (!res.ok) throw new Error(await apiErrorMessage(res, "サブスクの取得に失敗しました"));
        const json = await res.json();
        if (!alive) return;
        setItems(json.data);
        setError(null);
        setUsdJpy(json.meta?.usd_jpy ?? null);
      })
      .catch((e) => alive && setError(errorMessage(e, "サブスクの取得に失敗しました")));
    return () => {
      alive = false;
    };
  }, [reload]);

  const list = items ? buildSubscriptionList(items, today) : null;
  const hasUsd = list?.active.some((r) => r.currency === "USD") ?? false;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">サブスク <HelpLink section="fixed" /></h2>
          <p className="mt-0.5 text-sm text-gray-500">次回更新が近い順。管理ページ・解約ページをここから開けます</p>
        </div>
        <Link
          href="/fixed-costs?add=subscription"
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
        >
          + 追加
        </Link>
      </div>

      {error && <ErrorNotice message={error} onRetry={() => setReload((n) => n + 1)} />}

      {!list ? (
        !error && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        )
      ) : (
        <>
          <div className="rounded-xl border border-purple-100 bg-purple-50 px-4 py-3" data-testid="subscription-totals">
            <p className="text-xs font-medium text-purple-600">月あたり</p>
            <p className="text-2xl font-bold text-purple-700" data-testid="subscription-monthly">{yen(list.monthly_total)}</p>
            <p className="mt-1 text-sm text-purple-700">
              年あたり {yen(list.yearly_total)} ・ {list.count}件
            </p>
            {hasUsd && (
              <p className="mt-1 text-xs text-gray-500">
                {list.missing_rate > 0
                  ? `ドル円の相場が取れず、ドル建て${list.missing_rate}件は合計に入っていません`
                  : `ドル建ては今日のドル円${usdJpy ? `（1ドル=${usdJpy}円）` : ""}の目安です`}
              </p>
            )}
          </div>

          {list.active.length === 0 && list.stopped.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">
              サブスクがまだありません。「+ 追加」か、
              <Link href="/fixed-costs" className="text-blue-600 underline">定期の収入・支出</Link>
              で「サブスク」にチェックを入れると、ここに出ます
            </div>
          ) : (
            <>
              <section aria-label="次回更新が近い順">
                <h3 className="mb-2 text-xs font-semibold text-gray-500">次回更新が近い順</h3>
                <ul className="space-y-3">
                  {list.active.map((r) => <Card key={r.id} r={r} today={today} />)}
                </ul>
              </section>
              {list.stopped.length > 0 && (
                <section aria-label="止めているもの">
                  <h3 className="mb-2 text-xs font-semibold text-gray-500">止めているもの（合計に入れない）</h3>
                  <ul className="space-y-3">
                    {list.stopped.map((r) => <Card key={r.id} r={r} today={today} />)}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

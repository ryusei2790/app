/**
 * @file components/closing/ClosingView.tsx
 * @description 標準機能③「今月の決算」（mywork#1150 第2弾）。決算日の設定・提案を作るボタン・保存した提案の表示。
 *
 * 表示は react-markdown（生の HTML は描かない設定のまま。rehype-raw を足さない）＋ remark-gfm（表）。
 * AI の文章に HTML が混ざっても文字として出るだけなので、画面にスクリプトが入らない。リンクは描かずに文字だけにする。
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Report {
  month: string;
  markdown: string;
  generations: number;
  updatedAt: string;
}

interface ClosingData {
  month: string;
  today: string;
  closing_day: number | null;
  closing_date: string;
  after_closing: boolean;
  can_generate: boolean;
  generations_left: number | null;
  report: Report | null;
  months: string[];
}

function monthLabel(m: string) {
  const [y, mm] = m.split("-");
  return `${y}年${Number(mm)}月`;
}

async function fetchClosing(m: string | null): Promise<ClosingData> {
  const r = await fetch(`/api/v1/closing${m ? `?month=${m}` : ""}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? "読み込めませんでした");
  return j.data;
}

export function ClosingView() {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<ClosingData | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** 決算の状態を読み直す（作った後・決算日を変えた後にも使う） */
  const load = useCallback(async (m: string | null) => {
    const j = await fetchClosing(m);
    setData(j);
  }, []);

  useEffect(() => {
    // setState は fetch の後（非同期）でだけ呼ぶ（react-hooks/set-state-in-effect）
    fetchClosing(month)
      .then(setData)
      .catch((e: Error) => setNotice(e.message));
  }, [month]);

  async function generate() {
    if (!data) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch("/api/v1/closing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: data.month }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "作れませんでした");
      await load(data.month);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "作れませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function changeDay(v: string) {
    const closing_day = v === "end" ? null : Number(v);
    const r = await fetch("/api/v1/closing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ closing_day }) });
    if (!r.ok) return setNotice("決算日を変えられませんでした");
    await load(data?.month ?? null);
  }

  if (!data) {
    return <p className="p-6 text-center text-sm text-gray-500">{notice ?? "読み込み中…"}</p>;
  }

  const left = data.generations_left;
  const canPress = data.can_generate && !busy && (left === null || left > 0);

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <h2 className="text-xl font-bold text-gray-900">🧾 {monthLabel(data.month)}の決算</h2>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm text-gray-700 shadow-sm">
        <label htmlFor="closing-day">決算日</label>
        <select
          id="closing-day"
          data-testid="closing-day"
          className="rounded border border-gray-300 px-2 py-1"
          value={data.closing_day === null ? "end" : String(data.closing_day)}
          onChange={(e) => changeDay(e.target.value)}
        >
          <option value="end">月末</option>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}日
            </option>
          ))}
        </select>
        <span className="text-gray-500">（{data.closing_date.slice(5).replace("-", "/")}）</span>
        {data.months.length > 0 && (
          <select
            aria-label="過去の決算"
            className="ml-auto rounded border border-gray-300 px-2 py-1"
            value={data.month}
            onChange={(e) => setMonth(e.target.value)}
          >
            {[...new Set([data.today.slice(0, 7), ...data.months])].map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        )}
      </div>

      {!data.after_closing && data.can_generate && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">まだ決算日の前です。今日までの数字で作ります（決算日のあとに作り直せます）。</p>
      )}

      {data.can_generate && (
        <button
          type="button"
          data-testid="closing-generate"
          onClick={generate}
          disabled={!canPress}
          className="w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white disabled:bg-gray-300"
        >
          {busy ? "作っています…（10秒ほど）" : data.report ? "提案を作り直す" : "決算の提案を作る"}
        </button>
      )}
      {left !== null && data.can_generate && <p className="text-center text-xs text-gray-500">この月はあと{left}回作れます</p>}
      {notice && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{notice}</p>}

      {data.report ? (
        <article data-testid="closing-report" className="closing-md rounded-xl bg-white p-4 text-sm leading-relaxed text-gray-800 shadow-sm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: (p) => <h3 className="mt-4 mb-1 border-l-4 border-blue-500 pl-2 text-base font-bold text-gray-900 first:mt-0">{p.children}</h3>,
              h3: (p) => <h4 className="mt-3 mb-1 font-bold">{p.children}</h4>,
              ul: (p) => <ul className="list-disc space-y-1 pl-5">{p.children}</ul>,
              ol: (p) => <ol className="list-decimal space-y-1 pl-5">{p.children}</ol>,
              p: (p) => <p className="my-1">{p.children}</p>,
              table: (p) => (
                <div className="my-2 overflow-x-auto">
                  <table className="w-full border-collapse text-xs">{p.children}</table>
                </div>
              ),
              th: (p) => <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left">{p.children}</th>,
              td: (p) => <td className="border border-gray-200 px-2 py-1">{p.children}</td>,
              a: (p) => <span>{p.children}</span>,
              img: () => null,
            }}
          >
            {data.report.markdown}
          </ReactMarkdown>
          <p className="mt-3 text-right text-xs text-gray-400">
            作成 {new Date(data.report.updatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}・AI の提案です。数字は集計どおり、文章は参考に
          </p>
        </article>
      ) : (
        <div className="rounded-xl bg-white p-4 text-sm text-gray-600 shadow-sm" data-testid="closing-empty">
          今月の目標の達成ぐあいと、次の月の目標・配分・気をつける点・使いすぎ注意をまとめて提案します。
          {!data.can_generate && <span className="mt-2 block text-gray-500">この月の提案は保存されていません（作れるのは今月と先月だけです）。</span>}
        </div>
      )}

      <Link href="/start" className="block text-center text-sm text-blue-600 hover:underline">
        ホームへ戻る
      </Link>
    </div>
  );
}

/**
 * @file components/closing/ClosingView.tsx
 * @description 標準機能③「今月の決算」（mywork#1150 第2弾）。決算日の設定・提案を作るボタン・保存した提案の表示。
 *
 * mywork#1238: 先月以前（12か月前まで）も月を選んで後から決算でき、決算の下で「次の月の目標（支出）」を決められる。
 *   先月を決算すれば次の月は今月なので「今月の目標を決める」になる（加入したばかりの人が先月の数字から今月の目標を立てる使い方）。
 *   目標の候補（同じくらい・5%減・10%減）はサーバーが計算した数字をそのまま出す（AI には作らせない）。
 *
 * 表示は react-markdown（生の HTML は描かない設定のまま。rehype-raw を足さない）＋ remark-gfm（表）。
 * AI の文章に HTML が混ざっても文字として出るだけなので、画面にスクリプトが入らない。リンクは描かずに文字だけにする。
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { HelpLink } from "@/components/help/HelpLink";
import remarkGfm from "remark-gfm";

interface Report {
  month: string;
  markdown: string;
  generations: number;
  updatedAt: string;
}

interface MonthChoice {
  month: string;
  label: string;
  has_records: boolean;
  has_report: boolean;
}

interface GoalRow {
  month: string;
  expenseGoal: number;
  fromMonth: string | null;
}

interface ClosingData {
  month: string;
  today: string;
  month_label: string;
  choices: MonthChoice[];
  has_records: boolean;
  expense: number;
  goal: { goal: number; spent: number; left: number; over: boolean } | null;
  next_month: string;
  next_label: string;
  next_goal: GoalRow | null;
  can_set_next_goal: boolean;
  goal_suggestions: { label: string; amount: number }[];
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

const yen = (v: number) => `¥${v.toLocaleString("ja-JP")}`;

/** 選択肢の1行（「2026年10月（先月）✓提案あり」「記録なし」） */
function choiceLabel(c: MonthChoice) {
  const rel = c.label.includes("年") ? "" : `（${c.label}）`;
  const tag = c.has_report ? " ✓提案あり" : c.has_records ? "" : " ・記録なし";
  return `${monthLabel(c.month)}${rel}${tag}`;
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
  const canPress = data.can_generate && data.has_records && !busy && (left === null || left > 0);

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">🧾 {monthLabel(data.month)}の決算</h2>
        <HelpLink section="closing" />
      </div>

      {/* 決算する月（先月以前もさかのぼって選べる。mywork#1238） */}
      <div className="rounded-xl bg-white p-3 text-sm text-gray-700 shadow-sm">
        <label htmlFor="closing-month" className="block text-xs font-semibold text-gray-500">
          決算する月（先月以前もさかのぼって選べます）
        </label>
        <select
          id="closing-month"
          data-testid="closing-month"
          className="mt-1 w-full rounded border border-gray-300 px-2 py-2 text-base"
          value={data.month}
          onChange={(e) => {
            setNotice(null);
            setMonth(e.target.value);
          }}
        >
          {data.choices.map((c) => (
            <option key={c.month} value={c.month}>
              {choiceLabel(c)}
            </option>
          ))}
        </select>
      </div>

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
      </div>

      {!data.after_closing && data.can_generate && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">まだ決算日の前です。今日までの数字で作ります（決算日のあとに作り直せます）。</p>
      )}

      {/* この月の目標があれば、目標と使った額を並べる（数字はサーバーの集計どおり） */}
      {data.goal && (
        <div data-testid="closing-goal-progress" className={`rounded-xl p-3 text-sm shadow-sm ${data.goal.over ? "bg-red-50 text-red-800" : "bg-green-50 text-green-800"}`}>
          この月の目標 {yen(data.goal.goal)} ／ 使った {yen(data.goal.spent)}（
          {data.goal.over ? `${yen(-data.goal.left)} オーバー` : `あと ${yen(data.goal.left)}`}）
        </div>
      )}

      {!data.has_records && data.can_generate && (
        <p className="rounded-lg bg-gray-100 p-3 text-xs text-gray-600" data-testid="closing-no-records">
          この月の記録がまだありません。手入力・レシート・CSV 取り込みで記録すると決算できます。
        </p>
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
          この月の目標の達成ぐあいと、{data.next_label}の目標・配分・気をつける点・使いすぎ注意をまとめて提案します。
          {!data.can_generate && <span className="mt-2 block text-gray-500">この月の提案は保存されていません（作れるのは今月から12か月前までです）。</span>}
        </div>
      )}

      {data.can_set_next_goal && <GoalPanel key={data.month} data={data} onSaved={() => load(data.month)} />}

      <Link href="/start" className="block text-center text-sm text-blue-600 hover:underline">
        ホームへ戻る
      </Link>
    </div>
  );
}

/**
 * 決算の結果から次の月の目標（支出）を決める（mywork#1238）。
 * 候補ボタン（同じくらい・5%減・10%減）か手で金額を入れて保存する。決め直すと上書き、「目標を消す」で消せる。
 * key に月を入れて、月を切り替えたら入力欄を初期化する（effect で setState しないため）。保存後は読み直した値を表示し、入力欄も保存した額にそろえる。
 */
function GoalPanel({ data, onSaved }: { data: ClosingData; onSaved: () => Promise<void> }) {
  const current = data.next_goal?.expenseGoal ?? null;
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(amount: number | null) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/closing/goal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: data.next_month, expense_goal: amount, from_month: data.month }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "保存できませんでした");
      setValue(amount === null ? "" : String(amount));
      setMsg({ ok: true, text: amount === null ? "目標を消しました" : `${monthLabel(data.next_month)}の目標を ${yen(amount)} にしました` });
      await onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存できませんでした" });
    } finally {
      setBusy(false);
    }
  }

  const typed = Number(value.replace(/[,，¥円\s]/g, ""));
  const typedOk = Number.isInteger(typed) && typed >= 1 && typed <= 99_999_999;

  return (
    <section data-testid="closing-goal" className="space-y-3 rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-bold text-gray-900">🎯 この結果から{data.next_label}の目標を決める</h3>
      <p className="text-xs text-gray-500">
        {monthLabel(data.month)}の支出は {yen(data.expense)}。{monthLabel(data.next_month)}の支出の目標を選ぶか、金額を入れてください。
      </p>
      {current !== null && (
        <p className="text-sm text-gray-700" data-testid="closing-goal-current">
          いまの目標: <span className="font-bold">{yen(current)}</span>
        </p>
      )}
      {data.goal_suggestions.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {data.goal_suggestions.map((g) => (
            <button
              key={g.label}
              type="button"
              disabled={busy}
              onClick={() => save(g.amount)}
              className={`rounded-lg border px-2 py-2 text-xs ${current === g.amount ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-300 text-gray-800 active:bg-gray-100"}`}
            >
              {g.label}
              <span className="block text-sm font-bold">{yen(g.amount)}</span>
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (typedOk) save(typed);
        }}
      >
        <input
          inputMode="numeric"
          aria-label={`${data.next_label}の目標（円）`}
          placeholder="例: 120000"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base"
        />
        <button type="submit" disabled={busy || !typedOk} className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          この額にする
        </button>
      </form>
      {current !== null && (
        <button type="button" disabled={busy} onClick={() => save(null)} className="text-xs text-gray-500 underline">
          目標を消す
        </button>
      )}
      {msg && <p className={`rounded-lg p-2 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      {data.next_label === "今月" && (
        <p className="text-xs text-gray-500">
          今月の決算の画面に、この目標と今日までに使った額が出ます。
        </p>
      )}
    </section>
  );
}

/**
 * @file components/ask/AskView.tsx
 * @description 「質問して集計」の画面（Client Component。mywork#500 第3弾、設計書 4-8）。
 *
 * - 質問を POST /api/v1/ask に送り、ルールで読んだ条件とコードで集計した答えを出す（外部 AI は使わない）
 * - 答えの上に「計算（N件）」のラベルと、期間・対象のチップを出す。チップを押すと条件を変えて再計算（Q7）
 * - 続けての質問（「内訳は？」「先月と比べて」）のため、直前の条件を previous として送る（Q8）
 * - 読めなかったら数字を出さず、例文を押せるように出す（Q4）
 * 会話はこの画面のメモリだけ（保存しない）。
 */

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Reading } from "@/lib/ask/reader";
import { EXAMPLES, addMonths } from "@/lib/ask/reader";
import type { Answer } from "@/lib/ask/answer";
import { DEFINITIONS_PATH } from "@/lib/aggregate/definitions";
import { apiErrorMessage, errorMessage } from "@/lib/errors/api-error";
import { ErrorNotice } from "@/components/ui/error-notice";

type Category = { id: string; name: string; type: "income" | "expense" };
type Reply =
  | { status: "answer"; answer: Answer; categories: Category[] }
  | { status: "unsupported"; examples: string[] }
  | { status: "ambiguous"; candidates: string[] };
type Turn = { question: string; reply: Reply };

const fmt = (a: Answer, n: number) => (a.unit === "件" ? `${n}件` : `${Math.round(n).toLocaleString("ja-JP")}円`);

/** 期間チップの候補（今月・先月・直近3か月・今年）。押すと期間だけ差し替える */
function periodChoices(today: string): Reading["period"][] {
  const m = today.slice(0, 7);
  return [
    { from: m, to: m, label: "今月" },
    { from: addMonths(m, -1), to: addMonths(m, -1), label: "先月" },
    { from: addMonths(m, -2), to: m, label: "直近3か月" },
    { from: `${m.slice(0, 4)}-01`, to: m, label: "今年" },
  ];
}

function todayJstClient(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function AskView() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 送信中の質問（答えが来るまで吹き出しで見せる。続けて打った質問を黙って捨てないよう、送信中は入力を残してボタンで知らせる）
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, pending]);

  const last = [...turns].reverse().find((t) => t.reply.status === "answer")?.reply as Extract<Reply, { status: "answer" }> | undefined;

  async function send(body: Record<string, unknown>, question: string) {
    setBusy(true);
    setPending(question);
    setErr(null);
    try {
      const res = await fetch("/api/v1/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await apiErrorMessage(res, "答えを出せませんでした"));
      const json = await res.json();
      setTurns((ts) => [...ts, { question, reply: json.data as Reply }]);
    } catch (e) {
      setErr(errorMessage(e, "答えを出せませんでした"));
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    void send({ question, ...(last ? { previous: last.answer.reading } : {}) }, question);
  }

  function rerun(reading: Reading, note: string) {
    if (busy) return;
    void send({ reading }, note);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 pb-28 pt-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">質問して集計</h1>
        <p className="mt-1 text-sm text-gray-600">
          「今月の食費は？」のように聞くと、決まったルールで読んで、画面と同じ定義で計算します。AI には何も送りません。
          <Link href={DEFINITIONS_PATH} className="ml-1 text-blue-700 underline">数字の定義</Link>
        </p>
      </div>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => ask(ex)} className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 active:bg-gray-100">
              {ex}
            </button>
          ))}
        </div>
      )}

      <ol className="space-y-4">
        {turns.map((t, i) => (
          <li key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-blue-600 px-3 py-2 text-sm text-white">{t.question}</p>
            <ReplyCard reply={t.reply} onAsk={ask} onRerun={rerun} latest={i === turns.length - 1} />
          </li>
        ))}
      </ol>

      {pending && (
        <div className="space-y-2" aria-live="polite">
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-blue-600 px-3 py-2 text-sm text-white">{pending}</p>
          <p className="text-sm text-gray-500">計算中…</p>
        </div>
      )}

      {err && <ErrorNotice message={err} />}

      {last && (
        <div className="flex flex-wrap gap-2">
          {["内訳は？", "月別で", "前と比べて"].map((f) => (
            <button key={f} type="button" disabled={busy} onClick={() => ask(f)} className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 active:bg-gray-100">
              {f}
            </button>
          ))}
        </div>
      )}

      <div ref={endRef} />

      <form
        className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-xl gap-2 border-t border-gray-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:left-60"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={200}
          placeholder="例: 先月の外食はいくら？"
          aria-label="質問"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base"
        />
        <button type="submit" disabled={busy || !input.trim()} className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "計算中" : "聞く"}
        </button>
      </form>
    </div>
  );
}

function ReplyCard({ reply, onAsk, onRerun, latest }: { reply: Reply; onAsk: (q: string) => void; onRerun: (r: Reading, note: string) => void; latest: boolean }) {
  if (reply.status === "unsupported") {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
        <p>読み取れませんでした（数字は出していません）。こんな聞き方ができます:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {reply.examples.map((ex) => (
            <button key={ex} type="button" onClick={() => onAsk(ex)} className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs">
              {ex}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (reply.status === "ambiguous") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-gray-800">
        <p>どのカテゴリーか分からないので、推測では答えません。どれですか？</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {reply.candidates.map((c) => (
            <button key={c} type="button" onClick={() => onAsk(`今月の${c}`)} className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs">
              {c}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const a = reply.answer;
  const r = a.reading;
  const today = todayJstClient();
  const targets: Array<{ key: string; reading: Reading["target"]; flow: Reading["flow"] }> = [
    { key: "all", reading: { type: "all", name: "支出全体" }, flow: "expense" },
    { key: "fixed", reading: { type: "fixed", name: "固定費" }, flow: "expense" },
    { key: "variable", reading: { type: "variable", name: "変動費" }, flow: "expense" },
    { key: "income", reading: { type: "all", name: "収入全体" }, flow: "income" },
    ...reply.categories.filter((c) => c.type === "expense").map((c) => ({ key: c.id, reading: { type: "category" as const, id: c.id, name: c.name }, flow: "expense" as const })),
  ];
  const max = Math.max(1, ...(a.breakdown ?? []).map((b) => Math.abs(b.value)));

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      {/* 1. 出どころのラベルと条件のチップ（押して直せる） */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-green-100 px-2 py-0.5 font-medium text-green-800">{a.label}</span>
        {latest ? (
          <>
            <select
              aria-label="期間"
              value=""
              onChange={(e) => {
                const p = periodChoices(today).find((x) => x.label === e.target.value);
                // 期間を変えたら比較は外す（「今年」と前の10か月を比べても意味が薄い）
                if (p) onRerun({ ...r, period: p, compare: undefined }, `期間を「${p.label}」に`);
              }}
              className="rounded-full border border-gray-300 bg-white px-2 py-0.5"
            >
              <option value="">📅 {r.period.label}</option>
              {periodChoices(today).filter((p) => p.label !== r.period.label).map((p) => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
            </select>
            <select
              aria-label="対象"
              value=""
              onChange={(e) => {
                const t = targets.find((x) => x.key === e.target.value);
                if (t) onRerun({ ...r, target: t.reading, flow: t.flow }, `対象を「${t.reading.name}」に`);
              }}
              className="max-w-[12rem] rounded-full border border-gray-300 bg-white px-2 py-0.5"
            >
              <option value="">🏷 {r.target.name}</option>
              {targets.map((t) => (
                <option key={t.key} value={t.key}>{t.reading.name}</option>
              ))}
            </select>
          </>
        ) : (
          <span className="text-gray-500">📅 {r.period.label} · 🏷 {r.target.name}</span>
        )}
      </div>

      {/* 2. 答え */}
      <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{fmt(a, a.value)}</p>
      {a.compare && (
        <p className="text-sm text-gray-600">
          {a.compare.label}: {fmt(a, a.compare.value)}（{a.compare.diff === 0 ? "同じ" : `${a.compare.diff > 0 ? "+" : "−"}${fmt(a, Math.abs(a.compare.diff))}`}）
        </p>
      )}
      <p className="mt-1 text-sm text-gray-700">{a.text}</p>
      {a.note && <p className="mt-1 text-xs text-amber-700">{a.note}</p>}

      {/* 3. 内訳（横棒） */}
      {a.breakdown && a.breakdown.length > 0 && (
        <ul className="mt-3 space-y-1">
          {a.breakdown.map((b) => (
            <li key={b.name} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate text-gray-700">{b.name}</span>
                <span className="shrink-0 tabular-nums text-gray-900">{fmt(a, b.value)}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded bg-gray-100">
                <div className="h-1.5 rounded bg-blue-500" style={{ width: `${Math.max(0, (b.value / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

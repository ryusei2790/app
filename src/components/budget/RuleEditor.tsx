/**
 * @file components/budget/RuleEditor.tsx
 * @description 予算の対応表と枠の金額を直す部品（BudgetView の下。テスト一覧 M7・W8）。
 *   - カテゴリー → 費目（「枠の外」も選べる）。選んだ瞬間に保存し、集計を読み直す
 *   - メモの語句 → 費目（例: Spotify → サブスク）。語句はカテゴリーより先に当たる
 *   - 対応表に無いカテゴリーを足す
 *   - 費目ごとの月の上限・目標
 * 振り分けは取引に保存していないので、ここを直すと過去の月の集計もその場で変わる。
 */

"use client";

import { useEffect, useState } from "react";
import type { BudgetData } from "./BudgetView";
import { errorMessage } from "@/lib/errors/api-error";

export interface RuleRow {
  id: string;
  category_id: string | null;
  category_name: string | null;
  memo_keyword: string | null;
  frame_id: string | null;
  priority: number;
}

const OUTSIDE = "__outside__";

async function send(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? "保存に失敗しました");
  return json.data;
}

export function RuleEditor({ data, onChanged }: { data: BudgetData; onChanged: () => void }) {
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState("");
  const [newKeywordFrame, setNewKeywordFrame] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newCategoryFrame, setNewCategoryFrame] = useState("");
  const [limits, setLimits] = useState<Record<string, string>>({});

  // 対応表に足せるカテゴリー（支出）の一覧
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/budget/rules");
        if (res.ok) setCategories((await res.json()).data.categories);
      } catch {
        // 取れなくても既存の行の編集はできる
      }
    })();
  }, []);

  const frameOptions = (
    <>
      {data.frames.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
      <option value={OUTSIDE}>枠の外</option>
    </>
  );
  const toFrameId = (v: string) => (v === OUTSIDE ? null : v);

  /** 保存して集計を読み直す。失敗は画面に出す */
  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      setMessage(done);
      onChanged();
    } catch (e) {
      setMessage(errorMessage(e, "保存に失敗しました"));
    }
  }

  const categoryRules = data.rules.filter((r) => !r.memo_keyword);
  const keywordRules = data.rules.filter((r) => r.memo_keyword);
  const usedCategoryIds = new Set(categoryRules.map((r) => r.category_id));
  const addable = categories.filter((c) => !usedCategoryIds.has(c.id));

  return (
    <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-800">対応表（家計簿のカテゴリー → 費目）</h2>
        <p className="text-xs text-gray-500">変えるとすぐ保存され、過去の月の集計も変わります。</p>
        {message && <p className="mt-1 text-xs text-blue-700" role="status">{message}</p>}
      </div>

      {/* カテゴリー → 費目 */}
      <ul className="divide-y divide-gray-100">
        {categoryRules.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <label htmlFor={`rule-${r.id}`} className="min-w-0 flex-1 truncate text-gray-800">
              <span>{r.category_name ?? "（不明なカテゴリー）"}</span>
              <span className="sr-only"> の費目</span>
            </label>
            <select
              id={`rule-${r.id}`}
              value={r.frame_id ?? OUTSIDE}
              onChange={(e) =>
                run(() => send("PUT", `/api/v1/budget/rules/${r.id}`, { frame_id: toFrameId(e.target.value) }), `${r.category_name} を変更しました`)
              }
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              {frameOptions}
            </select>
          </li>
        ))}
      </ul>

      {/* カテゴリーを足す */}
      {addable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select aria-label="足すカテゴリー" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="rounded border border-gray-300 px-2 py-1">
            <option value="">カテゴリーを足す…</option>
            {addable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select aria-label="足すカテゴリーの費目" value={newCategoryFrame} onChange={(e) => setNewCategoryFrame(e.target.value)} className="rounded border border-gray-300 px-2 py-1">
            <option value="">費目</option>
            {frameOptions}
          </select>
          <button
            type="button"
            disabled={!newCategory || !newCategoryFrame}
            onClick={() =>
              run(async () => {
                await send("POST", "/api/v1/budget/rules", { category_id: newCategory, frame_id: toFrameId(newCategoryFrame) });
                setNewCategory("");
                setNewCategoryFrame("");
              }, "カテゴリーを足しました")
            }
            className="rounded bg-gray-800 px-3 py-1 text-white disabled:opacity-40"
          >
            足す
          </button>
        </div>
      )}

      {/* メモの語句 → 費目 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800">メモの語句（カテゴリーより先に当たる）</h3>
        <ul className="divide-y divide-gray-100">
          {keywordRules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <label htmlFor={`rule-${r.id}`} className="min-w-0 flex-1 truncate">
                「{r.memo_keyword}」<span className="sr-only"> の費目</span>
              </label>
              <select
                id={`rule-${r.id}`}
                value={r.frame_id ?? OUTSIDE}
                onChange={(e) =>
                  run(() => send("PUT", `/api/v1/budget/rules/${r.id}`, { frame_id: toFrameId(e.target.value) }), `「${r.memo_keyword}」を変更しました`)
                }
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                {frameOptions}
              </select>
              <button
                type="button"
                aria-label={`「${r.memo_keyword}」を消す`}
                onClick={() => run(() => send("DELETE", `/api/v1/budget/rules/${r.id}`), `「${r.memo_keyword}」を消しました`)}
                className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input
            aria-label="足す語句"
            placeholder="語句（例: Netflix）"
            value={newKeyword}
            maxLength={50}
            onChange={(e) => setNewKeyword(e.target.value)}
            className="w-36 rounded border border-gray-300 px-2 py-1"
          />
          <select aria-label="足す語句の費目" value={newKeywordFrame} onChange={(e) => setNewKeywordFrame(e.target.value)} className="rounded border border-gray-300 px-2 py-1">
            <option value="">費目</option>
            {frameOptions}
          </select>
          <button
            type="button"
            disabled={!newKeyword.trim() || !newKeywordFrame}
            onClick={() =>
              run(async () => {
                await send("POST", "/api/v1/budget/rules", { memo_keyword: newKeyword.trim(), frame_id: toFrameId(newKeywordFrame) });
                setNewKeyword("");
                setNewKeywordFrame("");
              }, "語句を足しました")
            }
            className="rounded bg-gray-800 px-3 py-1 text-white disabled:opacity-40"
          >
            足す
          </button>
        </div>
      </div>

      {/* 枠の金額 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800">月の枠（円）</h3>
        <ul className="mt-1 grid grid-cols-2 gap-2">
          {data.frames.map((f) => (
            <li key={f.id}>
              <label className="block text-xs text-gray-600" htmlFor={`limit-${f.id}`}>
                {f.name}
              </label>
              <input
                id={`limit-${f.id}`}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={limits[f.id] ?? String(f.monthly_limit)}
                onChange={(e) => setLimits((p) => ({ ...p, [f.id]: e.target.value }))}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={Object.keys(limits).length === 0}
          onClick={() =>
            run(async () => {
              const frames = data.frames
                .filter((f) => limits[f.id] !== undefined)
                .map((f) => ({ id: f.id, monthly_limit: Number(limits[f.id]) }));
              if (frames.some((f) => !Number.isInteger(f.monthly_limit) || f.monthly_limit < 0)) {
                throw new Error("枠は 0 以上の整数円で入れてください");
              }
              await send("PUT", "/api/v1/budget/frames", { frames });
              setLimits({});
            }, "枠を保存しました")
          }
          className="mt-2 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          枠を保存
        </button>
      </div>
    </section>
  );
}

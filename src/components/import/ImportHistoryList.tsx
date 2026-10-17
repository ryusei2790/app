/**
 * @file components/import/ImportHistoryList.tsx
 * @description CSV の取り込み履歴と「取り消す」（mywork#425 第2弾、テスト X5・W10）。
 * CSV インポート画面と設定の「データと書き出し」の両方で使う。
 *
 * 取り消すと、その取り込みで作った取引が消え（定期・カテゴリーは残る）、履歴は「取り消し済み」になる。
 * 押し間違いを防ぐため、1回目の押下では消さず「取り消してよい」の確認を同じ行に出す（ブラウザの confirm は使わない）。
 */

"use client";

import { useEffect, useState } from "react";

interface ImportHistory {
  id: string;
  filename: string;
  status: string;
  row_count: number;
  imported_at: string;
  account: { id: string; name: string } | null;
}

interface Props {
  /** 値が変わると取り直す（取り込み・復元・全削除の後） */
  reloadKey?: number;
  /** 何件まで出すか */
  limit?: number;
  /** 取り消したときに呼ぶ（親が他の表示を取り直す用） */
  onUndone?: () => void;
}

export function ImportHistoryList({ reloadKey = 0, limit = 10, onUndone }: Props) {
  const [history, setHistory] = useState<ImportHistory[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [reload, setReload] = useState(0);

  // 履歴を取る（取り消しのあと・親の reloadKey が変わったときに取り直す）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/import", { cache: "no-store" });
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!cancelled) setHistory(json.data);
      } catch {
        if (!cancelled) setHistory([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, reload]);

  async function undo(h: ImportHistory) {
    setBusy(h.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/import/${h.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "取り消しに失敗しました");
      setMessage({ kind: "ok", text: `「${h.filename}」の取引 ${json.data.deleted_count}件を消しました` });
      setConfirming(null);
      setReload((n) => n + 1);
      onUndone?.();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "取り消しに失敗しました" });
    } finally {
      setBusy(null);
    }
  }

  if (history === null) return <div className="h-14 animate-pulse rounded-xl bg-gray-100" />;
  if (history.length === 0) return <p className="text-sm text-gray-500">取り込みの履歴はまだありません</p>;

  return (
    <div className="space-y-2">
      {message && (
        <p role="status" className={`rounded-lg p-3 text-sm ${message.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}
      <ul data-testid="import-history" className="divide-y divide-gray-100">
        {history.slice(0, limit).map((h) => {
          const undone = h.status === "undone";
          return (
            <li key={h.id} className="py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`truncate font-medium ${undone ? "text-gray-400 line-through" : "text-gray-900"}`}>{h.filename}</p>
                  <p className="text-xs text-gray-500">
                    {h.account?.name ?? "—"} · {new Date(h.imported_at).toLocaleDateString("ja-JP")} · {h.row_count}件
                  </p>
                </div>
                {undone ? (
                  <span className="shrink-0 rounded bg-gray-100 px-2 py-1 text-xs text-gray-500">取り消し済み</span>
                ) : confirming === h.id ? null : (
                  <button
                    type="button"
                    onClick={() => setConfirming(h.id)}
                    className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    取り消す
                  </button>
                )}
              </div>
              {confirming === h.id && !undone && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-900">
                    この取り込みで入った取引（{h.row_count}件）を消します。定期・カテゴリーは残ります。消した後は同じ CSV をもう一度取り込めます。
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="flex-1 rounded-lg border border-gray-300 bg-white py-2 text-xs text-gray-600"
                    >
                      やめる
                    </button>
                    <button
                      type="button"
                      disabled={busy === h.id}
                      onClick={() => undo(h)}
                      className="flex-1 rounded-lg bg-amber-600 py-2 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {busy === h.id ? "取り消し中…" : "取り消してよい"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

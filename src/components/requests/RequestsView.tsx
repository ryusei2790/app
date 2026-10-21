/**
 * @file components/requests/RequestsView.tsx
 * @description 要望の画面（mywork#573 第2弾）。要望はチャットで「〇〇が欲しい」と言うと送れる。
 * 社長には「みんなの要望」も出し、状態をその場で変えられる。
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { REQUEST_STATUSES, STATUS_LABELS, type FeatureRequestRow, type RequestStatus } from "@/lib/requests/status";

interface AdminRow extends FeatureRequestRow {
  userTag: string;
}

const STATUS_STYLE: Record<RequestStatus, string> = {
  received: "bg-gray-100 text-gray-700",
  in_progress: "bg-blue-50 text-blue-700",
  done: "bg-green-50 text-green-700",
  declined: "bg-amber-50 text-amber-700",
};

function day(iso: string) {
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function RequestsView({ isOwner }: { isOwner: boolean }) {
  const [mine, setMine] = useState<FeatureRequestRow[] | null>(null);
  const [all, setAll] = useState<AdminRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/requests")
      .then((r) => r.json())
      .then((j) => setMine(j.data?.requests ?? []))
      .catch(() => setNotice("読み込めませんでした"));
    if (isOwner) {
      fetch("/api/v1/admin/requests")
        .then((r) => r.json())
        .then((j) => setAll(j.data?.requests ?? []))
        .catch(() => setNotice("読み込めませんでした"));
    }
  }, [isOwner]);

  async function changeStatus(id: string, status: RequestStatus) {
    const res = await fetch("/api/v1/admin/requests", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) {
      setNotice("状態を変えられませんでした");
      return;
    }
    setAll((rows) => rows?.map((r) => (r.id === id ? { ...r, status } : r)) ?? null);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">📝 要望</h1>
        <p className="mt-1 text-xs text-gray-500">
          欲しい機能は <Link href="/chat" className="text-blue-600 underline">💬 チャット</Link> で「〇〇が欲しい」と送ってください。
        </p>
      </div>
      {notice && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}

      <section>
        <h2 className="text-sm font-bold text-gray-700">送った要望</h2>
        {mine === null ? (
          <p className="mt-2 text-sm text-gray-400">読み込み中…</p>
        ) : mine.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">まだありません</p>
        ) : (
          <ul className="mt-2 space-y-2" data-testid="my-requests">
            {mine.map((r) => (
              <li key={r.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                  <span>{day(r.createdAt)}</span>
                  <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLE[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                </div>
                <p className="mt-1 text-gray-800">{r.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner && (
        <section>
          <h2 className="text-sm font-bold text-gray-700">みんなの要望（社長だけに表示）</h2>
          {all === null ? (
            <p className="mt-2 text-sm text-gray-400">読み込み中…</p>
          ) : all.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">まだありません</p>
          ) : (
            <ul className="mt-2 space-y-2" data-testid="all-requests">
              {all.map((r) => (
                <li key={r.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                    <span>
                      {day(r.createdAt)}・{r.userTag}
                    </span>
                    <select
                      value={r.status}
                      onChange={(e) => changeStatus(r.id, e.target.value as RequestStatus)}
                      aria-label="状態"
                      className="rounded border border-gray-300 px-1 py-0.5 text-base sm:text-xs"
                    >
                      {REQUEST_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-1 text-gray-800">{r.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
